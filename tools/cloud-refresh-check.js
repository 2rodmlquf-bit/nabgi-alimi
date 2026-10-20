// 진짜 Supabase에서 "로그인이 만료된 뒤에도 올리기가 이어지는가"를 1시간 기다리지 않고 확인한다. 사용: node tools/cloud-refresh-check.js
// 로그인 정보의 만료 시각을 과거로 돌려 놓고 올리기를 시켜서, 엔진이 갱신 토큰으로 새 토큰을 받아 올리는지 본다. 시험 계정 A만 쓴다.
const { MemoryStore } = require("../src/store/memoryStore");
const { createSync } = require("../src/sync/engine");
const { clean } = require("../src/persist");
const lib = require("../supabase/qa/lib");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); };

(async () => {
  const c = lib.config(), U = lib.users();
  const store = new MemoryStore({ holder: { text: null } });
  const mem = { meta: null, session: null };
  const persist = { loadMeta: async () => mem.meta, saveMeta: async m => { mem.meta = JSON.parse(JSON.stringify(m)); }, loadSession: async () => mem.session, saveSession: async s => { mem.session = s; }, backup: async () => "(메모리)" };
  const sync = createSync({ store, persist, autoUpload: false });
  await sync.configure({ url: c.url, key: c.key });
  check("로그인", (await sync.login(U.a.email, U.a.password)).ok);
  await sync.setEnabled(true);
  const oldToken = mem.session.accessToken;
  mem.session.expiresAt = Date.now() - 1000;                     // 만료된 것처럼
  await store.save({ ...clean(null), informed: { "QA-LIVE-R1": [{ date: "2026-10-20", channel: "전화", status: "지연", due: "", note: "갱신 점검" }] } });
  const r = await sync.upload();
  check("만료된 로그인으로도 올리기가 성공한다 (자동 갱신)", r.ok && r.sent === 1, r.error || "보낸 " + r.sent + "건");
  check("새 토큰으로 바뀌었다", mem.session && mem.session.accessToken !== oldToken && mem.session.expiresAt > Date.now());
  mem.session.refreshToken = "무효한-토큰"; mem.session.expiresAt = Date.now() - 1000;
  await store.save({ ...(await store.load()).view, informed: { "QA-LIVE-R1": [{ date: "2026-10-20", channel: "전화", status: "지연", due: "", note: "갱신 점검" }, { date: "2026-10-21", channel: "전화", status: "지연", due: "", note: "둘째" }] } });
  const r2 = await sync.upload();
  check("갱신도 안 되면 '다시 로그인' 안내가 나오고 로그인 상태가 풀린다", !r2.ok && /로그인/.test(r2.error) && !(await sync.status()).loggedIn, r2.error);
  console.log("\n" + (failed ? failed + "개 실패" : "모두 통과") + "  (넣은 기록 이름: QA-LIVE-R1, cleanup.sql로 지울 수 있어요)");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("점검 중 오류:", e.message); process.exit(2); });
