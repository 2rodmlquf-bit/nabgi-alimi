// 저장 모델 v1과 화면용 뷰의 변환 (src/store/core.js). 디스크·DB와 무관한 순수 함수라서 여기서 규칙을 모두 고정한다.
// 뷰(view) = 화면이 지금까지 쓰던 모양 { edited, reasons, causeOverride, notice, contacted, contactLog, informed, subst, schedule, soonRules }
// 상태(state) = 저장하는 v1 모양 { schemaVersion, savedAt, informLog, quickNotes, orderMeta, settings, legacy }
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../src/store/core");
const { clean } = require("../src/persist");

let n = 0;
const ids = () => "id-" + ++n;                       // 테스트용 id 생성기 (결정적)
const T1 = "2026-10-19T09:00:00.000Z", T2 = "2026-10-19T10:00:00.000Z", T3 = "2026-10-19T11:00:00.000Z";
const ent = (date, extra) => ({ date, channel: "메일", status: "지연", due: "2026-09-24", note: "", ...extra });

test("빈 상태: v1 모양이고, 뷰로 바꾸면 예전 빈 저장본(clean(null))과 같다", () => {
  const s = Core.emptyState();
  assert.equal(s.schemaVersion, 1);
  assert.deepEqual(s.informLog, {}); assert.deepEqual(s.quickNotes, {}); assert.deepEqual(s.orderMeta, {});
  assert.deepEqual(Core.toView(s), clean(null));
});

test("뷰 → 상태: 새 안내 기록에 id와 createdAt이 붙고, 같은 뷰를 다시 저장해도 id가 그대로다", () => {
  const view = { ...clean(null), informed: { A: [ent("2026-10-10"), ent("2026-10-11", { channel: "전화" })] } };
  const s1 = Core.fromView(view, null, { now: T1, newId: ids });
  assert.equal(s1.informLog.A.length, 2);
  s1.informLog.A.forEach(e => { assert.ok(e.id); assert.equal(e.createdAt, T1); assert.equal(e.deletedAt, undefined); });
  assert.notEqual(s1.informLog.A[0].id, s1.informLog.A[1].id);
  // 화면이 id를 그대로 들고 있다가 다시 저장한다
  const back = Core.toView(s1);
  const s2 = Core.fromView(back, s1, { now: T2, newId: ids });
  assert.deepEqual(s2.informLog.A.map(e => e.id), s1.informLog.A.map(e => e.id));     // id 유지
  assert.deepEqual(s2.informLog.A.map(e => e.createdAt), [T1, T1]);                   // 만든 시각 유지
  assert.equal(s2.savedAt, T2);
});

test("안내 기록 취소: 뷰에서 빠진 기록은 지워지지 않고 deletedAt 표시가 남는다 (삭제 흔적)", () => {
  const s1 = Core.fromView({ ...clean(null), informed: { A: [ent("2026-10-10"), ent("2026-10-11")] } }, null, { now: T1, newId: ids });
  const v = Core.toView(s1);
  v.informed.A.pop();                                                  // 화면의 '마지막 기록 취소'
  const s2 = Core.fromView(v, s1, { now: T2, newId: ids });
  assert.equal(s2.informLog.A.length, 2);                              // 상태에는 둘 다 있다
  assert.equal(s2.informLog.A[0].deletedAt, undefined);
  assert.equal(s2.informLog.A[1].deletedAt, T2);                       // 두 번째에만 삭제 시각
  assert.equal(Core.toView(s2).informed.A.length, 1);                  // 뷰에는 살아 있는 것만 보인다
  const s3 = Core.fromView(Core.toView(s2), s2, { now: T3, newId: ids });
  assert.equal(s3.informLog.A[1].deletedAt, T2);                       // 다시 저장해도 삭제 시각은 처음 값 그대로
});

test("안내 기록이 모두 취소되면 뷰에는 그 주문 항목이 없다", () => {
  const s1 = Core.fromView({ ...clean(null), informed: { A: [ent("2026-10-10")] } }, null, { now: T1, newId: ids });
  const v = Core.toView(s1); delete v.informed.A;
  const s2 = Core.fromView(v, s1, { now: T2, newId: ids });
  assert.equal(s2.informLog.A[0].deletedAt, T2);
  assert.deepEqual(Core.toView(s2).informed, {});
});

test("주문당 살아 있는 안내 기록은 최근 50건까지다. 넘친 오래된 기록은 삭제 표시가 되고, 삭제 표시는 100건까지만 보관한다", () => {
  let s = null;
  for (let i = 0; i < 60; i++) {
    const v = s ? Core.toView(s) : clean(null);
    v.informed.A = (v.informed.A || []).concat(ent("2026-10-" + String((i % 28) + 1).padStart(2, "0"), { note: "m" + i }));
    s = Core.fromView(v, s, { now: T1, newId: ids });
  }
  const live = s.informLog.A.filter(e => !e.deletedAt);
  assert.equal(live.length, 50);
  assert.equal(live[0].note, "m10");                                   // 오래된 10건은 삭제 표시로 넘어갔다
  assert.equal(live[49].note, "m59");
  assert.equal(s.informLog.A.filter(e => e.deletedAt).length, 10);
  // 삭제 표시 상한
  const big = { A: Array.from({ length: 130 }, (_, i) => ({ id: "t" + i, date: "2026-10-01", channel: "메일", status: "지연", due: "x", note: "", createdAt: T1, deletedAt: T1 })) };
  const st = Core.normalizeState({ schemaVersion: 1, informLog: big });
  assert.equal(st.informLog.A.length, 100);
  assert.equal(st.informLog.A[0].id, "t30");                           // 가장 오래된 30건이 잘렸다
});

test("주문 메타: 사유·원인 지정·납기 변경은 orderMeta에 모이고, 바뀐 주문만 updatedAt이 갱신된다", () => {
  const view = { ...clean(null), reasons: { A: "통관 서류 보완", B: "재고 없음" }, causeOverride: { A: "통관·서류" }, edited: { A: { from: "2026-09-24", to: "2026-10-23" } } };
  const s1 = Core.fromView(view, null, { now: T1, newId: ids });
  assert.deepEqual(s1.orderMeta.A, { reason: "통관 서류 보완", causeOverride: "통관·서류", edited: { from: "2026-09-24", to: "2026-10-23" }, updatedAt: T1 });
  assert.deepEqual(s1.orderMeta.B, { reason: "재고 없음", updatedAt: T1 });
  const v2 = Core.toView(s1); v2.reasons.B = "재고 없음 (재확인)";
  const s2 = Core.fromView(v2, s1, { now: T2, newId: ids });
  assert.equal(s2.orderMeta.A.updatedAt, T1);                          // 안 바뀐 주문은 그대로
  assert.equal(s2.orderMeta.B.updatedAt, T2);                          // 바뀐 주문만 갱신
  assert.deepEqual(Core.toView(s2).reasons, { A: "통관 서류 보완", B: "재고 없음 (재확인)" });
  const v3 = Core.toView(s2); delete v3.reasons.B;                     // 사유를 지우면 메타에서 빠진다
  assert.equal(Core.fromView(v3, s2, { now: T3, newId: ids }).orderMeta.B, undefined);
});

test("설정: 안내문 선택과 품목별 임박 기준은 settings에 들어가고, 바뀔 때만 updatedAt이 갱신된다", () => {
  const view = { ...clean(null), notice: { template: "공지형", alt: "", signature: "홍길동" }, soonRules: "필터=3" };
  const s1 = Core.fromView(view, null, { now: T1, newId: ids });
  assert.deepEqual(s1.settings, { notice: { template: "공지형", alt: "", signature: "홍길동" }, soonRules: "필터=3", updatedAt: T1 });
  assert.equal(Core.fromView(Core.toView(s1), s1, { now: T2, newId: ids }).settings.updatedAt, T1);
  const v2 = Core.toView(s1); v2.soonRules = "필터=5";
  assert.equal(Core.fromView(v2, s1, { now: T2, newId: ids }).settings.updatedAt, T2);
});

test("범위 밖 기능(공급사 연락 기록, 대체품, 분납 일정)은 구조를 바꾸지 않고 그대로 보존한다", () => {
  const view = { ...clean(null), contacted: { 가온산업: "2026-10-12" }, contactLog: { 가온산업: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "" }] }, subst: { A: { state: "의심", note: "", supItem: "", supSpec: "", supQty: "", source: "직접", date: "2026-10-12" } }, schedule: { A: [{ date: "2026-10-30", qty: "5" }] } };
  const s = Core.fromView(view, null, { now: T1, newId: ids });
  assert.deepEqual(Object.keys(s.legacy).sort(), ["contactLog", "contacted", "schedule", "subst"]);
  assert.deepEqual(Core.toView(s), clean(view));
});

test("왕복: 뷰 → 상태 → 뷰는 id·createdAt을 빼면 같다 (사용자 데이터를 잃지 않는다)", () => {
  const view = { ...clean(null),
    informed: { A: [ent("2026-10-10", { note: "전화로 설명" })], B: [ent("2026-10-11", { status: "확인필요", due: "" })] },
    reasons: { A: "통관" }, causeOverride: { A: "통관·서류" }, edited: { A: { from: "a", to: "b" } },
    notice: { template: "사과형", alt: "대안", signature: "서명" }, soonRules: "필터=3\n장갑=3", contacted: { s: "2026-10-12" } };
  const back = Core.toView(Core.fromView(view, null, { now: T1, newId: ids }));
  const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === "id" || k === "createdAt" ? undefined : x)));
  assert.deepEqual(strip(back), strip(clean(view)));
});

test("뷰를 변환해도 입력은 바뀌지 않는다", () => {
  const view = { ...clean(null), informed: { A: [ent("2026-10-10")] }, reasons: { A: "x" } };
  const frozen = JSON.stringify(view);
  Core.fromView(view, null, { now: T1, newId: ids });
  assert.equal(JSON.stringify(view), frozen);
});

// ---- 마이그레이션 v0 -> v1 ----
// 실제 저장 파일(2026-10-19 백업)과 같은 모양: schemaVersion 없음, 안내 기록(informed) 기능 이전 버전이라 informed도 없다
const V0_REAL = { edited: {}, reasons: {}, causeOverride: {}, notice: { template: "사과형", alt: "", signature: "" },
  contacted: { 가온산업: "2026-10-12", 바다물산: "2026-10-12" },
  contactLog: { 가온산업: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "" }] },
  subst: {}, schedule: {}, soonRules: "필터=3\n그리스=3" };

test("마이그레이션: 실제 저장 파일 모양(v0)이 v1이 되고, 뷰로 바꾸면 내용이 그대로다", () => {
  const s = Core.migrateV0toV1(V0_REAL, { now: T1, newId: ids });
  assert.equal(s.schemaVersion, 1);
  assert.deepEqual(Core.toView(s), clean(V0_REAL));
  assert.deepEqual(s.informLog, {});                                    // 예전 파일에는 안내 기록이 없었다
});

test("마이그레이션: 안내 기록이 있는 v0는 기록마다 id가 붙고 createdAt은 기록한 날짜가 된다", () => {
  const v0 = { ...V0_REAL, informed: { A: [ent("2026-10-10"), ent("2026-10-12", { channel: "전화" })], B: [ent("2026-10-11")] } };
  const s = Core.migrateV0toV1(v0, { now: T3, newId: ids });
  assert.equal(s.informLog.A.length, 2);
  assert.deepEqual(s.informLog.A.map(e => e.createdAt), ["2026-10-10T12:00:00.000Z", "2026-10-12T12:00:00.000Z"]);
  assert.equal(new Set([...s.informLog.A, ...s.informLog.B].map(e => e.id)).size, 3);   // id는 모두 다르다
  assert.deepEqual(Core.toView(s).informed.A.map(e => e.channel), ["메일", "전화"]);
});

test("마이그레이션: 깨진 v0(엉뚱한 타입, 모르는 필드)는 버릴 것은 버리고 멈추지 않는다", () => {
  const s = Core.migrateV0toV1({ informed: "x", reasons: [1, 2], notice: 5, 엉뚱한: 1, contacted: { a: "2026-10-12", b: 3 } }, { now: T1, newId: ids });
  assert.deepEqual(Core.toView(s).contacted, { a: "2026-10-12" });
  assert.deepEqual(s.informLog, {});
  assert.deepEqual(Core.migrateV0toV1(null, { now: T1, newId: ids }).informLog, {});
});

// ---- 버전 판별과 v1 검증 ----
test("버전 판별: 없으면 v0, 1이면 v1, 더 크면 미래 버전, 배열·문자열은 잘못된 파일", () => {
  assert.equal(Core.detectVersion({}), 0);
  assert.equal(Core.detectVersion({ reasons: {} }), 0);
  assert.equal(Core.detectVersion({ schemaVersion: 1 }), 1);
  assert.equal(Core.detectVersion({ schemaVersion: 2 }), "future");
  assert.equal(Core.detectVersion({ schemaVersion: 99 }), "future");
  ["x", 3, null, [], undefined].forEach(v => assert.equal(Core.detectVersion(v), "invalid", String(v)));
  assert.equal(Core.detectVersion({ schemaVersion: "1" }), "invalid");
  assert.equal(Core.detectVersion({ schemaVersion: 0 }), "invalid");
});

test("v1 검증: 깨진 기록은 버리고 정상 기록은 남기며, 이미 정상인 상태는 바뀌지 않는다 (멱등)", () => {
  const good = Core.fromView({ ...clean(null), informed: { A: [ent("2026-10-10")] }, reasons: { A: "x" } }, null, { now: T1, newId: ids });
  assert.deepEqual(Core.normalizeState(good), good);
  const messy = Core.normalizeState({ schemaVersion: 1, informLog: { A: [{ id: "k", date: "2026-10-10", channel: "메일", status: "지연", due: "x", note: "", createdAt: T1 }, { id: "", date: "bad" }, null, { id: "z", date: "2026-10-10", channel: "비둘기", status: "엉뚱" }], B: "x" }, orderMeta: { C: { reason: 5 }, D: { reason: "ok", updatedAt: T1 } }, settings: "x" });
  assert.deepEqual(messy.informLog.A.map(e => e.id), ["k"]);
  assert.equal(messy.informLog.B, undefined);
  assert.equal(messy.orderMeta.C, undefined);
  assert.equal(messy.orderMeta.D.reason, "ok");
  assert.deepEqual(messy.settings, { notice: null, soonRules: null, updatedAt: "" });
});

test("크기 상한: 저장 글자 수가 2,000,000자를 넘으면 거부한다", () => {
  assert.equal(Core.MAX_CHARS, 2000000);
  const small = Core.emptyState();
  assert.equal(Core.exceedsLimit(small), false);
  const huge = Core.fromView({ ...clean(null), reasons: { X: "a".repeat(2100000) } }, null, { now: T1, newId: ids });
  assert.equal(Core.exceedsLimit(huge), true);
});

test("quickNotes: 빠른 메모(Phase 3) 자리는 지금도 저장·검증되고, 뷰가 모르는 동안에는 이전 값을 그대로 둔다", () => {
  const prev = { ...Core.emptyState(), quickNotes: { A: [{ id: "n1", text: "전화로 들음", createdAt: T1 }] } };
  const s = Core.fromView({ ...clean(null), reasons: { A: "x" } }, prev, { now: T2, newId: ids });
  assert.deepEqual(s.quickNotes, prev.quickNotes);
  assert.deepEqual(Core.normalizeState(prev).quickNotes.A.map(x => x.text), ["전화로 들음"]);
});
