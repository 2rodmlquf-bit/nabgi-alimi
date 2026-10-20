// 홈의 "지금 할 일" 묶음 (src/home.js, Intent 체크리스트 3번, PRD FR-20·26)
const test = require("node:test");
const assert = require("node:assert");
const H = require("../src/home");

const o = (no, status, daysLeft, extra) => ({ "주문번호": no, "품목명": "품목" + no, status, daysLeft, ...extra });
const stateMap = m => ord => ({ state: m[ord["주문번호"]] || "안내완료" });

test("안내할 것: 지연·임박·확인 필요 중 미안내·다시 안내만. 지연(오래된 순) → 임박(가까운 순) → 확인 필요", () => {
  const orders = [o("A", "임박", 2), o("B", "지연", -3), o("C", "지연", -10), o("D", "임박", 1), o("E", "확인필요", null), o("F", "정상", 30), o("G", "입고완료", -1), o("H", "지연", -5)];
  const st = { A: "미안내", B: "미안내", C: "재안내필요", D: "미안내", E: "미안내", F: "미안내", G: "미안내", H: "안내완료" };
  const list = H.informList(orders, stateMap(st));
  assert.deepEqual(list.map(x => x.no), ["C", "B", "D", "A", "E"]);                              // F(정상)·G(입고 완료)·H(안내 완료)는 빠진다
  assert.equal(list[0].days, 10); assert.equal(list[0].again, true); assert.equal(list[1].again, false);
  assert.deepEqual(H.informList(null, stateMap({})), []);
});

test("묶음 요약: 건수와 상위 3건, 다시 안내·새 안내 구분, 조용한 회신 늦음 건수, 모두 0이면 empty", () => {
  const inform = [1, 2, 3, 4].map(i => ({ no: "N" + i, status: "지연", again: i === 1, days: 10 - i }));
  const late = { late: [{ no: "L1", daysLate: 5 }, { no: "L2", daysLate: 2 }], quiet: [{ no: "Q1", daysLate: 9 }] };
  const contact = [{ supplier: "가온", orders: [1, 2], counts: { 지연: 2 } }, { supplier: "바다", orders: [1], counts: { 임박: 1 } }];
  const s = H.summarize({ inform, late, contact });
  assert.deepEqual([s.inform.total, s.inform.again, s.inform.fresh, s.inform.top.length], [4, 1, 3, 3]);
  assert.deepEqual([s.late.total, s.late.quiet, s.late.top.map(x => x.no)], [2, 1, ["L1", "L2"]]);
  assert.deepEqual([s.contact.total, s.contact.orders, s.contact.top[0].supplier], [2, 3, "가온"]);
  assert.equal(s.empty, false);
  assert.equal(H.summarize({ inform: [], late: { late: [], quiet: [] }, contact: [] }).empty, true);
  assert.equal(H.summarize({ inform: [], late: { late: [], quiet: [{ no: "Q" }] }, contact: [] }).empty, true);   // 조용한 것만 있으면 할 일은 없다
  assert.equal(H.summarize().empty, true);
  assert.equal(H.summarize({ inform }, 2).inform.top.length, 2);
});

test("처음 시작 안내: 파일이 있고 기록이 하나도 없을 때만 보이고, 끝낸 단계를 알려 준다", () => {
  assert.equal(H.startSteps({ hasFile: false, opened: false, records: 0 }).show, false);          // 파일이 없을 때는 빈 화면(MN-11-P)이 안내한다
  const a = H.startSteps({ hasFile: true, opened: false, records: 0 });
  assert.equal(a.show, true); assert.equal(a.current, 2); assert.deepEqual(a.steps.map(x => x.done), [true, false, false]);
  const b = H.startSteps({ hasFile: true, opened: true, records: 0 });
  assert.equal(b.current, 3); assert.deepEqual(b.steps.map(x => x.done), [true, true, false]);
  assert.equal(H.startSteps({ hasFile: true, opened: true, records: 2 }).show, false);            // 기록이 생기면 사라진다
});

test("연구원 요약: 입고 완료·정상은 빼고 지연·임박·확인 필요만 세고, 안내할 것·회신 늦음 수를 함께 돌려준다", () => {
  const orders = [o("A", "지연", -3), o("B", "지연", -1), o("C", "임박", 2), o("D", "확인필요", null), o("E", "정상", 30), o("F", "입고완료", -2)];
  assert.deepEqual(H.requesterSummary(orders, { informCount: 3, lateCount: 1, quietCount: 2 }), { total: 4, late: 2, soon: 1, check: 1, inform: 3, replyLate: 1, replyQuiet: 2 });
  assert.deepEqual(H.requesterSummary([], {}), { total: 0, late: 0, soon: 0, check: 0, inform: 0, replyLate: 0, replyQuiet: 0 });
  assert.equal(H.requesterSummary(null).total, 0);
});
