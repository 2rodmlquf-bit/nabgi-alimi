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
  assert.deepEqual(clean(null), { edited: {}, reasons: {}, causeOverride: {}, notice: null, contacted: {}, contactLog: {}, informed: {}, subst: {}, schedule: {}, soonRules: null });
  assert.deepEqual(clean({ edited: [1, 2], reasons: "x" }).edited, {});
  assert.deepEqual(counts({ edited: { A: {} }, causeOverride: { A: "x", B: "y" } }), { edited: 1, causeOverride: 2, reasons: 0 });
});
