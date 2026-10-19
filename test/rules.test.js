const test = require("node:test");
const assert = require("node:assert");
const J = require("../src/judge");
const P = require("../src/persist");

test("품목별 임박 기준: 키워드가 품목명에 있으면 그 일수, 없으면 기본값", () => {
  const cfg = { def: 7, rules: J.parseRules("필터=3\n장갑: 3일") };
  const o = (name, due) => ({ 주문번호: "A", 품목명: name, 납기일: due });
  assert.equal(J.classify(o("에어 필터 카트리지", "2026-10-16"), "2026-10-12", cfg).status, "정상"); // 4일 남음, 3일 기준
  assert.equal(J.classify(o("에어 필터 카트리지", "2026-10-15"), "2026-10-12", cfg).status, "임박"); // 3일 남음
  assert.equal(J.classify(o("소형 진공 펌프", "2026-10-19"), "2026-10-12", cfg).status, "임박");     // 7일 남음, 기본 7일
  assert.equal(J.classify(o("소형 진공 펌프", "2026-10-20"), "2026-10-12", cfg).status, "정상");
  assert.match(J.classify(o("니트릴 장갑", "2026-10-14"), "2026-10-12", cfg).reason, /'장갑' 품목은 3일/);
});

test("규칙 해석: 형식이 아닌 줄은 건너뛰고, 숫자만 주면 예전처럼 동작한다", () => {
  assert.deepEqual(J.parseRules("필터=3\n이상한 줄\n=5\n볼트=0\n펌프 = 10"), [{ keyword: "필터", days: 3 }, { keyword: "펌프", days: 10 }]);
  assert.equal(J.classify({ 주문번호: "A", 납기일: "2026-10-19" }, "2026-10-12", 7).status, "임박");
});

test("품목별 기준은 저장·복원된다", () => {
  assert.equal(P.clean({ soonRules: "필터=3" }).soonRules, "필터=3");
  assert.equal(P.clean({}).soonRules, null);
  assert.equal(P.mergeState({}, { soonRules: "a=1" }, []).soonRules, "a=1");
});
