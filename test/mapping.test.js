const test = require("node:test");
const assert = require("node:assert");
const { buildPayload, buildPrompt, parseMapping } = require("../src/mapping");

const columns = ["PO번호", "자재명", "거래처", "회신납기", "입고"];
const rows = [1, 2, 3, 4, 5].map(i => Object.fromEntries(columns.map(c => [c, c + i])));

test("Claude에 보내는 건 열 이름과 앞 3행뿐", () => {
  const p = buildPayload(columns, rows);
  assert.deepEqual(p.columns, columns);
  assert.equal(p.sampleRows.length, 3);
  const prompt = buildPrompt(p);
  assert.ok(prompt.includes("회신납기") && !prompt.includes("회신납기4"));
});

test("정상 응답을 해석한다 (앞뒤 설명 글자가 섞여도)", () => {
  const text = '결과입니다\n{"mapping":{"주문번호":{"column":"PO번호","confidence":"높음","reason":"번호 형식"},"납기일":{"column":"회신납기","confidence":"보통","reason":"납기"}}}';
  const m = parseMapping(text, columns);
  assert.equal(m["주문번호"].column, "PO번호");
  assert.equal(m["납기일"].confidence, "보통");
  assert.equal(m["비고"].column, "");
});

test("없는 열 이름과 중복 사용은 버린다", () => {
  const text = JSON.stringify({ mapping: {
    주문번호: { column: "PO번호", confidence: "높음", reason: "" },
    품목명: { column: "PO번호", confidence: "낮음", reason: "" },      // 중복 → 버림(신뢰도 낮은 쪽)
    공급사: { column: "없는열", confidence: "높음", reason: "" },        // 목록에 없음 → 버림
  } });
  const m = parseMapping(text, columns);
  assert.equal(m["주문번호"].column, "PO번호");
  assert.equal(m["품목명"].column, "");
  assert.equal(m["공급사"].column, "");
});

test("JSON이 없으면 오류", () => {
  assert.throws(() => parseMapping("죄송합니다", columns));
});
