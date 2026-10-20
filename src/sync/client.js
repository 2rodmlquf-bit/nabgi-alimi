// Supabase를 부르는 가장 낮은 층: 공식 REST 주소(/auth/v1, /rest/v1)를 fetch로 직접 부른다. 메인 프로세스에서만 쓴다.
// 라이브러리를 쓰지 않는 이유: 필요한 호출이 로그인·갱신·읽기·넣기·수정 몇 개뿐이라 의존성을 늘리지 않으려고. (ADR-0006)
// 앱에는 공개(publishable) 키만 넣는다. service_role 키는 어디에도 넣지 않는다.
const TIMEOUT_MS = 20000;

class CloudError extends Error {
  constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; }      // kind: network | auth | denied | rejected | server | config
}

function checkConfig({ url, key } = {}) {
  const u = String(url || "").trim().replace(/\/+$/, ""), k = String(key || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) return { ok: false, error: "프로젝트 주소는 https://….supabase.co 모양이어야 해요." };
  if (/service_role/i.test(k)) return { ok: false, error: "service_role 키는 넣으면 안 돼요. 공개(publishable) 키만 넣어 주세요." };
  if (k.length < 20) return { ok: false, error: "공개(publishable) 키를 넣어 주세요." };
  if (/^eyJ/.test(k)) {                                                                                  // 예전 방식 JWT 키라면 역할을 확인한다
    try { const role = JSON.parse(Buffer.from(k.split(".")[1], "base64").toString("utf8")).role; if (role && role !== "anon") return { ok: false, error: "이 키는 공개 키가 아니에요(" + role + "). 공개(anon·publishable) 키만 넣어 주세요." }; } catch (e) { /* 모양이 다르면 서버가 판단한다 */ }
  }
  return { ok: true, url: u, key: k };
}

function createClient({ url, key, fetchImpl, nowMs = Date.now }) {
  const f = fetchImpl || globalThis.fetch;
  async function call(path, { method = "GET", token, body, headers = {} } = {}) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await f(url + path, { method, signal: ctrl.signal, headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new CloudError("network", e.name === "AbortError" ? "서버 응답이 너무 늦어요. 잠시 뒤 다시 시도해 주세요." : "인터넷에 연결하지 못했어요. 연결을 확인해 주세요.");
    } finally { clearTimeout(timer); }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* 본문이 JSON이 아니다 */ }
    if (res.ok) return { status: res.status, json, headers: res.headers };
    const why = (json && (json.message || json.msg || json.error_description || json.error)) || text.slice(0, 120);
    if (res.status === 401) throw new CloudError("auth", "로그인이 만료됐어요. 다시 로그인해 주세요.", 401);
    if (res.status === 403 || (json && json.code === "42501")) throw new CloudError("denied", "서버가 이 요청을 허락하지 않았어요. (" + why + ")", res.status);
    if (res.status >= 500) throw new CloudError("server", "서버에 문제가 있어요(" + res.status + "). 잠시 뒤 다시 시도해 주세요.", res.status);
    throw new CloudError("rejected", "서버가 받지 않았어요: " + why, res.status);
  }

  const toSession = j => ({ accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at ? j.expires_at * 1000 : nowMs() + (j.expires_in || 3600) * 1000, userId: j.user && j.user.id, email: j.user && j.user.email });

  return {
    async signIn(email, password) {
      try { return toSession((await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } })).json); }
      catch (e) { if (e.kind === "rejected" || e.kind === "auth") throw new CloudError("auth", "이메일이나 비밀번호가 맞지 않아요.", e.status); throw e; }
    },
    async refresh(refreshToken) {
      try { return toSession((await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } })).json); }
      catch (e) { if (e.kind === "rejected" || e.kind === "auth") throw new CloudError("auth", "로그인이 만료됐어요. 다시 로그인해 주세요.", e.status); throw e; }
    },
    // 쌓는 기록: 새 행은 넣고 이미 있으면 건너뛴다
    insertIgnore: (table, token, rows) => call("/rest/v1/" + table, { method: "POST", token, headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: rows }),
    // 현재 값 표: 있으면 덮는다 (더 오래된 updated_at은 DB 트리거가 무시한다)
    upsert: (table, token, conflict, rows) => call("/rest/v1/" + table + "?on_conflict=" + conflict, { method: "POST", token, headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: rows }),
    // 삭제 표시: deleted_at, deleted_reason 두 열만 고칠 수 있다
    tombstone: (table, token, id, fields) => call("/rest/v1/" + table + "?id=eq." + encodeURIComponent(id), { method: "PATCH", token, headers: { Prefer: "return=minimal" }, body: fields }),
    // 삭제 표시 없는 행 읽기 (쌓는 기록은 live만, 현재 값 표는 전부). 1000행씩 이어서 읽는다.
    async readAll(table, token, liveOnly) {                       // liveOnly = 쌓는 기록 표
      const out = [];
      for (let from = 0; ; from += 1000) {
        const r = await call("/rest/v1/" + table + "?select=*" + (liveOnly ? "&deleted_at=is.null" : "") + "&order=" + (liveOnly ? "created_at.asc,id.asc" : "updated_at.asc"), { token, headers: { Range: from + "-" + (from + 999), "Range-Unit": "items" } });
        const rows = Array.isArray(r.json) ? r.json : [];
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    },
    // 건수 (삭제 표시 포함 전체 / 살아 있는 것)
    async count(table, token, liveOnly) {
      const r = await call("/rest/v1/" + table + "?select=*" + (liveOnly ? "&deleted_at=is.null" : ""), { method: "HEAD", token, headers: { Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" } });
      const m = /\/(\d+)$/.exec(r.headers.get("content-range") || "");
      return m ? parseInt(m[1], 10) : 0;
    },
  };
}

module.exports = { createClient, checkConfig, CloudError };
