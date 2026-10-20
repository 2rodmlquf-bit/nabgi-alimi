// 저장 형식 v2 (src/store/core.js, ADR-0001, docs/erd.md): 공급사 연락·대체품·분납 기록도 안내 기록처럼
// id·만든 시각·삭제 표시(deletedAt + deletedReason)를 갖고, 클라우드 연결 정보(cloudLink)가 생긴다.
// 화면이 쓰는 뷰(view)의 모양은 그대로여야 한다. 여기서는 v2에서 새로 생긴 규칙과 v1 → v2 이전을 고정한다.
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../src/store/core");
const { clean } = require("../src/persist");

let n = 0;
const ids = () => "id-" + ++n;
const T1 = "2026-10-19T09:00:00.000Z", T2 = "2026-10-19T10:00:00.000Z", T3 = "2026-10-19T11:00:00.000Z";
const save = (view, prev, now = T1) => Core.fromView(view, prev, { now, newId: ids });
const V = extra => ({ ...clean(null), ...extra });
const ent = (date, extra) => ({ date, channel: "메일", status: "지연", due: "2026-09-24", note: "", ...extra });
const live = list => (list || []).filter(e => !e.deletedAt);
const gone = list => (list || []).filter(e => e.deletedAt);

test("빈 상태: v2 모양이다 (legacy 대신 연락 기록·연락함 표시·대체품·분납·cloudLink)", () => {
  const s = Core.emptyState();
  assert.equal(s.schemaVersion, 2);
  ["informLog", "quickNotes", "orderMeta", "contactLog", "contactMarks", "substChecks", "scheduleEntries"].forEach(k => assert.deepEqual(s[k], {}, k));
  assert.equal("legacy" in s, false);
  assert.deepEqual(s.cloudLink, { enabled: false, project: "", ownerUserId: "", linkedAt: "", lastSyncedAt: "" });
  assert.deepEqual(Core.toView(s), clean(null));                               // 화면이 보는 빈 뷰는 예전과 같다
});

test("버전 판별: 없으면 v0, 1, 2, 3 이상은 미래 버전, 모양이 아니면 잘못된 파일", () => {
  assert.equal(Core.SCHEMA_VERSION, 2);
  assert.equal(Core.detectVersion({}), 0);
  assert.equal(Core.detectVersion({ schemaVersion: 1 }), 1);
  assert.equal(Core.detectVersion({ schemaVersion: 2 }), 2);
  assert.equal(Core.detectVersion({ schemaVersion: 3 }), "future");
  assert.equal(Core.detectVersion({ schemaVersion: 99 }), "future");
  ["1", 0, -1, 1.5, null].forEach(v => assert.equal(Core.detectVersion({ schemaVersion: v }), "invalid", String(v)));
  assert.equal(Core.detectVersion([]), "invalid");
  assert.equal(Core.detectVersion("x"), "invalid");
});

// ---------- 되돌아보기: 화면이 id 없는 기록을 거듭 보내도 복제되지 않는다 (v0.5.0까지 안내 기록에 있던 문제) ----------

test("id·시각이 없는 안내 기록을 같은 내용으로 거듭 저장해도 한 건이고, 만든 시각이 바뀌지 않으며, 삭제 표시가 쌓이지 않는다", () => {
  const e = ent("2026-10-12");                                                  // 화면이 만든 기록: id·createdAt 없음
  let s = save(V({ informed: { A: [{ ...e }] } }), null, T1);
  s = save(V({ informed: { A: [{ ...e }] } }), s, T2);
  s = save(V({ informed: { A: [{ ...e }] } }), s, T3);
  assert.equal(s.informLog.A.length, 1);
  assert.equal(s.informLog.A[0].createdAt, T1);
  assert.equal(gone(s.informLog.A).length, 0);
});

test("같은 내용의 기록이 정말 두 건이면 두 건으로 남고, 그중 하나를 지우면 한 건에만 삭제 표시가 붙는다", () => {
  const e = ent("2026-10-12");
  let s = save(V({ informed: { A: [{ ...e }, { ...e }] } }), null, T1);
  s = save(V({ informed: { A: [{ ...e }, { ...e }] } }), s, T2);
  assert.equal(live(s.informLog.A).length, 2);
  s = save(V({ informed: { A: [{ ...e }] } }), s, T3);
  assert.equal(live(s.informLog.A).length, 1);
  assert.equal(gone(s.informLog.A).length, 1);
});

// ---------- 삭제 이유: 사용자가 취소한 것과 한도로 밀린 것을 구별한다 ----------

test("취소(뷰에서 빠짐)는 deletedReason 'user', 한도(주문당 50건)로 밀린 것은 'cap'이다", () => {
  let s = save(V({ informed: { A: [ent("2026-10-10"), ent("2026-10-11")] } }), null, T1);
  const v = Core.toView(s); v.informed.A.pop();
  s = save(v, s, T2);
  assert.equal(s.informLog.A[1].deletedReason, "user");
  let big = null;
  for (let i = 0; i < 52; i++) {
    const view = big ? Core.toView(big) : clean(null);
    view.informed.B = (view.informed.B || []).concat(ent("2026-10-12", { note: "m" + i }));
    big = save(view, big, T3);
  }
  assert.equal(live(big.informLog.B).length, 50);
  const capped = gone(big.informLog.B);
  assert.equal(capped.length, 2);
  assert.ok(capped.every(e => e.deletedReason === "cap"), JSON.stringify(capped.map(e => e.deletedReason)));
  assert.deepEqual(capped.map(e => e.note), ["m0", "m1"]);                       // 가장 오래된 것부터
});

test("화면이 한도를 넘는 목록(51건)을 한 번에 보내도 넘친 오래된 기록은 'cap'으로 표시된다 (보내기 전에 잘려 취소처럼 보이지 않는다)", () => {
  let s = save(V({ informed: { A: Array.from({ length: 50 }, (_, i) => ent("2026-10-12", { note: "o" + i })) } }), null, T1);
  const v = Core.toView(s); v.informed.A.push(ent("2026-10-12", { note: "새것" }));
  s = save(v, s, T2);
  assert.equal(live(s.informLog.A).length, 50);
  assert.equal(gone(s.informLog.A)[0].deletedReason, "cap");
  assert.equal(gone(s.informLog.A)[0].note, "o0");
});

test("삭제 표시에 이유가 없거나 모르는 값이면 'user'로 본다 (예전 파일의 삭제 표시는 이유를 몰랐다)", () => {
  const raw = { schemaVersion: 2, informLog: { A: [
    { id: "a", date: "2026-10-10", channel: "메일", status: "지연", due: "", note: "", createdAt: T1, deletedAt: T2 },
    { id: "b", date: "2026-10-10", channel: "메일", status: "지연", due: "", note: "", createdAt: T1, deletedAt: T2, deletedReason: "cap" },
    { id: "c", date: "2026-10-10", channel: "메일", status: "지연", due: "", note: "", createdAt: T1, deletedAt: T2, deletedReason: "엉뚱" },
    { id: "d", date: "2026-10-10", channel: "메일", status: "지연", due: "", note: "", createdAt: T1, deletedReason: "user" },
  ] } };
  const s = Core.normalizeState(raw);
  assert.deepEqual(s.informLog.A.map(e => e.deletedReason), ["user", "cap", "user", undefined]);   // 삭제 시각이 없으면 이유도 없다
});

// ---------- 공급사 연락 기록 ----------

test("공급사 연락 기록: 새 기록에 id·createdAt이 붙고 뷰로 돌아오며, 같은 뷰를 거듭 저장해도 복제되지 않는다", () => {
  const log = [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "납기 문의" }, { date: "2026-10-13", kind: "reply", channel: "전화", promised: "2026-10-17", note: "구두 약속" }];
  let s = save(V({ contactLog: { 가온산업: log.map(x => ({ ...x })) } }), null, T1);
  assert.equal(s.contactLog.가온산업.length, 2);
  s.contactLog.가온산업.forEach(e => { assert.ok(e.id); assert.equal(e.createdAt, T1); });
  const back = Core.toView(s);
  assert.equal(back.contactLog.가온산업[0].id, s.contactLog.가온산업[0].id);
  s = save(V({ contactLog: { 가온산업: log.map(x => ({ ...x })) } }), s, T2);                // id 없이 다시 보내도
  s = save(back, s, T3);                                                                       // id를 들고 와도
  assert.equal(s.contactLog.가온산업.length, 2);
  assert.equal(gone(s.contactLog.가온산업).length, 0);
  assert.equal(s.contactLog.가온산업[0].createdAt, T1);
});

test("공급사 연락 기록 취소(마지막 기록 빼기)는 삭제 표시(user)가 되고, 모두 빼면 뷰에서 그 공급사 항목이 없다", () => {
  const log = [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "a" }, { date: "2026-10-13", kind: "attempt", channel: "전화", promised: "", note: "b" }];
  let s = save(V({ contactLog: { X: log } }), null, T1);
  const v = Core.toView(s); v.contactLog.X.pop();
  s = save(v, s, T2);
  assert.equal(gone(s.contactLog.X).length, 1);
  assert.equal(gone(s.contactLog.X)[0].deletedReason, "user");
  assert.equal(gone(s.contactLog.X)[0].note, "b");
  const v2 = Core.toView(s); delete v2.contactLog.X;
  s = save(v2, s, T3);
  assert.equal(live(s.contactLog.X).length, 0);
  assert.deepEqual(Core.toView(s).contactLog, {});
});

test("공급사 연락 기록은 공급사당 살아 있는 것 200건까지고 넘친 오래된 것은 'cap'이다", () => {
  let s = null;
  for (let i = 0; i < 3; i++) {
    const view = s ? Core.toView(s) : clean(null);
    view.contactLog.X = (view.contactLog.X || []).concat(Array.from({ length: 80 }, (_, k) => ({ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "n" + (i * 80 + k) })));
    s = save(view, s, T1);
  }
  assert.equal(live(s.contactLog.X).length, 200);
  assert.equal(gone(s.contactLog.X).length, 40);
  assert.ok(gone(s.contactLog.X).every(e => e.deletedReason === "cap"));
});

// ---------- 연락함 표시 ----------

test("연락함 표시: 날짜가 바뀔 때만 updatedAt이 갱신되고, 뷰에서 빼면 사라진다", () => {
  let s = save(V({ contacted: { 가온산업: "2026-10-12" } }), null, T1);
  assert.deepEqual(s.contactMarks.가온산업, { date: "2026-10-12", updatedAt: T1 });
  s = save(Core.toView(s), s, T2);
  assert.equal(s.contactMarks.가온산업.updatedAt, T1);
  const v = Core.toView(s); v.contacted.가온산업 = "2026-10-13";
  s = save(v, s, T3);
  assert.deepEqual(s.contactMarks.가온산업, { date: "2026-10-13", updatedAt: T3 });
  const v2 = Core.toView(s); delete v2.contacted.가온산업;
  s = save(v2, s, T3);
  assert.deepEqual(s.contactMarks, {});
  assert.deepEqual(Core.toView(s).contacted, {});
});

// ---------- 대체품 확인: 상태가 바뀔 때마다 새 행, 현재 = 삭제 표시 없는 가장 최근 행 ----------

const sub = (state, extra) => ({ state, note: "", supItem: "", supSpec: "", supQty: "", source: "직접", date: "2026-10-12", ...extra });

test("대체품 확인: 처음 저장하면 한 행이 생기고, 같은 값을 다시 저장해도 행이 늘지 않는다", () => {
  let s = save(V({ subst: { A: sub("의심", { note: "규격이 다름" }) } }), null, T1);
  assert.equal(s.substChecks.A.length, 1);
  assert.ok(s.substChecks.A[0].id);
  assert.equal(s.substChecks.A[0].createdAt, T1);
  s = save(Core.toView(s), s, T2);
  s = save(V({ subst: { A: sub("의심", { note: "규격이 다름" }) } }), s, T3);
  assert.equal(s.substChecks.A.length, 1);
});

test("대체품 확인: 상태가 바뀌면 새 행이 쌓이고(이력), 뷰에는 가장 최근 상태가 보인다", () => {
  let s = save(V({ subst: { A: sub("의심") } }), null, T1);
  s = save(V({ subst: { A: sub("확인요청중", { note: "연구원에게 문의" }) } }), s, T2);
  s = save(V({ subst: { A: sub("승인", { note: "승인받음" }) } }), s, T3);
  assert.deepEqual(s.substChecks.A.map(e => e.state), ["의심", "확인요청중", "승인"]);
  assert.equal(live(s.substChecks.A).length, 3);                                  // 이력은 모두 살아 있다
  const v = Core.toView(s);
  assert.equal(v.subst.A.state, "승인");
  assert.equal(v.subst.A.note, "승인받음");
});

test("대체품 확인: 뷰에서 빼면('해당 없음') 그 주문의 살아 있는 행이 모두 삭제 표시(user)가 된다", () => {
  let s = save(V({ subst: { A: sub("의심") } }), null, T1);
  s = save(V({ subst: { A: sub("승인") } }), s, T2);
  s = save(clean(null), s, T3);
  assert.equal(live(s.substChecks.A).length, 0);
  assert.ok(gone(s.substChecks.A).every(e => e.deletedReason === "user" && e.deletedAt === T3));
  assert.deepEqual(Core.toView(s).subst, {});
  s = save(V({ subst: { A: sub("거절") } }), s, T3);                              // 그 뒤 다시 정하면 새 행
  assert.equal(Core.toView(s).subst.A.state, "거절");
});

// ---------- 분납 일정 ----------

test("분납 일정: 줄마다 id가 붙고, 같은 일정을 다시 저장해도 복제되지 않으며, 일정을 고치면 이전 줄에 삭제 표시가 붙는다", () => {
  let s = save(V({ schedule: { A: [{ date: "2026-10-20", qty: "4" }, { date: "2026-10-30", qty: "6" }] } }), null, T1);
  assert.equal(s.scheduleEntries.A.length, 2);
  s.scheduleEntries.A.forEach(e => assert.ok(e.id));
  s = save(V({ schedule: { A: [{ date: "2026-10-20", qty: "4" }, { date: "2026-10-30", qty: "6" }] } }), s, T2);   // 화면은 통째로 다시 보낸다
  assert.equal(s.scheduleEntries.A.length, 2);
  assert.equal(gone(s.scheduleEntries.A).length, 0);
  s = save(V({ schedule: { A: [{ date: "2026-10-20", qty: "4" }, { date: "2026-11-05", qty: "6" }] } }), s, T3);   // 두 번째 줄의 날짜를 고침
  assert.equal(live(s.scheduleEntries.A).length, 2);
  assert.equal(gone(s.scheduleEntries.A).length, 1);
  assert.equal(gone(s.scheduleEntries.A)[0].date, "2026-10-30");
  assert.equal(gone(s.scheduleEntries.A)[0].deletedReason, "user");
  assert.deepEqual(Core.toView(s).schedule.A.map(e => e.date), ["2026-10-20", "2026-11-05"]);
});

// ---------- 클라우드 연결 정보(cloudLink)는 뷰에 없고 저장할 때 보존된다 ----------

test("cloudLink: 화면이 모르는 영역이라 뷰에는 없고, 저장해도 이전 값이 그대로 이어진다. 깨진 값은 정리된다", () => {
  const link = { enabled: true, project: "practice", ownerUserId: "51986180-2628-4fdc-a3de-62757e867a62", linkedAt: T1, lastSyncedAt: T2 };
  let s = { ...Core.emptyState(), cloudLink: link };
  assert.equal("cloudLink" in Core.toView(s), false);
  s = save(V({ reasons: { A: "통관" } }), s, T3);
  assert.deepEqual(s.cloudLink, link);
  const messy = Core.normalizeState({ schemaVersion: 2, cloudLink: { enabled: "yes", project: "엉뚱", ownerUserId: 5, linkedAt: 7, lastSyncedAt: null } });
  assert.deepEqual(messy.cloudLink, { enabled: false, project: "", ownerUserId: "", linkedAt: "", lastSyncedAt: "" });
});

// ---------- v1 → v2 이전 ----------

const V1 = {
  schemaVersion: 1, savedAt: T1,
  informLog: { A: [
    { id: "i1", date: "2026-10-10", channel: "전화", status: "지연", due: "2026-09-24", note: "먼저", createdAt: "2026-10-10T12:00:00.000Z" },
    { id: "i2", date: "2026-10-11", channel: "메일", status: "지연", due: "2026-09-24", note: "취소함", createdAt: "2026-10-11T12:00:00.000Z", deletedAt: T2 },
  ] },
  quickNotes: { A: [{ id: "q1", text: "전화로 들음", createdAt: T1 }, { id: "q2", text: "지운 메모", createdAt: T1, deletedAt: T2 }] },
  orderMeta: { A: { reason: "통관", causeOverride: "통관·서류", edited: { from: "2026-09-24", to: "2026-10-23" }, updatedAt: T1 } },
  settings: { notice: { template: "공지형", alt: "", signature: "구매팀" }, soonRules: "필터=3", reAlertDays: 5, updatedAt: T1 },
  legacy: {
    contacted: { 가온산업: "2026-10-12" },
    contactLog: { 가온산업: [{ date: "2026-10-11", kind: "attempt", channel: "메일", promised: "", note: "문의" }, { date: "2026-10-12", kind: "reply", channel: "전화", promised: "2026-10-17", note: "구두" }] },
    subst: { A: { state: "승인", note: "승인받음", supItem: "6204-2RS", supSpec: "6204-2RS", supQty: "10", source: "직접", date: "2026-10-12" } },
    schedule: { A: [{ date: "2026-10-20", qty: "4" }, { date: "2026-10-30", qty: "6" }] },
  },
};

test("v1 → v2: 안내 기록·메모·주문 메타·설정이 그대로 이어지고, id는 유지되고, 예전 삭제 표시는 이유 'user'가 된다", () => {
  const s = Core.migrateV1toV2(V1, { now: T3, newId: ids });
  assert.equal(s.schemaVersion, 2);
  assert.deepEqual(s.informLog.A.map(e => e.id), ["i1", "i2"]);
  assert.equal(s.informLog.A[0].createdAt, "2026-10-10T12:00:00.000Z");
  assert.equal(s.informLog.A[0].deletedReason, undefined);
  assert.equal(s.informLog.A[1].deletedAt, T2);
  assert.equal(s.informLog.A[1].deletedReason, "user");
  assert.deepEqual(s.quickNotes.A.map(e => e.id), ["q1", "q2"]);
  assert.equal(s.quickNotes.A[1].deletedReason, "user");
  assert.deepEqual(s.orderMeta, V1.orderMeta);
  assert.equal(s.settings.reAlertDays, 5);
  assert.equal(s.settings.soonRules, "필터=3");
});

test("v1 → v2: legacy 기록에 id와 만든 시각이 붙고, 화면이 보는 뷰는 이전 전과 똑같다 (데이터를 잃지 않는다)", () => {
  const before = clean({ ...V1.legacy });                                         // v1에서 화면이 보던 legacy 부분
  const s = Core.migrateV1toV2(V1, { now: T3, newId: ids });
  s.contactLog.가온산업.forEach(e => { assert.ok(e.id); assert.match(e.createdAt, /^2026-10-1[12]T12:00:00\.000Z$/); });   // 기록한 날짜의 정오
  assert.deepEqual(s.contactMarks.가온산업, { date: "2026-10-12", updatedAt: "2026-10-12T12:00:00.000Z" });
  assert.equal(s.substChecks.A.length, 1);
  assert.equal(s.substChecks.A[0].createdAt, "2026-10-12T12:00:00.000Z");
  s.scheduleEntries.A.forEach(e => assert.ok(e.id));
  const view = Core.toView(s);
  assert.deepEqual(view.contacted, before.contacted);
  assert.deepEqual(view.subst, before.subst);
  assert.deepEqual(view.contactLog.가온산업.map(({ id, createdAt, ...r }) => r), before.contactLog.가온산업);
  assert.deepEqual(view.schedule.A.map(({ id, createdAt, ...r }) => r), before.schedule.A);
});

test("v1 → v2: 두 번 해도 같고(멱등), 이전한 결과를 다시 정리해도 바뀌지 않으며, 입력은 바뀌지 않는다", () => {
  const input = JSON.parse(JSON.stringify(V1));
  const s1 = Core.migrateV1toV2(input, { now: T3, newId: ids });
  assert.deepEqual(input, V1);
  assert.deepEqual(Core.normalizeState(s1), s1);
  const strip = st => JSON.parse(JSON.stringify(st, (k, v) => (k === "id" ? undefined : v)));
  const s2 = Core.migrateV1toV2(JSON.parse(JSON.stringify(V1)), { now: T3, newId: ids });
  assert.deepEqual(strip(s2), strip(s1));
});

test("v1 → v2: 깨진 항목(엉뚱한 타입, 모르는 필드)은 버릴 것은 버리고 멈추지 않는다. 내용이 없으면 v2 빈 상태가 된다", () => {
  const s = Core.migrateV1toV2({ schemaVersion: 1, legacy: { contacted: { x: 5 }, contactLog: { y: "엉뚱" }, subst: { z: { state: "모름" } }, schedule: { w: [{ date: "아님" }] } }, informLog: "x" }, { now: T3, newId: ids });
  assert.deepEqual(s.contactMarks, {}); assert.deepEqual(s.contactLog, {}); assert.deepEqual(s.substChecks, {}); assert.deepEqual(s.scheduleEntries, {}); assert.deepEqual(s.informLog, {});
  assert.deepEqual(Core.migrateV1toV2({ schemaVersion: 1 }, { now: T3, newId: ids }).contactLog, {});
});

test("v0 → v2: 예전(v0) 파일도 한 번에 v2가 되고, legacy 기록에 id가 붙는다", () => {
  const v0 = { edited: {}, reasons: { A: "통관" }, causeOverride: {}, notice: null, contacted: { 가온산업: "2026-10-12" },
    contactLog: { 가온산업: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "문의" }] }, subst: {}, schedule: {}, soonRules: "필터=3",
    informed: { A: [{ date: "2026-10-10", channel: "메일", status: "지연", due: "2026-09-24", note: "" }] } };
  const s = Core.migrateV0toV2(v0, { now: T3, newId: ids });
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.informLog.A[0].createdAt, "2026-10-10T12:00:00.000Z");
  assert.ok(s.contactLog.가온산업[0].id);
  assert.equal(s.contactLog.가온산업[0].createdAt, "2026-10-12T12:00:00.000Z");
  assert.equal(s.contactMarks.가온산업.date, "2026-10-12");
  assert.equal(s.orderMeta.A.reason, "통관");
});

test("뷰의 모양은 v1과 같다: 화면 코드가 쓰는 키가 그대로이고 legacy 키는 새로 생기지 않는다", () => {
  const s = save(V({ contacted: { X: "2026-10-12" }, schedule: { A: [{ date: "2026-10-20", qty: "1" }] }, subst: { A: sub("의심") }, contactLog: { X: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "" }] } }), null, T1);
  const v = Core.toView(s);
  assert.deepEqual(Object.keys(v).sort(), Object.keys(clean(null)).sort());
});
