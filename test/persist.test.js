const test = require("node:test");
const assert = require("node:assert");
const { clean, applySavedDue, mergeState, counts } = require("../src/persist");

const rows = () => [{ 번호: "A", 납기: "2026-09-24" }, { 번호: "B", 납기: "2026-10-23" }, { 번호: "C", 납기: "2026-11-01" }];

test("저장된 납기 변경: 같은 값이면 적용, 이미 바뀌어 있으면 유지, 다르면 충돌", () => {
  const r = rows();
  const { applied, conflicts } = applySavedDue(r, "번호", "납기", {
    A: { from: "2026-09-24", to: "2026-10-23" },   // 목록의 값이 from과 같다 → 적용
    B: { from: "2026-09-24", to: "2026-10-23" },   // 이미 to다 → 유지
    C: { from: "2026-09-24", to: "2026-10-23" },   // 새 파일에서 값이 달라졌다 → 충돌
    Z: { from: "x", to: "y" },                     // 목록에 없는 주문 → 무시
  });
  assert.equal(r[0].납기, "2026-10-23");
  assert.equal(r[2].납기, "2026-11-01");            // 충돌은 덮어쓰지 않는다
  assert.deepEqual(Object.keys(applied).sort(), ["A", "B"]);
  assert.deepEqual(conflicts, ["C"]);
});

test("저장본 합치기: 현재 목록의 기록은 현재 상태로, 다른 목록의 기록은 그대로", () => {
  const saved = { edited: { OLD: { from: "a", to: "b" }, A: { from: "1", to: "2" } }, reasons: {}, causeOverride: { A: "운송·선적", OLD: "주문 변경" }, notice: null };
  const current = { edited: {}, reasons: { A: "통관 서류 보완" }, causeOverride: {}, notice: { template: "공지형", alt: "" } };  // A의 원인 지정을 해제함
  const m = mergeState(saved, current, ["A", "B"]);
  assert.equal(m.causeOverride.A, undefined);          // 해제가 저장에도 반영된다
  assert.equal(m.causeOverride.OLD, "주문 변경");      // 다른 목록의 기록은 남는다
  assert.equal(m.edited.A, undefined);
  assert.deepEqual(m.edited.OLD, { from: "a", to: "b" });
  assert.equal(m.reasons.A, "통관 서류 보완");
  assert.equal(m.notice.template, "공지형");
});

test("깨진 저장본은 빈 상태로 읽는다", () => {
  assert.deepEqual(clean(null), { edited: {}, reasons: {}, causeOverride: {}, notice: null, contacted: {}, contactLog: {}, informed: {}, quickNotes: {}, replies: {}, subst: {}, schedule: {}, soonRules: null });
  assert.deepEqual(clean({ edited: [1, 2], reasons: "x" }).edited, {});
  assert.deepEqual(counts({ edited: { A: {} }, causeOverride: { A: "x", B: "y" } }), { edited: 1, causeOverride: 2, reasons: 0 });
});

test("저장본: 빠른 메모는 빈 글을 버리고, 300자로 자르고, 주문당 최근 50건만 남기며, id·시각은 버리지 않는다", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ text: "m" + i, createdAt: "2026-10-12T05:30:00.000Z" }));
  const c = clean({ quickNotes: {
    A: [{ text: "  ", createdAt: "x" }, { text: "가".repeat(400), id: "n1", createdAt: "2026-10-12T05:30:00.000Z" }, { text: 5 }, null, { text: "정상" }],
    B: many, C: "x", D: [{ text: "" }],
  } });
  assert.deepEqual(c.quickNotes.A.map(n => n.text.length), [300, 2]);
  assert.equal(c.quickNotes.A[0].id, "n1");
  assert.equal(c.quickNotes.A[0].createdAt, "2026-10-12T05:30:00.000Z");
  assert.equal(c.quickNotes.A[1].id, undefined);
  assert.equal(c.quickNotes.B.length, 50);
  assert.equal(c.quickNotes.B[0].text, "m10");                       // 오래된 10건이 잘린다
  assert.equal(c.quickNotes.C, undefined);                           // 목록이 아니면 버린다
  assert.equal(c.quickNotes.D, undefined);                           // 남은 메모가 없으면 주문 항목도 없다
  assert.deepEqual(clean({ quickNotes: [1, 2] }).quickNotes, {});
});

test("저장본 합치기: 빠른 메모도 현재 목록의 주문은 현재 상태로, 다른 목록의 주문은 그대로 둔다", () => {
  const saved = { quickNotes: { OLD: [{ text: "예전 목록 메모" }], A: [{ text: "지울 메모" }] } };
  const m = mergeState(saved, { quickNotes: { A: [{ text: "새 메모" }] } }, ["A", "B"]);
  assert.deepEqual(m.quickNotes.A.map(n => n.text), ["새 메모"]);
  assert.deepEqual(m.quickNotes.OLD.map(n => n.text), ["예전 목록 메모"]);
  const cleared = mergeState(saved, { quickNotes: {} }, ["A"]);       // 현재 목록에서 모두 지움
  assert.equal(cleared.quickNotes.A, undefined);
  assert.equal(cleared.quickNotes.OLD.length, 1);
});

test("저장본: 다시 안내 기준 일수(reAlertDays)는 1~30의 정수만 남기고, 없으면 키 자체가 없다", () => {
  assert.equal(clean({ reAlertDays: 3 }).reAlertDays, 3);
  [0, 31, "7", 7.5, null, NaN].forEach(v => assert.equal("reAlertDays" in clean({ reAlertDays: v }), false, String(v)));
  assert.equal("reAlertDays" in clean(null), false);
});

test("저장본 합치기: 다시 안내 기준은 주문과 무관하게 현재 값이 전부다 (기본값으로 되돌리면 지워진다)", () => {
  assert.equal(mergeState({ reAlertDays: 3 }, { reAlertDays: 10 }, ["A"]).reAlertDays, 10);
  assert.equal("reAlertDays" in mergeState({ reAlertDays: 3 }, {}, ["A"]), false);
});
