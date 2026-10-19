// 용어 사전 (src/labels.js, IA 5절, G-3): 한 개념에 한 이름. 사전의 말이 사전의 금지어를 어기지 않는지 고정한다.
const test = require("node:test");
const assert = require("node:assert");
const L = require("../src/labels");
const Informed = require("../src/informed");

test("안내 상태 3가지가 모두 사전에 있고, 화면 문구는 '미안내 / 안내 완료 / 다시 안내'다", () => {
  const states = ["미안내", "안내완료", "재안내필요"];
  states.forEach(s => assert.ok(L.STATE[s], s));
  assert.deepEqual(states.map(L.state), ["미안내", "안내 완료", "다시 안내"]);
  // Informed가 실제로 돌려주는 상태 값이 전부 사전에 있다 (새 상태를 만들고 사전을 빼먹으면 여기서 걸린다)
  const o = { status: "지연", due: "2026-10-05" };
  const seen = new Set([
    Informed.stateOf(o, [], "2026-10-12").state,
    Informed.stateOf(o, [{ date: "2026-10-11", channel: "메일", status: "지연", due: o.due, note: "" }], "2026-10-12").state,
    Informed.stateOf(o, [{ date: "2026-10-01", channel: "메일", status: "지연", due: o.due, note: "" }], "2026-10-12").state,
  ]);
  assert.equal(seen.size, 3);
  seen.forEach(s => assert.ok(L.STATE[s], s));
});

test("주문 상태: 코드의 붙여 쓴 값은 화면에서 띄어 쓴다 (확인 필요, 입고 완료)", () => {
  assert.equal(L.status("확인필요"), "확인 필요");
  assert.equal(L.status("입고완료"), "입고 완료");
  assert.equal(L.status("지연"), "지연");
  assert.equal(L.status("처음 보는 값"), "처음 보는 값");              // 모르는 값은 그대로 보여 준다 (숨기거나 지어내지 않는다)
});

test("사전의 화면 문구에는 금지어가 하나도 없다", () => {
  [...Object.values(L.STATE), ...Object.values(L.STATUS)].forEach(t => assert.deepEqual(L.findBanned(t), [], t));
});

test("금지어 찾기: 개수를 세고 대신 쓸 말을 알려 준다", () => {
  const r = L.findBanned("재안내 대상. 재안내 기록. 확인필요 3건");
  assert.deepEqual(r.map(x => [x.word, x.use, x.count]), [["재안내", "다시 안내", 2], ["확인필요", "확인 필요", 1]]);
  assert.deepEqual(L.findBanned("다시 안내 · 확인 필요 · 안내 완료 · 입고 완료"), []);
});
