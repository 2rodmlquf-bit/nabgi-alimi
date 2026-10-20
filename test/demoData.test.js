// 데모 데이터(가상 주문 엑셀): 앱이 회사 시스템 엑셀처럼 생긴 파일을 열 수 있고, 만든 시나리오 수가 판정 결과와 맞는다.
process.env.TZ = "Asia/Seoul";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const O = require("../src/ordersFile");
const Judge = require("../src/judge");
const { guessMapping, STD } = require("../src/columns");
const { buildDemo } = require("../make-demo-data");

const FILE = path.join(__dirname, "..", "데모데이터", "가상주문_연구소_2026-10.xlsx");

function judgeDemo(buf) {
  const t = O.readOrders("데모.xlsx", buf);
  const m = guessMapping(t.columns);
  const rows = t.rows.map(row => { const o = { _raw: row }; STD.forEach(s => (o[s] = m[s] ? row[m[s]] || "" : "")); return o; });
  return { t, m, r: Judge.findExceptions(rows, "2026-10-12", { def: 7, rules: [] }) };
}

test("저장소의 데모 엑셀은 생성기가 만든 것과 같다 (손으로 고치지 않았다)", () => {
  assert.ok(buildDemo().buf.equals(fs.readFileSync(FILE)));
});

test("제목 2줄을 건너뛰고 열 이름이 다른 표를 자동으로 연결해 86건을 읽는다", () => {
  const { t, m } = judgeDemo(fs.readFileSync(FILE));
  assert.equal(t.ok, true);
  assert.equal(t.rows.length, 86);
  assert.equal(m.주문번호, "발주번호"); assert.equal(m.공급사, "거래처"); assert.equal(m.요청자, "신청자"); assert.equal(m.납기일, "납기예정일"); assert.equal(m.입고수량, "누적입고");
  assert.match((t.notes || []).join(" "), /2줄/);
});

test("판정: 지연 19(일부 입고 5 포함)·임박 9·정상 40·입고 완료 14·확인 필요 4", () => {
  const { r } = judgeDemo(fs.readFileSync(FILE));
  const c = r.counts;
  assert.deepEqual([c.지연, c.임박, c.정상, c.입고완료, c.확인필요, c.부분입고], [19, 9, 40, 14, 4, 5]);
});

test("납기를 읽을 수 없는 4건('10월 말' 등)은 날짜를 지어내지 않고 확인 필요로 둔다", () => {
  const { r } = judgeDemo(fs.readFileSync(FILE));
  assert.equal((r.needCheck || []).length, 4);
});
