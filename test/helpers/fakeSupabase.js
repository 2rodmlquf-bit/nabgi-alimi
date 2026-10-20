// 시험용 가짜 Supabase: 실제 서버가 지키는 규칙(본인 행만, 쌓는 기록은 넣기+삭제 표시 열만, 현재 값은 최신 updated_at이 이김)만 흉내 낸다.
// 진짜 서버와의 일치는 supabase/qa(47개 시험)와 tools/cloud-live-check.js가 확인한다.
const PK = { order_meta: ["order_no"], supplier_contact_marks: ["supplier_name"], user_settings: [] };
const APPEND = ["inform_logs", "quick_notes", "substitute_checks", "schedule_entries", "supplier_contact_logs", "order_replies"];
const CHANNELS = ["메일", "카톡·문자", "전화", "구두", "기타"];

function createFake({ users = { "a@x.test": { password: "pw-a", id: "user-a" } }, expiresIn = 3600 } = {}) {
  const db = {}; const tokens = new Map(); const refresh = new Map(); const calls = []; let n = 0;
  const state = { offline: false, failNext: 0, now: () => Date.now() };
  const table = t => (db[t] = db[t] || []);
  const issue = (email, id) => { const a = "at-" + ++n, r = "rt-" + n; tokens.set(a, { id, exp: state.now() + expiresIn * 1000 }); refresh.set(r, { email, id }); return { access_token: a, refresh_token: r, expires_in: expiresIn, user: { id, email } }; };
  const res = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, text: async () => (body === undefined ? "" : JSON.stringify(body)) });

  async function fetchImpl(url, opts = {}) {
    if (state.offline) throw new TypeError("fetch failed");
    if (state.failNext > 0) { state.failNext--; return res(503, { message: "unavailable" }); }
    const u = new URL(url), method = opts.method || "GET", body = opts.body ? JSON.parse(opts.body) : undefined, p = u.pathname;
    calls.push({ method, path: p, query: u.search, body });
    if (p === "/auth/v1/token") {
      const g = u.searchParams.get("grant_type");
      if (g === "password") { const x = users[body.email]; return x && x.password === body.password ? res(200, issue(body.email, x.id)) : res(400, { error_description: "Invalid login credentials" }); }
      const r = refresh.get(body.refresh_token); return r ? res(200, issue(r.email, r.id)) : res(400, { error_description: "bad refresh" });
    }
    const auth = (opts.headers.Authorization || "").replace("Bearer ", ""), tk = tokens.get(auth);
    if (!tk || tk.exp < state.now()) return res(401, { message: "JWT expired" });
    const t = p.replace("/rest/v1/", ""), mine = table(t).filter(r => r.user_id === tk.id), prefer = opts.headers.Prefer || "";
    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const keys = new Set(rows.map(r => Object.keys(r).sort().join()));
      if (keys.size > 1) return res(400, { message: "All object keys must match" });
      for (const r of rows) if ((t === "inform_logs" || t === "order_replies") && !CHANNELS.includes(r.channel)) return res(400, { message: "violates check constraint" });
      for (const r of rows) if (t === "order_replies" && (!["manual", "email"].includes(r.source) || String(r.note || "").length > 200 || !r.supplier_name)) return res(400, { message: "violates check constraint" });
      if (APPEND.includes(t)) {
        for (const r of rows) if (!table(t).some(x => x.id === r.id)) table(t).push({ ...r, user_id: tk.id });
        return res(201);
      }
      const pk = PK[t];
      for (const r of rows) {
        const hit = mine.find(x => pk.every(k => x[k] === r[k]));
        if (!hit) table(t).push({ ...r, user_id: tk.id }); else if (r.updated_at >= hit.updated_at) Object.assign(hit, r);       // 더 오래된 값은 조용히 무시
      }
      return res(201);
    }
    if (method === "PATCH") {
      const id = decodeURIComponent((u.searchParams.get("id") || "").replace("eq.", ""));
      if (Object.keys(body).some(k => k !== "deleted_at" && k !== "deleted_reason")) return res(403, { message: "permission denied", code: "42501" });
      const hit = mine.find(x => x.id === id); if (hit) Object.assign(hit, body);
      return res(204);
    }
    if (method === "GET" || method === "HEAD") {
      let rows = mine.slice();
      if ((u.searchParams.get("deleted_at") || "") === "is.null") rows = rows.filter(r => !r.deleted_at);
      const range = (opts.headers.Range || "0-999").split("-").map(Number);
      const slice = method === "HEAD" ? [] : rows.slice(range[0], range[1] + 1);
      return res(200, method === "HEAD" ? undefined : slice, { "content-range": range[0] + "-" + range[1] + "/" + rows.length });
    }
    return res(405, {});
  }
  return { fetchImpl, db, calls, state, tokens };
}
module.exports = { createFake };
