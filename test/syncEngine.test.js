// 클라우드 저장 엔진 (src/sync/engine.js): 가짜 Supabase로 로그인·올리기·복원·이전·실패 복구를 시험한다.
const test = require("node:test");
const assert = require("node:assert");
const { MemoryStore } = require("../src/store/memoryStore");
const { createSync } = require("../src/sync/engine");
const { createFake } = require("./helpers/fakeSupabase");
const { clean } = require("../src/persist");

const URL_ = "https://abcdefghijkl.supabase.co", KEY = "sb_publishable_" + "x".repeat(30);
const ent = (date, x) => ({ date, channel: "메일", status: "지연", due: "2026-09-24", note: "", ...x });
let seq = 0;

function setup(opts = {}) {
  const holder = { text: null };
  const store = new MemoryStore({ holder, newId: () => "00000000-0000-4000-8000-" + String(++seq).padStart(12, "0") });
  const fake = opts.fake || createFake({ users: { "a@x.test": { password: "pw-a", id: "user-a" }, "b@x.test": { password: "pw-b", id: "user-b" } } });
  const mem = { meta: opts.meta || null, session: null, backups: 0 };
  const persist = { loadMeta: async () => mem.meta, saveMeta: async m => { mem.meta = JSON.parse(JSON.stringify(m)); }, loadSession: async () => mem.session, saveSession: async s => { mem.session = s; }, backup: async () => "backup-" + ++mem.backups };
  const sync = createSync({ store, persist, fetchImpl: fake.fetchImpl, autoUpload: false, now: () => new Date(fake.state.now()).toISOString() });
  return { store, fake, mem, sync, persist };
}
const ready = async (c, who = "a@x.test", pw = "pw-a") => { await c.sync.configure({ url: URL_, key: KEY }); return c.sync.login(who, pw); };
const seed = async store => store.save({ ...clean(null), informed: { A: [ent("2026-10-10", { note: "1" }), ent("2026-10-11", { note: "2" })] }, quickNotes: { A: [{ text: "메모" }] },
  contacted: { 가온산업: "2026-10-12" }, reasons: { A: "통관" }, soonRules: "필터=3" });

test("설정 검사: service_role 키·이상한 주소는 거부하고, 올바른 값은 저장한다", async () => {
  const c = setup();
  assert.equal((await c.sync.configure({ url: "http://evil.example.com", key: KEY })).ok, false);
  assert.match((await c.sync.configure({ url: URL_, key: "service_role_abc" + "x".repeat(20) })).error, /service_role/);
  const jwt = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64") + ".sig";
  assert.match((await c.sync.configure({ url: URL_, key: jwt })).error, /공개 키가 아니에요/);
  assert.equal((await c.sync.configure({ url: URL_, key: KEY })).ok, true);
});

test("로그인: 틀린 비밀번호는 한국어 안내, 맞으면 이 컴퓨터가 그 계정에 묶인다. 다른 계정은 거부", async () => {
  const c = setup();
  await c.sync.configure({ url: URL_, key: KEY });
  assert.match((await c.sync.login("a@x.test", "틀림")).error, /맞지 않아요/);
  assert.equal((await c.sync.login("a@x.test", "pw-a")).ok, true);
  assert.equal((await c.store.snapshot()).state.cloudLink.ownerUserId, "user-a");
  await c.sync.logout();
  const other = await c.sync.login("b@x.test", "pw-b");
  assert.equal(other.ok, false); assert.match(other.error, /다른 계정/);
  assert.equal((await c.sync.status()).loggedIn, false);
  assert.equal((await c.sync.login("a@x.test", "pw-a")).ok, true);          // 원래 계정은 다시 된다
});

test("올리기: 새 기록이 DB에 들어가고, 한 번 더 해도 중복이 없고, 보낼 것이 없으면 요청도 없다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true);
  const r1 = await c.sync.upload();
  assert.equal(r1.ok, true);
  assert.equal(c.fake.db.inform_logs.length, 2); assert.equal(c.fake.db.quick_notes.length, 1);
  assert.equal(c.fake.db.order_meta.length, 1); assert.equal(c.fake.db.supplier_contact_marks.length, 1); assert.equal(c.fake.db.user_settings.length, 1);
  assert.ok(c.fake.db.inform_logs.every(r => r.user_id === "user-a"));
  assert.equal((await c.sync.status()).pending, 0);
  const before = c.fake.calls.length;
  const r2 = await c.sync.upload();
  assert.equal(r2.sent, 0); assert.equal(c.fake.calls.length, before);        // 할 일이 없으면 서버를 부르지 않는다
  assert.ok((await c.store.snapshot()).state.cloudLink.lastSyncedAt);
});

test("올리기: 앱을 껐다 켜도(엔진을 새로 만들어도) 올린 장부가 남아 있다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true); await c.sync.upload();
  const sync2 = createSync({ store: c.store, persist: c.persist, fetchImpl: c.fake.fetchImpl, autoUpload: false });
  assert.equal((await sync2.status()).pending, 0);
  assert.equal((await sync2.status()).loggedIn, true);
});

test("올리기: 안내 기록을 지우면 삭제 표시만 가고(행은 DB에 남음), 바뀐 현재 값은 갱신된다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true); await c.sync.upload();
  const v = (await c.store.load()).view; v.informed.A.shift(); v.reasons.A = "바뀐 사유";
  await c.store.save(v);
  assert.equal((await c.sync.status()).pending, 2);
  assert.equal((await c.sync.upload()).ok, true);
  assert.equal(c.fake.db.inform_logs.length, 2);                                    // 지우지 않는다
  assert.equal(c.fake.db.inform_logs.filter(r => r.deleted_at).length, 1);
  assert.equal(c.fake.db.inform_logs.find(r => r.deleted_at).deleted_reason, "user");
  assert.equal(c.fake.db.order_meta[0].reason, "바뀐 사유");
});

test("실패 복구: 인터넷이 끊기면 안내문과 함께 대기 건수가 남고, 연결되면 이어서 올라간다. 로컬 저장은 영향 없다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true);
  c.fake.state.offline = true;
  const r = await c.sync.upload();
  assert.equal(r.ok, false); assert.match(r.error, /인터넷/);
  assert.ok((await c.sync.status()).pending > 0); assert.match((await c.sync.status()).lastError, /인터넷/);
  assert.equal((await c.store.save({ ...(await c.store.load()).view, reasons: { A: "오프라인 중 저장" } })).ok, true);   // 로컬은 계속 된다
  c.fake.state.offline = false;
  assert.equal((await c.sync.upload()).ok, true);
  assert.equal((await c.sync.status()).pending, 0); assert.equal((await c.sync.status()).lastError, "");
  assert.equal(c.fake.db.order_meta[0].reason, "오프라인 중 저장");
});

test("실패 복구: 서버 오류(503)가 한 번 나도 다음에 모두 올라가고 중복이 없다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true);
  c.fake.state.failNext = 1;
  assert.equal((await c.sync.upload()).ok, false);
  assert.equal((await c.sync.upload()).ok, true);
  assert.equal(c.fake.db.inform_logs.length, 2);
});

test("서버가 거부하는 행이 섞여도 나머지는 올라가고, 거부된 건수와 이유를 알려 준다", async () => {
  const c = setup(); await ready(c);
  await c.store.save({ ...clean(null), informed: { A: [ent("2026-10-10"), ent("2026-10-11", { note: "ok" })] } });
  const real = c.fake.fetchImpl;
  // 묶음의 첫 행 채널을 DB가 모르는 값으로 바꿔 보내서 거부를 유도한다 (가짜 서버는 inform_logs.channel을 검사한다)
  const sync = createSync({ store: c.store, persist: c.persist, autoUpload: false,
    fetchImpl: async (url, o) => { if (o && o.body && /inform_logs/.test(url)) { const rows = JSON.parse(o.body); if (rows[0].note === "") rows[0].channel = "없는채널"; o = { ...o, body: JSON.stringify(rows) }; } return real(url, o); } });
  const r = await sync.upload({ force: true });
  assert.equal(r.ok, false); assert.equal(r.rejected, 1); assert.equal(r.sent, 1); assert.match(r.error, /안내 기록/);
  assert.equal(c.fake.db.inform_logs.length, 1);
});

test("토큰 만료: 시간이 지나면 새 토큰으로 갱신해서 올리기가 계속되고, 갱신도 안 되면 로그인 안내", async () => {
  const fake = createFake({ users: { "a@x.test": { password: "pw-a", id: "user-a" } }, expiresIn: 120 });
  const c = setup({ fake }); await ready(c); await seed(c.store); await c.sync.setEnabled(true);
  let t = Date.now(); fake.state.now = () => t;
  t += 3600 * 1000;
  assert.equal((await c.sync.upload()).ok, true);                                    // 갱신 후 성공
  assert.ok(fake.calls.some(x => x.path === "/auth/v1/token" && x.body && x.body.refresh_token));
  // 갱신 토큰이 무효가 되면 다시 로그인 안내, 로그인 상태는 풀린다
  c.mem.session.refreshToken = "무효"; c.mem.session.expiresAt = 0;
  const sync2 = createSync({ store: c.store, persist: c.persist, fetchImpl: fake.fetchImpl, autoUpload: false });
  const v = (await c.store.load()).view; v.reasons.A = "또 바뀜"; await c.store.save(v);
  const r = await sync2.upload();
  assert.equal(r.ok, false); assert.match(r.error, /로그인/);
  assert.equal((await sync2.status()).loggedIn, false);
});

test("복원: 새 컴퓨터에서 복원하면 DB의 기록이 돌아오고, 지운 기록은 되살아나지 않는다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true); await c.sync.upload();
  const v = (await c.store.load()).view; v.informed.A.shift(); await c.store.save(v); await c.sync.upload();          // 1번을 지움 (DB에는 삭제 표시로 남음)
  const c2 = setup({ fake: c.fake }); await ready(c2);                                                             // 새 컴퓨터: 로컬 비어 있음
  const r = await c2.sync.restore();
  assert.equal(r.ok, true);
  const back = (await c2.store.load()).view;
  assert.deepEqual(back.informed.A.map(e => e.note), ["2"]);
  assert.equal(back.quickNotes.A.length, 1); assert.equal(back.reasons.A, "통관"); assert.equal(back.contacted.가온산업, "2026-10-12"); assert.equal(back.soonRules, "필터=3");
  assert.equal((await c2.sync.restore()).changed, 0);                                                              // 한 번 더 해도 그대로
});

test("복원은 로컬 기록을 덮어쓰지 않는다: 로컬에만 있는 기록은 그대로 남고 대기로 보인다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true); await c.sync.upload();
  const v = (await c.store.load()).view; v.informed.B = [ent("2026-10-15", { note: "로컬만" })]; await c.store.save(v);
  assert.equal((await c.sync.restore()).ok, true);
  assert.equal((await c.store.load()).view.informed.B[0].note, "로컬만");
  assert.equal((await c.sync.status()).pending, 1);
});

test("계정 격리: 다른 계정의 기록은 복원에 섞이지 않는다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true); await c.sync.upload();
  const cb = setup({ fake: c.fake }); await ready(cb, "b@x.test", "pw-b");
  assert.equal((await cb.sync.restore()).changed, 0);
  assert.deepEqual((await cb.store.load()).view.informed, {});
});

test("이전: 백업을 만들고 전부 올린 뒤 건수를 비교해서 같다고 알려 주고, 클라우드 저장을 켠다", async () => {
  const c = setup(); await ready(c); await seed(c.store);
  const pv = await c.sync.preview();
  assert.equal(pv.counts.inform_logs, 2); assert.equal(pv.total, 6);
  const r = await c.sync.migrate();
  assert.equal(r.ok, true); assert.equal(c.mem.backups, 1); assert.equal(r.verify.same, true);
  assert.equal((await c.sync.status()).enabled, true);
  assert.equal((await c.sync.migrate()).sent, 0);                                     // 다시 해도 중복 없음
  assert.equal(c.fake.db.inform_logs.length, 2);
});

test("이전: 백업을 만들지 못하면 아무것도 올리지 않는다", async () => {
  const c = setup(); await ready(c); await seed(c.store);
  const sync = createSync({ store: c.store, persist: { ...c.persist, backup: async () => { throw new Error("디스크 가득"); } }, fetchImpl: c.fake.fetchImpl, autoUpload: false });
  const r = await sync.migrate();
  assert.equal(r.ok, false); assert.match(r.error, /백업/);
  assert.equal(c.fake.db.inform_logs, undefined);
});

test("연결 해제: 계정 묶음과 장부가 지워지고 DB 기록은 남는다. 그 뒤 다른 계정으로 로그인할 수 있다", async () => {
  const c = setup(); await ready(c); await seed(c.store); await c.sync.setEnabled(true); await c.sync.upload();
  assert.equal((await c.sync.unlink()).ok, true);
  const s = await c.sync.status();
  assert.deepEqual([s.enabled, s.loggedIn, s.ownerBound], [false, false, false]);
  assert.equal(c.fake.db.inform_logs.length, 2);
  assert.equal((await c.sync.login("b@x.test", "pw-b")).ok, true);
});

test("자동 올리기: 저장 알림이 여러 번 와도 한 번만 예약하고, 때가 되면 한 번에 올린다", async () => {
  const timers = [];
  const c = setup();
  const sync = createSync({ store: c.store, persist: c.persist, fetchImpl: c.fake.fetchImpl, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: t => { t.cancelled = true; } });
  await sync.configure({ url: URL_, key: KEY }); await sync.login("a@x.test", "pw-a"); await seed(c.store); await sync.setEnabled(true);
  sync.notifyChanged(); sync.notifyChanged();
  const live = timers.filter(t => !t.cancelled);
  assert.equal(live.length, 1);
  await live[0].fn();
  assert.equal(c.fake.db.inform_logs.length, 2);
});
