// 열 이름 추측 (src/columns.js). 예전에는 renderer.js 안에 있어서 시험할 수 없었다 (감사 L-4).
const test = require("node:test");
const assert = require("node:assert");
const C = require("../src/columns");
const { STD: MAPPING_STD } = require("../src/mapping");

test("표준 열 목록은 Claude 열 매핑(mapping.js)이 쓰는 목록과 같다 (두 곳이 어긋나지 않게)", () => {
  assert.deepEqual(C.STD, MAPPING_STD);
  assert.equal(new Set(C.STD).size, C.STD.length);
  assert.deepEqual(C.REQUIRED, ["주문번호", "납기일"]);
  assert.ok(C.REQUIRED.every(r => C.STD.includes(r)));
});

test("추측 순서 목록은 표준 열을 빠짐없이, 중복 없이 담는다 (빠지면 그 열은 영영 추측되지 않는다)", () => {
  assert.deepEqual([...C.GUESS_ORDER].sort(), [...C.STD].sort());
  assert.ok(C.STD.every(s => C.HINTS[s] && C.HINTS[s].length), "힌트가 없는 표준 열이 있다");
});

test("열 이름이 우리 표준과 같으면 그대로 연결한다 (대소문자 무시)", () => {
  const m = C.guessMapping(["주문번호", "품목명", "공급사", "요청자", "납기일", "비고"]);
  assert.deepEqual(["주문번호", "품목명", "공급사", "요청자", "납기일", "비고"].map(k => m[k]), ["주문번호", "품목명", "공급사", "요청자", "납기일", "비고"]);
  assert.equal(C.guessMapping(["PO", "Item", "DUE"]).납기일, "DUE");
});

test("다르게 불러도 힌트로 찾는다: 발주번호·품명·납기·공급업체·연구원", () => {
  const m = C.guessMapping(["발주번호", "품명", "납기", "공급업체", "연구원", "메모"]);
  assert.equal(m.주문번호, "발주번호"); assert.equal(m.품목명, "품명"); assert.equal(m.납기일, "납기");
  assert.equal(m.공급사, "공급업체"); assert.equal(m.요청자, "연구원"); assert.equal(m.비고, "메모");
});

test("더 구체적인 열이 먼저 가져간다: '잔량납기'와 '입고수량'이 '납기'·'입고'에 뺏기지 않는다", () => {
  const m = C.guessMapping(["주문번호", "납기일", "잔량납기", "주문수량", "입고수량", "입고여부"]);
  assert.equal(m.잔량납기, "잔량납기");
  assert.equal(m.납기일, "납기일");
  assert.equal(m.입고수량, "입고수량");
  assert.equal(m.입고여부, "입고여부");
  assert.equal(m.주문수량, "주문수량");
});

test("한 열은 한 표준 열에만 연결된다", () => {
  const m = C.guessMapping(["납기", "발주번호", "품목"]);
  const used = Object.values(m).filter(Boolean);
  assert.equal(new Set(used).size, used.length);
});

test("맞는 열이 없으면 빈 문자열이고, 모든 표준 열이 키로 들어 있다 (화면이 undefined를 만나지 않게)", () => {
  const m = C.guessMapping(["A", "B", "C", "D"]);
  assert.deepEqual(Object.keys(m).sort(), [...C.STD].sort());
  assert.ok(Object.values(m).every(v => v === ""));
  assert.deepEqual(Object.values(C.guessMapping([])).filter(Boolean), []);
});
