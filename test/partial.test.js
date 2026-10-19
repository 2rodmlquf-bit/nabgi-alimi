process.env.TZ = "Asia/Seoul";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { classify, findExceptions } = require("../src/judge");
const { csvToObjects } = require("../src/csv");

const TODAY = "2026-10-12";
const o = extra => ({ 주문번호: "A", 납기일: "2026-10-08", 입고여부: "", ...extra });

test("부분 입고: 일부만 들어오면 입고 완료로 빼지 않고, 남은 수량 기준으로 계속 본다", () => {
  const r = classify(o({ 주문수량: "10", 입고수량: "4" }), TODAY);
  assert.equal(r.status, "지연");                       // 납기(10/8)가 지났고 잔량이 남아 있다
  assert.deepEqual(r.partial, { ordered: 10, received: 4, remaining: 6, remainDue: "" });
  assert.ok(r.reason.includes("부분 입고 4/10 (잔량 6)"));
});

test("입고수량이 주문수량 이상이면 입고여부가 비어 있어도 입고 완료", () => {
  assert.equal(classify(o({ 주문수량: "10", 입고수량: "10" }), TODAY).status, "입고완료");
  assert.equal(classify(o({ 주문수량: "10", 입고수량: "12" }), TODAY).status, "입고완료");
});

test("입고여부가 Y여도 수량이 모자라면 부분 입고 (수량이 더 정확한 정보)", () => {
  const r = classify(o({ 입고여부: "Y", 주문수량: "10", 입고수량: "6" }), TODAY);
  assert.equal(r.status, "지연");
  assert.equal(r.partial.remaining, 4);
  assert.equal(classify(o({ 입고여부: "Y" }), TODAY).status, "입고완료");   // 수량 열이 없으면 예전처럼 입고여부를 믿는다
});

test("아무것도 안 들어왔거나(0, 빈칸) 수량이 숫자가 아니면 부분 입고가 아니다", () => {
  assert.equal(classify(o({ 주문수량: "10", 입고수량: "0" }), TODAY).partial, null);
  assert.equal(classify(o({ 주문수량: "10", 입고수량: "" }), TODAY).partial, null);
  assert.equal(classify(o({ 주문수량: "열 개", 입고수량: "4" }), TODAY).partial, null);
  assert.equal(classify(o({ 주문수량: "0", 입고수량: "0" }), TODAY).partial, null);
  assert.equal(classify(o({ 주문수량: "1,000", 입고수량: "400" }), TODAY).partial.remaining, 600);   // 천 단위 쉼표
});

test("잔량 납기 열이 있으면 부분 입고 주문은 그 날짜로 판정한다 (원래 납기는 지났어도 잔량 납기는 아직)", () => {
  const r = classify(o({ 주문수량: "10", 입고수량: "4", 잔량납기: "2026-10-20" }), TODAY);
  assert.equal(r.status, "정상");                       // 10/20까지 8일, 임박 기준(7일) 밖
  assert.equal(r.partial.remainDue, "2026-10-20");
  assert.ok(r.reason.includes("잔량 납기 기준"));
  assert.equal(classify(o({ 주문수량: "10", 입고수량: "4", 잔량납기: "2026-10-14" }), TODAY).status, "임박");
  assert.equal(classify(o({ 주문수량: "10", 입고수량: "4", 잔량납기: "곧" }), TODAY).status, "지연");     // 잔량 납기를 못 읽으면 원래 납기로
  assert.equal(classify(o({ 주문수량: "10", 입고수량: "0", 잔량납기: "2026-10-20" }), TODAY).status, "지연"); // 아직 하나도 안 왔으면 잔량 납기를 쓰지 않는다
});

test("샘플: 부분 입고 3건(지연·임박·정상)이 있어도 판정 숫자는 그대로, 부분입고 건수는 따로 센다", () => {
  const rows = csvToObjects(fs.readFileSync(path.join(__dirname, "..", "샘플주문.csv"), "utf8")).rows;
  const r = findExceptions(rows, TODAY);
  assert.deepEqual([r.counts.지연, r.counts.임박, r.counts.정상, r.counts.입고완료, r.counts.확인필요], [7, 8, 17, 4, 2]);
  assert.equal(r.counts.부분입고, 3);
  const by = no => [...r.exceptions, ...rows.map(x => ({ ...x, ...classify(x, TODAY) }))].find(x => x.주문번호 === no);
  assert.equal(by("PO-2026-1004").status, "지연");
  assert.deepEqual([by("PO-2026-1004").partial.received, by("PO-2026-1004").partial.remaining], [4, 6]);
  assert.equal(by("PO-2026-1009").status, "임박");
  assert.equal(by("PO-2026-1016").status, "정상");
});
