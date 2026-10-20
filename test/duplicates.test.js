const test = require("node:test");
const assert = require("node:assert");
const { findDuplicates } = require("../src/duplicates");

test("겹치는 주문번호를 찾는다: 개수, 줄 수, 앞쪽 예시", () => {
  const rows = [{ no: "A" }, { no: "B" }, { no: "A" }, { no: "C" }, { no: "A" }, { no: "B" }];
  assert.deepEqual(findDuplicates(rows, "no"), { count: 2, rows: 5, sample: [{ no: "A", n: 3 }, { no: "B", n: 2 }] });
});

test("겹침이 없거나 열이 없거나 빈 번호면 0이다 (공백만 다른 번호는 같은 번호로 본다)", () => {
  assert.equal(findDuplicates([{ no: "A" }, { no: "B" }], "no").count, 0);
  assert.equal(findDuplicates([{ no: "A" }, { no: "A" }], "").count, 0);
  assert.equal(findDuplicates([{ no: "" }, { no: "" }, { no: null }], "no").count, 0);
  assert.equal(findDuplicates([{ no: "A" }, { no: " A " }], "no").count, 1);
  assert.equal(findDuplicates(null, "no").count, 0);
});
