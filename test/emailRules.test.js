const test = require("node:test");
const assert = require("node:assert");
const { extract } = require("../src/emailRules");

const TODAY = "2026-10-12";
const sample = "안녕하세요, 가온산업 영업팀입니다.\n\n1. PO-2026-1001 (산업용 베어링)\n통관 서류 보완으로 10월 23일 입고 예정입니다. 불편을 드려 죄송합니다.\n\n2. PO-2026-1002 (유압 호스)\n현재 선적 준비 중이며, 빠르면 이번 주 중, 늦으면 다음 주 초 도착합니다.\n\n3. PO-2026-1010 (온도 센서)\n예정대로 10월 14일 도착합니다.\n\n감사합니다.";
const byId = items => Object.fromEntries(items.map(i => [i.orderNo, i]));

test("명확한 날짜는 읽고, 사유와 근거 문장도 뽑는다", () => {
  const r = byId(extract(sample, TODAY));
  assert.equal(r["PO-2026-1001"].dueDate, "2026-10-23");
  assert.equal(r["PO-2026-1001"].reason, "통관 서류 보완");
  assert.equal(r["PO-2026-1001"].confidence, "높음");
  assert.equal(r["PO-2026-1010"].dueDate, "2026-10-14");
});

test("근거 문장은 항상 원문의 일부다", () => {
  extract(sample, TODAY).filter(i => i.evidence).forEach(i => assert.ok(sample.includes(i.evidence), i.evidence));
});

test("'빠르면/늦으면' 같은 애매한 표현은 날짜를 비운다", () => {
  const i = byId(extract(sample, TODAY))["PO-2026-1002"];
  assert.equal(i.dueDate, null);
  assert.ok(i.note.includes("확정하지 않았어요"));
});

test("'다음 주 금요일'처럼 상대 표현만 있으면 계산하지 않고 알려 준다", () => {
  const r = extract("PO-2026-1003 건은 다음 주 금요일에 도착합니다.", TODAY)[0];
  assert.equal(r.dueDate, null);
  assert.ok(r.note.includes("상대 표현"));
});

test("날짜가 둘이고 변경 표현이 있으면 마지막 날짜를 쓰되 확인을 요청한다", () => {
  const r = extract("PO-2026-1004 납기를 10월 15일에서 10월 28일로 변경합니다.", TODAY)[0];
  assert.equal(r.dueDate, "2026-10-28");
  assert.equal(r.confidence, "보통");
  assert.ok(r.note.includes("마지막 날짜"));
});

test("날짜가 둘이고 선적·입고로 구분되면 입고 날짜를 쓰되 확인을 요청한다", () => {
  const r = extract("PO-2026-1005 관련해서 10월 15일 선적, 10월 28일 입고 순서입니다.", TODAY)[0];
  assert.equal(r.dueDate, "2026-10-28");
  assert.equal(r.confidence, "보통");
  assert.ok(r.note.includes("도착·입고로 적힌 날짜"));
});

test("날짜가 둘인데 변경 표현도 도착·출발 구분도 없으면 확정하지 않는다", () => {
  const r = extract("PO-2026-1005 관련해서 10월 15일과 10월 28일이 거론되었습니다.", TODAY)[0];
  assert.equal(r.dueDate, null);
});

test("다양한 날짜 표기와 내일 표현", () => {
  assert.equal(extract("PO-2026-1006 2026/11/3 도착", TODAY)[0].dueDate, "2026-11-03");
  assert.equal(extract("PO-2026-1007 2026년 11월 5일 도착", TODAY)[0].dueDate, "2026-11-05");
  const t = extract("PO-2026-1008 내일 도착합니다.", TODAY)[0];
  assert.equal(t.dueDate, "2026-10-13");
  assert.equal(t.confidence, "보통");
});

test("연도가 없고 한참 지난 날짜면 다음 해로 보고 확인을 요청한다", () => {
  const r = extract("PO-2026-1009 1월 15일 도착", TODAY)[0];
  assert.equal(r.dueDate, "2027-01-15");
  assert.ok(r.note.includes("다음 해"));
});

test("목록에 있는 주문번호는 모양이 달라도 찾는다", () => {
  const r = extract("주문 A12 건은 10월 20일 도착합니다.", TODAY, ["A12"])[0];
  assert.equal(r.orderNo, "A12");
  assert.equal(r.dueDate, "2026-10-20");
});

test("주문번호가 없으면 빈 목록", () => {
  assert.deepEqual(extract("안녕하세요 감사합니다.", TODAY), []);
});
