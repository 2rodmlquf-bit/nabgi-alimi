// 감사(Phase 1)에서 단위 테스트가 없던 두 곳을 메운다: 안내 기록의 주문당 50건 제한(FR-10), 보고서·CSV의 안내 현황(FR-15).
const test = require("node:test");
const assert = require("node:assert");
const { clean } = require("../src/persist");
const Report = require("../src/report");

const entry = n => ({ date: "2026-10-" + String((n % 28) + 1).padStart(2, "0"), channel: "메일", status: "지연", due: "2026-09-24", note: "m" + n });

test("FR-10 저장본: 안내 기록은 주문당 최근 50건까지만 남는다", () => {
  const many = Array.from({ length: 60 }, (_, i) => entry(i));
  const c = clean({ informed: { A: many, B: [entry(1)] } });
  assert.equal(c.informed.A.length, 50);
  assert.equal(c.informed.A[0].note, "m10");              // 오래된 10건이 잘린다
  assert.equal(c.informed.A[49].note, "m59");             // 가장 최근 것은 남는다
  assert.equal(c.informed.B.length, 1);                   // 다른 주문에는 영향 없음
});

const baseInput = extra => ({
  base: "2026-10-12", fileName: "x.csv", total: 3,
  counts: { 지연: 1, 임박: 1, 정상: 1, 입고완료: 0, 확인필요: 0 },
  delay: { total: 0, byCause: [], bySupplier: [], byRequester: [] }, groups: [], ...extra,
});

test("FR-15 보고서: 안내 요약이 있으면 건수와 선제 안내 줄이 들어가고, 없으면 줄이 없다", () => {
  const informed = { total: 13, 지연: 7, 임박: 6, 미안내: 12, 안내완료: 1, 재안내필요: 0, lateNone: 6, preempt: 0 };
  const t = Report.buildReport(baseInput({ informed }));
  assert.match(t, /연구원 안내: 지연·임박 13건 중 안내 완료 1건, 안내 안 함 12건, 다시 알려야 할 건 0건/);
  assert.match(t, /지연 7건 중 지연되기 전에 미리 안내한 건 0건, 지연 중인데 아직 안내하지 못한 건 6건/);
  assert.ok(!/연구원 안내:/.test(Report.buildReport(baseInput({}))));                       // 입력이 없으면 줄이 없다
  assert.ok(!/연구원 안내:/.test(Report.buildReport(baseInput({ informed: { total: 0 } })))); // 대상이 0건이어도 없다
});

test("FR-15 보고서: 지연이 없으면 '지연 전에 미리 안내' 줄은 빠진다", () => {
  const informed = { total: 2, 지연: 0, 임박: 2, 미안내: 2, 안내완료: 0, 재안내필요: 0, lateNone: 0, preempt: 0 };
  const t = Report.buildReport(baseInput({ informed }));
  assert.match(t, /연구원 안내: 지연·임박 2건/);
  assert.ok(!/지연되기 전에 미리 안내한 건/.test(t));
});

test("FR-15 예외 목록 CSV: 마지막 열이 '연구원 안내'이고 '확인 필요' 줄은 비어 있다", () => {
  assert.equal(Report.EXC_HEAD[Report.EXC_HEAD.length - 1], "연구원 안내");
  const exc = [{ "주문번호": "A", "공급사": "s", status: "지연", daysLeft: -3 }];
  const chk = [{ "주문번호": "B", "공급사": "s" }];
  const rows = Report.exceptionRows(exc, chk, () => "기타·미확인", () => "", {}, o => "안내완료(" + o["주문번호"] + ")");
  assert.equal(rows[0][10], "안내완료(A)");
  assert.equal(rows[1][10], "");                                    // 확인 필요는 안내 대상이 아니다
  assert.equal(Report.exceptionRows(exc, [], () => "", () => "", {})[0][10], "");   // informedOf를 안 주면 빈 칸 (예전 호출 방식과 호환)
});
