// 공급사 회신·약속일 판정과 입력 검증 (src/replies.js, Intent 체크리스트 1번, PRD FR-21·22, ADR-0008)
const test = require("node:test");
const assert = require("node:assert");
const R = require("../src/replies");
const Core = require("../src/store/core");
const { clean } = require("../src/persist");

const rep = (date, promised, extra) => ({ id: "r-" + date + (promised || ""), date, promised: promised || "", channel: "메일", note: "", source: "manual", supplier: "가온산업", createdAt: date + "T09:00:00.000Z", ...extra });

test("채널 목록은 저장소(core)·화면 저장본(persist)과 같다 (세 곳이 어긋나지 않게)", () => {
  const s = Core.fromView({ ...clean(null), replies: { A: R.CHANNELS.map(c => ({ date: "2026-10-10", channel: c })) } }, null);
  assert.deepEqual(s.orderReplies.A.map(e => e.channel), R.CHANNELS);                          // core가 모두 받아들인다
  assert.deepEqual(clean({ replies: { A: [{ date: "2026-10-10", channel: "없는채널" }] } }).replies.A.map(e => e.channel), ["기타"]);
});

test("검증: 날짜는 필수, 약속일은 선택, 방법은 목록 안에서, 메모는 200자로 자른다", () => {
  assert.match(R.validate({}).error, /회신 받은 날/);
  assert.match(R.validate({ date: "10/10" }).error, /회신 받은 날/);
  assert.match(R.validate({ date: "2026-10-10", promised: "내일" }).error, /약속일/);
  assert.match(R.validate({ date: "2026-10-10", channel: "비둘기" }).error, /받은 방법/);
  const ok = R.validate({ date: "2026-10-10", promised: "2026-10-30", channel: "전화", note: "가".repeat(300), supplier: "가온산업" });
  assert.equal(ok.ok, true); assert.equal(ok.reply.note.length, 200); assert.equal(ok.reply.source, "manual");
  assert.equal(R.validate({ date: "2026-10-10" }).reply.channel, "기타");                           // 방법은 비워도 된다
  assert.equal(R.validate({ date: "2026-10-10", source: "email" }).reply.source, "email");
});

test("가장 최근 회신: 회신 받은 날이 늦은 것, 같으면 만든 시각이 늦은 것. 삭제 표시된 것은 빠진다", () => {
  const list = [rep("2026-10-10", "2026-10-20"), rep("2026-10-12", "2026-10-25"), rep("2026-10-12", "2026-10-27", { id: "later", createdAt: "2026-10-12T18:00:00.000Z" }), rep("2026-10-15", "2026-11-30", { deletedAt: "2026-10-16T00:00:00.000Z", deletedReason: "user" })];
  assert.equal(R.latest(list).id, "later");                                                          // 같은 날이면 나중에 만든 것이 이긴다
  assert.deepEqual(R.history(list).map(e => e.promised), ["2026-10-20", "2026-10-25", "2026-10-27"]);
  assert.equal(R.latest([]), null); assert.equal(R.latest(null), null);
});

test("회신 늦음: 약속일이 기준일보다 지났을 때만 늦음. 당일은 아니고, 며칠 늦었는지 센다", () => {
  const list = [rep("2026-10-10", "2026-10-20")];
  assert.deepEqual(R.status(list, { today: "2026-10-19" }), { state: "waiting", last: list[0], promised: "2026-10-20", daysLeft: 1 });
  assert.equal(R.status(list, { today: "2026-10-20" }).state, "due-today");                         // 약속일 당일은 아직 늦음이 아니다
  const late = R.status(list, { today: "2026-10-23" });
  assert.equal(late.state, "late"); assert.equal(late.daysLate, 3); assert.equal(late.quiet, false);
  assert.equal(R.status(list, { today: "2026-11-02" }).daysLate, 13);                               // 달이 바뀌어도 날짜 차이로 센다
});

test("약속일이 여러 번 바뀌면 가장 최근 회신이 이긴다 (결정 2026-10-20)", () => {
  const list = [rep("2026-10-10", "2026-10-15"), rep("2026-10-16", "2026-10-30")];                  // 첫 약속은 지났지만 새 회신으로 미뤄졌다
  assert.equal(R.status(list, { today: "2026-10-20" }).state, "waiting");
  assert.equal(R.status(list, { today: "2026-10-31" }).state, "late");
});

test("최신 회신에 약속일이 없으면 늦음이 아니다. 입고 완료여도 아니다. 회신이 없으면 판정하지 않는다", () => {
  assert.equal(R.status([rep("2026-10-10", "2026-10-15"), rep("2026-10-16", "")], { today: "2026-10-30" }).state, "no-promise");
  assert.equal(R.status([rep("2026-10-10", "2026-10-15")], { today: "2026-10-30", received: true }).state, "done");
  assert.equal(R.status([], { today: "2026-10-30" }).state, "none");
  assert.equal(R.status([rep("2026-10-10", "2026-10-15")], {}).state, "none");                      // 기준일을 모르면 판정하지 않는다
  const dead = rep("2026-10-10", "2026-10-15", { deletedAt: "2026-10-11T00:00:00.000Z", deletedReason: "user" });
  assert.equal(R.status([dead], { today: "2026-10-30" }).state, "none");                           // 취소한 회신은 없는 것과 같다
});

test("조용함: 그날(기준일) 이후로 공급사에 연락했으면 조용하고, 다음 날 기준일이 지나면 다시 울린다 (결정 2026-10-20)", () => {
  const list = [rep("2026-10-10", "2026-10-20")];
  assert.equal(R.status(list, { today: "2026-10-23", contactedOn: "2026-10-23" }).quiet, true);
  assert.equal(R.status(list, { today: "2026-10-23", contactedOn: "2026-10-22" }).quiet, false);     // 어제 연락은 오늘을 조용하게 하지 않는다
  assert.equal(R.status(list, { today: "2026-10-24", contactedOn: "2026-10-23" }).quiet, false);     // 다음 날 다시 울림
  assert.equal(R.status(list, { today: "2026-10-23", contactedOn: "" }).quiet, false);
});

test("늦은 주문 목록: 조용하지 않은 것과 조용한 것을 나누고, 오래 늦은 순(같으면 주문번호 순)", () => {
  const items = [
    { no: "B", replies: [rep("2026-10-01", "2026-10-10")] },                                          // 13일
    { no: "A", replies: [rep("2026-10-01", "2026-10-10")] },                                          // 13일 (번호가 앞)
    { no: "C", replies: [rep("2026-10-01", "2026-10-20")] },                                          // 3일
    { no: "D", replies: [rep("2026-10-01", "2026-10-05")], contactedOn: "2026-10-23" },              // 조용
    { no: "E", replies: [rep("2026-10-01", "2026-10-05")], received: true },                         // 입고 완료
    { no: "F", replies: [rep("2026-10-01", "2026-11-30")] },                                          // 아직
    { no: "G", replies: [] },
  ];
  const r = R.lateOrders(items, "2026-10-23");
  assert.deepEqual(r.late.map(x => x.no + ":" + x.daysLate), ["A:13", "B:13", "C:3"]);
  assert.deepEqual(r.quiet.map(x => x.no), ["D"]);
  assert.deepEqual(R.lateOrders(null, "2026-10-23"), { late: [], quiet: [] });
});

// ---- 로컬 저장 형식 v3 (회신 목록) ----
let n = 0; const ids = () => "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
const T1 = "2026-10-19T09:00:00.000Z", T2 = "2026-10-19T10:00:00.000Z";

test("v3: 새 회신에 id·createdAt이 붙고, 같은 화면을 거듭 저장해도 복제되지 않는다", () => {
  const view = { ...clean(null), replies: { A: [{ date: "2026-10-10", promised: "2026-10-30", channel: "전화", note: "다음 주 도착", source: "manual", supplier: "가온산업" }] } };
  const s1 = Core.fromView(view, null, { now: T1, newId: ids });
  assert.equal(s1.schemaVersion, 3);
  assert.equal(s1.orderReplies.A.length, 1); assert.ok(s1.orderReplies.A[0].id); assert.equal(s1.orderReplies.A[0].createdAt, T1);
  const back = Core.toView(s1);
  assert.equal(back.replies.A[0].promised, "2026-10-30");
  const s2 = Core.fromView(back, s1, { now: T2, newId: ids });
  const s3 = Core.fromView(view, s2, { now: T2, newId: ids });                                      // id 없는 화면이 거듭 보내도
  assert.deepEqual(s3.orderReplies.A.map(e => e.id), s1.orderReplies.A.map(e => e.id));
  assert.equal(s3.orderReplies.A.filter(e => e.deletedAt).length, 0);
});

test("v3: 회신을 지우면 삭제 표시(user)만 남고 화면에서는 사라진다. 20건을 넘으면 오래된 것이 cap", () => {
  const s1 = Core.fromView({ ...clean(null), replies: { A: [{ date: "2026-10-10", channel: "메일" }] } }, null, { now: T1, newId: ids });
  const v = Core.toView(s1); delete v.replies.A;
  const s2 = Core.fromView(v, s1, { now: T2, newId: ids });
  assert.equal(s2.orderReplies.A[0].deletedAt, T2); assert.equal(s2.orderReplies.A[0].deletedReason, "user");
  assert.deepEqual(Core.toView(s2).replies, {});
  let s = null;
  for (let i = 0; i < 22; i++) { const vw = s ? Core.toView(s) : clean(null); vw.replies.B = (vw.replies.B || []).concat({ date: "2026-10-10", channel: "메일", note: "m" + i }); s = Core.fromView(vw, s, { now: T1, newId: ids }); }
  assert.equal(s.orderReplies.B.filter(e => !e.deletedAt).length, 20);
  assert.deepEqual([...new Set(s.orderReplies.B.filter(e => e.deletedAt).map(e => e.deletedReason))], ["cap"]);
});

test("v3: 화면이 회신을 모르는 채(예전 화면) 다른 값만 저장해도 회신은 지워지지 않는다 (mergeState)", () => {
  const P = require("../src/persist");
  const saved = { ...clean(null), replies: { A: [{ date: "2026-10-10", channel: "메일", id: "x1", createdAt: T1 }] } };
  const merged = P.mergeState(saved, { reasons: { A: "통관" } }, ["A"]);                           // current에 replies 없음
  assert.equal(merged.replies.A.length, 1);
  const cleared = P.mergeState(saved, { reasons: {}, replies: {} }, ["A"]);                         // 화면이 회신을 들고 있고 비웠다면 반영
  assert.deepEqual(cleared.replies, {});
});

test("v2 → v3: 기록은 그대로, 회신 목록은 빈 채로 더해지고, 여러 번 해도 같다", () => {
  const v2 = Core.fromView({ ...clean(null), informed: { A: [{ date: "2026-10-10", channel: "메일", status: "지연", due: "", note: "x" }] }, reasons: { A: "통관" } }, null, { now: T1, newId: ids });
  const old = { ...v2, schemaVersion: 2 }; delete old.orderReplies;
  const s3 = Core.migrateV2toV3(old);
  assert.equal(s3.schemaVersion, 3); assert.deepEqual(s3.orderReplies, {});
  assert.deepEqual(s3.informLog, v2.informLog); assert.deepEqual(s3.orderMeta, v2.orderMeta); assert.deepEqual(s3.cloudLink, v2.cloudLink);
  assert.deepEqual(Core.migrateV2toV3(s3), s3);
});

test("v3 복원: 서버에서 받은 회신도 로컬에 없는 id만 더해진다", () => {
  const local = Core.fromView({ ...clean(null), replies: { A: [{ date: "2026-10-10", channel: "메일" }] } }, null, { now: T1, newId: ids });
  const remote = Core.normalizeState({ ...Core.emptyState(), orderReplies: { A: [{ id: "srv-1", date: "2026-10-12", promised: "2026-10-30", channel: "전화", note: "", source: "manual", supplier: "", createdAt: T2 }] } });
  const r = Core.mergeRestored(local, remote, { now: T2 });
  assert.equal(r.added.orderReplies, 1);
  assert.equal(r.state.orderReplies.A.length, 2);
  assert.equal(Core.mergeRestored(r.state, remote, { now: T2 }).added.orderReplies, undefined);   // 한 번 더 해도 같다
});
