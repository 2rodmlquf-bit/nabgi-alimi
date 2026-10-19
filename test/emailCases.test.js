const test = require("node:test");
const assert = require("node:assert");
const cases = require("./emailCases");
const { extract } = require("../src/emailRules");

// 가상으로 만든 이메일 표현들을 규칙이 기대대로 읽는지 확인한다. 기준일은 2026-10-12.
cases.forEach(c => {
  test("표현: " + c.name, () => {
    const got = Object.fromEntries(extract(c.mail, "2026-10-12").map(i => [i.orderNo, i]));
    Object.entries(c.expect).forEach(([no, want]) => {
      assert.ok(got[no], no + " 주문번호를 찾지 못함");
      assert.equal(got[no].dueDate, want, no);
      if (c.noteIncludes && c.noteIncludes[no]) assert.ok(got[no].note.includes(c.noteIncludes[no]), "메모에 '" + c.noteIncludes[no] + "' 없음: " + got[no].note);
    });
    assert.deepEqual(Object.keys(got).filter(n => !(n in c.expect)), [], "예상하지 못한 주문번호");
    Object.values(got).filter(i => i.evidence).forEach(i => assert.ok(c.mail.includes(i.evidence), "근거 문장이 원문에 없음: " + i.evidence));
  });
});
