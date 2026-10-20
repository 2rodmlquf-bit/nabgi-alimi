// 로컬 상태 <-> DB 행 변환과 올리기 대기열 계산 (src/sync/rows.js)
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../src/store/core");
const Rows = require("../src/sync/rows");
const { clean } = require("../src/persist");

let n = 0; const ids = () => "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
const T1 = "2026-10-19T09:00:00.000Z", T2 = "2026-10-19T10:00:00.000Z";
const ent = (date, x) => ({ date, channel: "메일", status: "지연", due: "2026-09-24", note: "", ...x });
const view = () => ({ ...clean(null),
  informed: { A: [ent("2026-10-10", { note: "전화로 설명" })] }, quickNotes: { A: [{ text: "메모", createdAt: T1 }] },
  contacted: { 가온산업: "2026-10-12" }, contactLog: { 가온산업: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "2026-10-20", note: "" }] },
  subst: { A: { state: "의심", note: "n" } }, schedule: { A: [{ date: "2026-10-30", qty: "3" }] },
  reasons: { A: "통관" }, edited: { A: { from: "2026-09-24", to: "2026-10-23" } }, soonRules: "필터=3", notice: { template: "사과형", alt: "", signature: "서명" } });
const state = () => Core.fromView(view(), null, { now: T1, newId: ids });

test("toRows: 8개 표로 나뉘고, user_id는 보내지 않으며, 모든 행이 한 표 안에서 같은 열을 가진다", () => {
  const t = Rows.toRows(state());
  assert.deepEqual(Object.keys(t), Rows.TABLES);
  assert.equal(t.inform_logs.length, 1); assert.equal(t.quick_notes.length, 1); assert.equal(t.substitute_checks.length, 1);
  assert.equal(t.schedule_entries.length, 1); assert.equal(t.supplier_contact_logs.length, 1);
  assert.equal(t.order_meta.length, 1); assert.equal(t.supplier_contact_marks.length, 1); assert.equal(t.user_settings.length, 1);
  Object.values(t).flat().forEach(x => assert.equal("user_id" in x.row, false));
  const r = t.inform_logs[0].row;
  assert.deepEqual([r.logged_on, r.channel, r.status, r.deleted_at, r.deleted_reason], ["2026-10-10", "메일", "지연", null, null]);
  assert.equal(t.supplier_contact_logs[0].row.promised_on, "2026-10-20");
  assert.equal(t.order_meta[0].row.edited_to, "2026-10-23");
  assert.deepEqual(t.user_settings[0].row.data.soonRules, "필터=3");
});

test("toRows: 빈 날짜는 null, 설정을 바꾼 적 없으면 설정 행이 없다", () => {
  const s = Core.fromView({ ...clean(null), contactLog: { X: [{ date: "2026-10-12", kind: "reply", channel: "전화", promised: "", note: "" }] } }, null, { now: T1, newId: ids });
  const t = Rows.toRows(s);
  assert.equal(t.supplier_contact_logs[0].row.promised_on, null);
  assert.equal(t.user_settings.length, 0);
});

test("plan: 처음에는 전부 새 행(inserts/upserts)이고, 올린 뒤에는 할 일이 없다 (멱등)", () => {
  const t = Rows.toRows(state());
  const p = Rows.plan(t, {});
  assert.equal(p.total, 8);
  assert.equal(p.inserts.inform_logs.length, 1); assert.equal(p.upserts.order_meta.length, 1);
  const ledger = {};
  for (const tb of Rows.TABLES) { ledger[tb] = {}; t[tb].forEach(x => (ledger[tb][x.key] = Rows.fp(x.row))); }
  assert.equal(Rows.plan(t, ledger).total, 0);
});

test("plan: 이미 올린 기록을 지우면 삭제 표시(tombstone)만 보내고, 현재 값이 바뀌면 upsert만 보낸다", () => {
  const s1 = state(), t1 = Rows.toRows(s1), ledger = {};
  for (const tb of Rows.TABLES) { ledger[tb] = {}; t1[tb].forEach(x => (ledger[tb][x.key] = Rows.fp(x.row))); }
  const v = Core.toView(s1); v.informed = {}; v.reasons = { A: "다른 사유" };
  const s2 = Core.fromView(v, s1, { now: T2, newId: ids });
  const p = Rows.plan(Rows.toRows(s2), ledger);
  assert.deepEqual(p.tombstones.inform_logs[0].row, { id: s1.informLog.A[0].id, deleted_at: T2, deleted_reason: "user" });
  assert.equal(p.inserts.inform_logs, undefined);
  assert.equal(p.upserts.order_meta.length, 1);
  assert.equal(p.total, 2);
});

test("plan: 한도(cap)로 밀린 기록은 이유 'cap'으로 삭제 표시된다", () => {
  let s = null;
  for (let i = 0; i < 52; i++) { const v = s ? Core.toView(s) : clean(null); v.informed.A = (v.informed.A || []).concat(ent("2026-10-10", { note: "m" + i })); s = Core.fromView(v, s, { now: T1, newId: ids }); }
  const dead = Rows.toRows(s).inform_logs.filter(x => x.row.deleted_at);
  assert.equal(dead.length, 2); assert.ok(dead.every(x => x.row.deleted_reason === "cap"));
});

test("fromRows: DB 행을 상태로 되돌리면 올리기 전과 같은 내용이다 (왕복)", () => {
  const s = state(), t = Rows.toRows(s);
  const remote = Object.fromEntries(Rows.TABLES.map(tb => [tb, t[tb].map(x => ({ ...x.row, user_id: "u", created_at: x.row.created_at && x.row.created_at.replace("Z", "+00:00") }))]));
  const back = Rows.fromRows(remote);
  assert.deepEqual(Core.toView(back), Core.toView(s));
});

test("fromRows: 깨진 행(알 수 없는 상태값 등)은 버리고 나머지는 받는다", () => {
  const back = Rows.fromRows({ inform_logs: [{ id: "x1", order_no: "A", logged_on: "2026-10-10", channel: "메일", status: "엉뚱", due: "", note: "", created_at: T1 }, { id: "x2", order_no: "A", logged_on: "2026-10-10", channel: "메일", status: "지연", due: "", note: "", created_at: T1 }] });
  assert.deepEqual(back.informLog.A.map(e => e.id), ["x2"]);
});

test("mergeRestored: 로컬에 없는 기록만 더하고, 로컬에 있는 id(삭제 표시 포함)는 건드리지 않는다", () => {
  const local = state();
  const v = Core.toView(local); const goneId = v.informed.A[0].id; v.informed = {};                        // 로컬에서는 지움
  const local2 = Core.fromView(v, local, { now: T2, newId: ids });
  const remote = Core.normalizeState({ ...Core.emptyState(), informLog: { A: [{ id: goneId, date: "2026-10-10", channel: "메일", status: "지연", due: "", note: "", createdAt: T1 }, { id: "new-1", date: "2026-10-11", channel: "전화", status: "임박", due: "", note: "", createdAt: T2 }] } });
  const r = Core.mergeRestored(local2, remote, { now: T2 });
  assert.equal(r.added.informLog, 1);
  const A = r.state.informLog.A;
  assert.deepEqual(A.map(e => e.id), [goneId, "new-1"]);
  assert.equal(A[0].deletedAt, T2);                                                                          // 로컬의 삭제 표시가 유지된다
  assert.equal(Core.mergeRestored(r.state, remote, { now: T2 }).added.informLog, undefined);                // 한 번 더 해도 같다 (멱등)
});

test("mergeRestored: 현재 값은 updatedAt이 새로운 쪽이 이긴다", () => {
  const local = state();
  const older = Core.normalizeState({ ...Core.emptyState(), orderMeta: { A: { reason: "옛 사유", updatedAt: "2026-01-01T00:00:00.000Z" } }, contactMarks: { 가온산업: { date: "2026-11-01", updatedAt: "2027-01-01T00:00:00.000Z" } }, settings: { notice: null, soonRules: "옛=1", updatedAt: "2026-01-01T00:00:00.000Z" } });
  const r = Core.mergeRestored(local, older, { now: T2 });
  assert.equal(r.state.orderMeta.A.reason, "통관");                  // 로컬이 더 새로움
  assert.equal(r.state.contactMarks.가온산업.date, "2026-11-01");    // 원격이 더 새로움
  assert.equal(r.state.settings.soonRules, "필터=3");
});

test("mergeRestored: 기본값뿐인 로컬 설정(처음 켠 앱)은 서버의 직접 바꾼 설정을 이기지 못한다", () => {
  const fresh = Core.fromView({ ...clean(null), notice: { template: "사과형", alt: "", signature: "" } }, null, { now: "2027-01-01T00:00:00.000Z", newId: ids });   // 시각은 더 새롭지만 기본값
  const remote = Core.normalizeState({ ...Core.emptyState(), settings: { notice: { template: "공지형", alt: "", signature: "홍길동" }, soonRules: "필터=3", updatedAt: "2026-10-01T00:00:00.000Z" } });
  const r = Core.mergeRestored(fresh, remote, { now: T2 });
  assert.equal(r.state.settings.soonRules, "필터=3"); assert.equal(r.state.settings.notice.signature, "홍길동");
  const mine = Core.fromView({ ...clean(null), soonRules: "내것=1" }, null, { now: "2027-01-01T00:00:00.000Z", newId: ids });                                // 직접 바꾼 로컬 설정은 더 새로우면 이긴다
  assert.equal(Core.mergeRestored(mine, remote, { now: T2 }).state.settings.soonRules, "내것=1");
});

// ---- 공급사 회신 (order_replies, ADR-0007) ----
const withReplies = () => Core.fromView({ ...clean(null), replies: {
  A: [{ date: "2026-10-14", promised: "2026-10-25", channel: "전화", note: "다음 주 도착", source: "manual", supplier: "가온산업" }, { date: "2026-10-15", promised: "", channel: "메일", note: "", source: "email" }] } }, null, { now: T1, newId: ids });

test("toRows: 회신은 order_replies 행이 되고, 공급사가 없으면 '(알 수 없음)', 약속일이 비면 null", () => {
  const t = Rows.toRows(withReplies());
  assert.ok(Rows.APPEND.includes("order_replies")); assert.equal(Rows.LABEL.order_replies, "공급사 회신");
  assert.equal(t.order_replies.length, 2);
  const [a, b] = t.order_replies.map(x => x.row);
  assert.deepEqual([a.order_no, a.supplier_name, a.replied_on, a.promised_on, a.channel, a.source, a.note, a.deleted_at, a.deleted_reason], ["A", "가온산업", "2026-10-14", "2026-10-25", "전화", "manual", "다음 주 도착", null, null]);
  assert.deepEqual([b.supplier_name, b.promised_on, b.source], ["(알 수 없음)", null, "email"]);
  t.order_replies.forEach(x => { assert.equal("user_id" in x.row, false); assert.equal(x.key, x.row.id); });
  assert.equal(new Set(t.order_replies.map(x => Object.keys(x.row).sort().join())).size, 1);
});

test("plan: 회신은 새 행으로 올리고, 지우면 삭제 표시만 보낸다", () => {
  const s1 = withReplies(), t1 = Rows.toRows(s1);
  assert.equal(Rows.plan(t1, {}).inserts.order_replies.length, 2);
  const ledger = {};
  for (const tb of Rows.TABLES) { ledger[tb] = {}; t1[tb].forEach(x => (ledger[tb][x.key] = Rows.fp(x.row))); }
  assert.equal(Rows.plan(t1, ledger).total, 0);
  const v = Core.toView(s1); v.replies.A.shift();
  const p = Rows.plan(Rows.toRows(Core.fromView(v, s1, { now: T2, newId: ids })), ledger);
  assert.deepEqual(p.tombstones.order_replies[0].row, { id: s1.orderReplies.A[0].id, deleted_at: T2, deleted_reason: "user" });
  assert.equal(p.inserts.order_replies, undefined); assert.equal(p.total, 1);
});

test("fromRows: 회신이 상태 모양으로 돌아오고(공급사 '(알 수 없음)'은 빈 값), 삭제 표시와 깨진 행은 걸러진다. 왕복이 같다", () => {
  const s1 = withReplies(), t = Rows.toRows(s1);
  const remote = { order_replies: t.order_replies.map(x => ({ ...x.row, user_id: "u" })) };
  const back = Rows.fromRows(remote).orderReplies.A;
  assert.deepEqual(back.map(e => [e.id, e.date, e.promised, e.channel, e.source, e.note, e.supplier]), s1.orderReplies.A.map(e => [e.id, e.date, e.promised, e.channel, e.source, e.note, e.supplier]));
  const dead = Rows.fromRows({ order_replies: [{ ...remote.order_replies[0], deleted_at: T2, deleted_reason: "cap" }] }).orderReplies.A[0];
  assert.deepEqual([dead.deletedAt, dead.deletedReason], [T2, "cap"]);
  assert.equal(Object.keys(Rows.fromRows({ order_replies: [{ ...remote.order_replies[0], channel: "엉뚱", replied_on: null }] }).orderReplies).length, 0);
});

test("mergeRestored: 복원은 로컬에 없는 회신 id만 더하고 삭제 표시된 것은 받지 않는다", () => {
  const s1 = withReplies(), t = Rows.toRows(s1);
  const remote = Rows.fromRows({ order_replies: [...t.order_replies.map(x => x.row), { ...t.order_replies[0].row, id: "dead-1", deleted_at: T2, deleted_reason: "user" }] });
  const empty = Core.emptyState();
  const r = Core.mergeRestored(empty, remote, { now: T2 });
  assert.equal(r.state.orderReplies.A.length, 2); assert.equal(r.added.orderReplies, 2);
  assert.equal(Core.mergeRestored(r.state, remote, { now: T2 }).added.orderReplies, undefined);
});
