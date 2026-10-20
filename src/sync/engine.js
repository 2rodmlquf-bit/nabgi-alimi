// 클라우드 저장 엔진: 로그인, 올리기, 복원, 이전(처음 한 번), 건수 확인. 로컬 저장소가 기준이고 DB는 사본이다 (ADR-0002).
// 메인 프로세스에서만 쓴다. 화면은 IPC로 이 엔진의 결과(한국어 안내문이 든 { ok, error? })만 받는다.
//
// 바깥 세계는 모두 주입한다 (시험에서 가짜 서버·메모리 저장소로 바꿀 수 있게):
//   store    snapshot() / setCloudLink(patch) / restore(remoteState)   (src/store/baseStore.js)
//   persist  { loadMeta(), saveMeta(obj), loadSession(), saveSession(obj|null), backup() }
//            meta = { config:{url,key}, ledger }  — 이 컴퓨터에만 있는 것 (docs/erd.md의 LOCAL_CLOUD_LINK, LOCAL_SESSION)
//   fetchImpl, now, timers
const { createClient, checkConfig, CloudError } = require("./client");
const Rows = require("./rows");

const BATCH = 200;
const msg = e => (e instanceof CloudError ? e.message : "예상하지 못한 문제가 생겼어요: " + (e && e.message));

function createSync({ store, persist, fetchImpl, now = () => new Date().toISOString(), setTimer = setTimeout, clearTimer = clearTimeout, debounceMs = 3000, autoUpload = true }) {
  const nowMs = () => Date.parse(now());
  let meta = null, session = null, client = null, busy = null, lastError = "", timer = null, retryMs = 0, loaded = false, lastUploadCount = 0;

  async function ensure() {
    if (loaded) return;
    meta = (await persist.loadMeta()) || {}; meta.ledger = meta.ledger || {};
    session = (await persist.loadSession()) || null;
    loaded = true;
    if (meta.config) client = createClient({ ...meta.config, fetchImpl, nowMs });
  }
  const saveMeta = () => persist.saveMeta(meta);
  const snap = async () => (await store.snapshot());

  // 한 번에 한 가지 일만 한다 (올리기와 복원이 겹치지 않게)
  function exclusive(fn) {
    if (busy) return Promise.resolve({ ok: false, error: "다른 작업이 진행 중이에요. 끝난 뒤 다시 눌러 주세요." });
    busy = (async () => { try { return await fn(); } finally { busy = null; } })();
    return busy;
  }

  async function token() {
    if (!session) throw new CloudError("auth", "먼저 로그인해 주세요.");
    if (session.expiresAt - nowMs() < 60000) {
      try { session = await client.refresh(session.refreshToken); await persist.saveSession(session); }
      catch (e) { if (e.kind === "auth") { session = null; await persist.saveSession(null); } throw e; }
    }
    return session.accessToken;
  }

  async function status() {
    await ensure();
    const { state } = await snap();
    const link = state.cloudLink, p = Rows.plan(Rows.toRows(state), meta.ledger);
    return {
      configured: !!meta.config, projectUrl: meta.config ? meta.config.url : "", enabled: !!link.enabled, project: link.project,
      loggedIn: !!session, email: session ? session.email : "", ownerBound: !!link.ownerUserId,
      pending: p.total, pendingByTable: p.counts, lastSyncedAt: link.lastSyncedAt, lastError, busy: !!busy,
    };
  }

  async function configure({ url, key }) {
    await ensure();
    const c = checkConfig({ url, key });
    if (!c.ok) return c;
    if (meta.config && (meta.config.url !== c.url) && session) { session = null; await persist.saveSession(null); }   // 다른 프로젝트면 로그인도 새로
    meta.config = { url: c.url, key: c.key }; client = createClient({ ...meta.config, fetchImpl, nowMs });
    if (meta.config.url !== (meta.ledgerUrl || meta.config.url)) meta.ledger = {};
    meta.ledgerUrl = meta.config.url;
    await saveMeta();
    return { ok: true };
  }

  // 로그인. 이 컴퓨터의 기록이 이미 다른 계정에 묶여 있으면 거부한다. 처음이면 이 계정에 묶는다 (docs/erd.md, ADR-0005).
  async function login(email, password) {
    await ensure();
    if (!client) return { ok: false, error: "먼저 프로젝트 주소와 공개 키를 저장해 주세요." };
    if (!String(email || "").trim() || !password) return { ok: false, error: "이메일과 비밀번호를 넣어 주세요." };
    try {
      const s = await client.signIn(String(email).trim(), String(password));
      const { state, readOnly } = await snap();
      const owner = state.cloudLink.ownerUserId;
      if (owner && owner !== s.userId) return { ok: false, error: "이 컴퓨터의 기록은 다른 계정에 연결되어 있어요. 그 계정으로 로그인해 주세요. (계정을 바꾸려면 먼저 클라우드 연결 해제가 필요해요.)" };
      if (!owner) {
        if (readOnly) return { ok: false, error: "저장 파일이 읽기 전용이라 계정을 연결하지 못했어요." };
        const r = await store.setCloudLink({ ownerUserId: s.userId, project: "practice", linkedAt: now() });
        if (!r.ok) return r;
      }
      session = s; await persist.saveSession(s); lastError = "";
      return { ok: true, email: s.email };
    } catch (e) { return { ok: false, error: msg(e) }; }
  }

  async function logout() { await ensure(); session = null; await persist.saveSession(null); cancelTimer(); return { ok: true }; }

  async function setEnabled(on) {
    await ensure();
    if (on && !session) return { ok: false, error: "먼저 로그인해 주세요." };
    const r = await store.setCloudLink({ enabled: !!on });
    if (r.ok && on) schedule(); else cancelTimer();
    return r.ok ? { ok: true } : r;
  }

  // 연결 해제: 계정 묶음을 풀고 올린 기록 장부를 비운다. DB의 기록은 지우지 않는다.
  async function unlink() {
    await ensure();
    const r = await store.setCloudLink({ enabled: false, ownerUserId: "", linkedAt: "", lastSyncedAt: "" });
    if (!r.ok) return r;
    meta.ledger = {}; await saveMeta(); session = null; await persist.saveSession(null); cancelTimer();
    return { ok: true };
  }

  async function preview() {
    await ensure();
    const { state } = await snap();
    const rows = Rows.toRows(state), p = Rows.plan(rows, meta.ledger);
    return { ok: true, total: p.total, counts: p.counts, labels: Rows.LABEL, localTotals: Object.fromEntries(Rows.TABLES.map(t => [t, rows[t].length])) };
  }

  // ---- 올리기 ----
  async function sendInserts(table, items, tk, res) {
    for (const part of Rows.chunk(items, BATCH)) {
      try { await client.insertIgnore(table, tk, part.map(i => i.row)); part.forEach(i => (meta.ledger[table] = meta.ledger[table] || {}, meta.ledger[table][i.key] = i.fp)); res.sent += part.length; }
      catch (e) {
        if (e.kind !== "rejected") throw e;
        for (const i of part) {                                                            // 묶음이 거부되면 한 건씩 보내 문제의 행만 가려낸다
          try { await client.insertIgnore(table, tk, [i.row]); (meta.ledger[table] = meta.ledger[table] || {})[i.key] = i.fp; res.sent++; }
          catch (e2) { if (e2.kind !== "rejected") throw e2; res.rejected++; res.firstRejected = res.firstRejected || Rows.LABEL[table] + ": " + e2.message; }
        }
      }
      await saveMeta();
    }
  }

  async function runUpload(opts = {}) {
    await ensure();
    if (!client) return { ok: false, error: "먼저 프로젝트 주소와 공개 키를 저장해 주세요." };
    const { state, readOnly } = await snap();
    if (!opts.force && !state.cloudLink.enabled) return { ok: false, error: "클라우드 저장이 꺼져 있어요." };
    const res = { sent: 0, rejected: 0, firstRejected: "" };
    try {
      const tk = await token();
      const rows = Rows.toRows(state), p = Rows.plan(rows, meta.ledger);
      for (const t of Rows.APPEND) if (p.inserts[t]) await sendInserts(t, p.inserts[t], tk, res);
      for (const t of Rows.APPEND) for (const item of p.tombstones[t] || []) {
        await client.tombstone(t, tk, item.row.id, { deleted_at: item.row.deleted_at, deleted_reason: item.row.deleted_reason });
        (meta.ledger[t] = meta.ledger[t] || {})[item.key] = item.fp; res.sent++;
      }
      for (const t of Rows.CURRENT) for (const part of Rows.chunk(p.upserts[t] || [], BATCH)) {
        await client.upsert(t, tk, Rows.CONFLICT[t], part.map(i => i.row));
        part.forEach(i => ((meta.ledger[t] = meta.ledger[t] || {})[i.key] = i.fp)); res.sent += part.length;
      }
      await saveMeta();
      if (!res.rejected && !readOnly) await store.setCloudLink({ lastSyncedAt: now() });
      lastError = res.rejected ? res.rejected + "건은 서버가 받지 않았어요. (" + res.firstRejected + ")" : ""; retryMs = 0; lastUploadCount = res.sent;
      return { ok: !res.rejected, ...res, ...(res.rejected ? { error: lastError } : {}) };
    } catch (e) {
      lastError = msg(e);
      if (e.kind === "network" || e.kind === "server") backoff();
      return { ok: false, error: lastError, ...res };
    }
  }
  const upload = opts => exclusive(() => runUpload(opts));

  // ---- 자동 올리기: 저장이 일어나면 잠시 모았다가 올린다. 실패하면 점점 길게 기다렸다 다시 한다. 로컬 작업은 막지 않는다. ----
  function cancelTimer() { if (timer) { clearTimer(timer); timer = null; } }
  function schedule(ms = debounceMs) {
    if (!autoUpload) return;
    cancelTimer();
    timer = setTimer(async () => { timer = null; try { await ensure(); const { state } = await snap(); if (state.cloudLink.enabled && session) await upload(); } catch (e) { /* 다음 저장 때 다시 */ } }, ms);
    if (timer && timer.unref) timer.unref();
  }
  function backoff() { retryMs = Math.min(retryMs ? retryMs * 2 : 5000, 300000); schedule(retryMs); }
  function notifyChanged() { if (loaded && session) schedule(); else if (!loaded) ensure().then(() => { if (session) schedule(); }).catch(() => {}); }

  // ---- 복원: DB의 살아 있는 기록 중 로컬에 없는 것만 받아 온다 (사용자가 버튼을 눌렀을 때만) ----
  async function restore() {
    return exclusive(async () => {
      await ensure();
      if (!client || !session) return { ok: false, error: "먼저 로그인해 주세요." };
      try {
        const tk = await token(), remote = {};
        for (const t of Rows.TABLES) remote[t] = await client.readAll(t, tk, Rows.APPEND.includes(t));
        const r = await store.restore(Rows.fromRows(remote));
        if (!r.ok) return r;
        const n = Object.values(r.added).reduce((a, b) => a + b, 0) + Object.values(r.updated).reduce((a, b) => a + b, 0);
        lastError = "";
        return { ok: true, added: r.added, updated: r.updated, changed: n };
      } catch (e) { lastError = msg(e); return { ok: false, error: lastError }; }
    });
  }

  // ---- 건수 확인: 로컬 건수와 DB 건수(내 계정 것)를 표별로 비교한다 ----
  async function verify() {
    await ensure();
    if (!client || !session) return { ok: false, error: "먼저 로그인해 주세요." };
    try {
      const tk = await token(), { state } = await snap(), rows = Rows.toRows(state), out = {};
      let same = true;
      for (const t of Rows.TABLES) {
        const local = rows[t].length, remote = await client.count(t, tk, false);
        out[t] = { local, remote, same: remote >= local };                                                      // 복원·다른 기기로 DB가 더 많을 수 있다
        if (!out[t].same) same = false;
      }
      return { ok: true, same, tables: out };
    } catch (e) { return { ok: false, error: msg(e) }; }
  }

  // ---- 이전(처음 한 번): 백업 → 전부 올리기 → 건수 비교. 멱등이라 중간에 멈춰도 다시 하면 된다. ----
  async function migrate() {
    const guard = await (async () => { await ensure(); if (!client || !session) return { ok: false, error: "먼저 로그인해 주세요." }; return null; })();
    if (guard) return guard;
    let backupName = "";
    try { backupName = await persist.backup(); } catch (e) { return { ok: false, error: "백업을 만들지 못해서 시작하지 않았어요: " + e.message }; }
    const up = await exclusive(() => runUpload({ force: true }));
    if (!up.ok) return { ...up, backup: backupName };
    const v = await verify();
    if (v.ok) await setEnabled(true);
    return { ok: true, sent: up.sent, backup: backupName, verify: v };
  }

  return { configure, login, logout, setEnabled, unlink, status, preview, upload, restore, verify, migrate, notifyChanged, _debug: { get lastUploadCount() { return lastUploadCount; } } };
}

module.exports = { createSync };
