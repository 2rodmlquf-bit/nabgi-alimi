// 빠른 메모 (src/quickNote.js, PRD FR-12): 전화·메신저로 받은 지연 소식을 잊기 전에 주문에 남긴다.
// 입력은 메모 글 하나뿐이고 시각은 자동이다 (CUJ-3의 핵심 순간: 입력이 번거로우면 쓰지 않게 된다).
// 메모는 안내 상태·판정에 영향을 주지 않는다 (이 모듈은 그런 규칙을 갖지 않는다).
const test = require("node:test");
const assert = require("node:assert");
const Q = require("../src/quickNote");

const T = (n = 0) => new Date(2026, 9, 12, 14, 30, n).toISOString();     // 2026-10-12 14:30 (로컬 시각)

test("메모를 남기면 앞뒤 공백을 지운 글과 만든 시각이 저장된다", () => {
  const notes = {};
  const r = Q.add(notes, "PO-1", "  통관 서류 보완 중, 10월 말 예상  ", T());
  assert.equal(r.ok, true);
  assert.equal(r.clipped, false);
  assert.equal(r.dropped, 0);
  assert.deepEqual(notes["PO-1"], [{ text: "통관 서류 보완 중, 10월 말 예상", createdAt: T() }]);
  assert.equal(r.note, notes["PO-1"][0]);
});

test("빈 글이나 공백만 있는 글은 저장하지 않고 이유를 알려 준다", () => {
  const notes = {};
  ["", "   ", "\n\t \n", null, undefined, 42].forEach(v => {
    const r = Q.add(notes, "PO-1", v, T());
    assert.equal(r.ok, false, JSON.stringify(v));
    assert.equal(r.reason, "empty");
  });
  assert.deepEqual(notes, {});                                            // 아무것도 생기지 않는다 (빈 주문 키도)
});

test("글자 수 제한: 300자까지 저장하고 넘으면 잘라서 저장하며 잘렸다고 알린다", () => {
  const notes = {};
  assert.equal(Q.MAX_LEN, 300);
  const exact = Q.add(notes, "A", "가".repeat(300), T());
  assert.equal(exact.clipped, false);
  assert.equal(notes.A[0].text.length, 300);
  const over = Q.add(notes, "A", "나".repeat(450), T(1));
  assert.equal(over.ok, true); assert.equal(over.clipped, true);
  assert.equal(notes.A[1].text.length, 300);
  assert.ok(notes.A[1].text.startsWith("나"));
  // 공백을 지운 뒤 길이로 센다
  assert.equal(Q.add(notes, "B", "  " + "다".repeat(300) + "  ", T(2)).clipped, false);
});

test("글 속의 줄바꿈과 특수문자는 그대로 둔다 (한글·이모지·따옴표)", () => {
  const notes = {};
  Q.add(notes, "A", "전화 \"홍길동\"\n- 선적 지연 😀\n- 재확인 필요", T());
  assert.equal(notes.A[0].text, "전화 \"홍길동\"\n- 선적 지연 😀\n- 재확인 필요");
});

test("주문마다 따로 쌓이고, 한 주문의 메모가 다른 주문에 섞이지 않는다", () => {
  const notes = {};
  Q.add(notes, "A", "a1", T(0)); Q.add(notes, "B", "b1", T(1)); Q.add(notes, "A", "a2", T(2));
  assert.deepEqual(notes.A.map(n => n.text), ["a1", "a2"]);
  assert.deepEqual(notes.B.map(n => n.text), ["b1"]);
});

test("주문당 최근 50건까지만 보관한다. 51번째를 남기면 가장 오래된 것이 빠지고 알린다", () => {
  const notes = {};
  assert.equal(Q.MAX_LIVE, 50);
  let last;
  for (let i = 0; i < 51; i++) last = Q.add(notes, "A", "m" + i, T(i));
  assert.equal(notes.A.length, 50);
  assert.equal(notes.A[0].text, "m1");                                    // m0이 빠졌다
  assert.equal(notes.A[49].text, "m50");
  assert.equal(last.dropped, 1);
});

test("목록은 최신순이고, 없는 주문은 빈 목록이며, 원본 순서를 바꾸지 않는다", () => {
  const notes = {};
  Q.add(notes, "A", "첫째", T(0)); Q.add(notes, "A", "둘째", T(1)); Q.add(notes, "A", "셋째", T(2));
  const l = Q.list(notes, "A");
  assert.deepEqual(l.map(n => n.text), ["셋째", "둘째", "첫째"]);
  assert.deepEqual(notes.A.map(n => n.text), ["첫째", "둘째", "셋째"]);   // 저장 순서는 그대로
  assert.equal(l[0], notes.A[2]);                                          // 같은 객체를 돌려준다 (지울 때 쓴다)
  assert.deepEqual(Q.list(notes, "없는주문"), []);
  assert.deepEqual(Q.list({}, "A"), []);
  assert.equal(Q.count(notes, "A"), 3);
  assert.equal(Q.count(notes, "없는주문"), 0);
});

test("메모 지우기: 그 메모만 없어지고, 마지막 메모를 지우면 주문 항목도 없어진다. 없는 메모는 false", () => {
  const notes = {};
  Q.add(notes, "A", "첫째", T(0)); Q.add(notes, "A", "둘째", T(1));
  const [newest, oldest] = Q.list(notes, "A");
  assert.equal(Q.remove(notes, "A", newest), true);
  assert.deepEqual(notes.A.map(n => n.text), ["첫째"]);
  assert.equal(Q.remove(notes, "A", newest), false);                       // 이미 지움
  assert.equal(Q.remove(notes, "A", oldest), true);
  assert.equal(notes.A, undefined);                                        // 빈 목록은 남기지 않는다
  assert.equal(Q.remove(notes, "없는주문", { text: "x" }), false);
});

test("메모 지우기: 저장소가 붙인 id로도 찾는다 (다시 불러온 메모는 다른 객체라서)", () => {
  const notes = { A: [{ id: "n1", text: "첫째", createdAt: T(0) }, { id: "n2", text: "둘째", createdAt: T(1) }] };
  assert.equal(Q.remove(notes, "A", { id: "n1" }), true);
  assert.deepEqual(notes.A.map(n => n.id), ["n2"]);
});

test("표시용 시각: 로컬 시각으로 '월-일 시:분', 읽을 수 없으면 빈 글자", () => {
  assert.equal(Q.stamp(T()), "10-12 14:30");
  assert.equal(Q.stamp(new Date(2026, 0, 5, 9, 5).toISOString()), "01-05 09:05");
  ["", "엉터리", null, undefined].forEach(v => assert.equal(Q.stamp(v), ""));
});

test("메모는 안내 상태와 무관하다: 이 모듈은 판정·상태 값을 만들지 않는다 (규칙 고정)", () => {
  assert.deepEqual(Object.keys(Q).sort(), ["MAX_LEN", "MAX_LIVE", "add", "count", "list", "remove", "stamp"]);
});

test("글자 수 제한 지점에 이모지가 걸쳐도 반쪽만 남지 않는다 (깨진 글자가 저장되지 않는다)", () => {
  const notes = {};
  const r = Q.add(notes, "A", "가".repeat(299) + "😀", T());          // 299칸 + 이모지(2칸) = 301칸
  assert.equal(r.clipped, true);
  const text = notes.A[0].text;
  assert.ok(text.length <= 300);
  const last = text.charCodeAt(text.length - 1);
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), "문자 쌍의 앞 반쪽으로 끝나면 안 된다");
  assert.equal(JSON.parse(JSON.stringify(text)), text);              // 저장·복원해도 그대로
});
