// G-8(A안): '확인 필요'(납기일을 읽을 수 없는) 주문도 예외 목록 표에 넣고, 연구원 안내 기록·추적 대상으로 삼는다.
// 이 파일은 그 동작을 정의한다: 안내 상태, 다시 안내 규칙, 요약, 저장, 보고서·CSV, 안내문.
const test = require("node:test");
const assert = require("node:assert");
const I = require("../src/informed");
const { clean } = require("../src/persist");
const Report = require("../src/report");
const Notice = require("../src/notice");

const unknown = { status: "확인필요", due: "" };
const ent = (status, date, due) => [{ date, channel: "메일", status, due, note: "" }];

test("안내 기록: 확인 필요 주문은 상태 '확인필요'로 남는다 (임박으로 잘못 기록되지 않는다)", () => {
  const e = I.makeEntry({ status: "확인필요", due: "미정" }, "2026-10-12", "메일", "");
  assert.equal(e.status, "확인필요");
  assert.equal(e.due, "미정");
  assert.equal(I.makeEntry({ status: "지연", due: "2026-10-01" }, "2026-10-12", "메일").status, "지연");
  assert.equal(I.makeEntry({ status: "임박", due: "2026-10-14" }, "2026-10-12", "메일").status, "임박");
});

test("안내 상태: 확인 필요 주문도 기록이 없으면 미안내, 기록 뒤 그대로면 안내완료", () => {
  assert.equal(I.stateOf(unknown, [], "2026-10-12").state, "미안내");
  const st = I.stateOf(unknown, ent("확인필요", "2026-10-10", ""), "2026-10-12");
  assert.equal(st.state, "안내완료");
  assert.equal(st.ago, 2);
});

test("다시 안내: 납기를 모른다고 안내했는데 나중에 납기가 확인되면 다시 안내한다 (지연·임박·정상 모두)", () => {
  const e = ent("확인필요", "2026-10-10", "");
  const late = I.stateOf({ status: "지연", due: "2026-10-05" }, e, "2026-10-12");
  assert.equal(late.state, "재안내필요");
  assert.match(late.reason, /확인하지 못했다고 안내한 뒤 납기가 확인/);
  assert.equal(I.stateOf({ status: "임박", due: "2026-10-14" }, e, "2026-10-12").state, "재안내필요");
});

test("다시 안내: 확인 필요 상태가 계속되면 지연처럼 7일 넘게 소식이 없을 때 다시 안내한다", () => {
  const e = ent("확인필요", "2026-10-01", "");
  assert.equal(I.stateOf(unknown, e, "2026-10-07").state, "안내완료");      // 6일
  const st = I.stateOf(unknown, e, "2026-10-08");                            // 7일
  assert.equal(st.state, "재안내필요");
  assert.match(st.reason, /7일째 새 소식을 알리지 않았어요/);
});

test("다시 안내: 확인 필요 상태에서 파일에 적힌 값이 바뀌어도 다시 안내한다", () => {
  const e = ent("확인필요", "2026-10-10", "미정");
  assert.equal(I.stateOf({ status: "확인필요", due: "미정" }, e, "2026-10-11").state, "안내완료");
  assert.equal(I.stateOf({ status: "확인필요", due: "10월 말" }, e, "2026-10-11").state, "재안내필요");
});

test("요약: 확인 필요는 임박에 섞이지 않고 따로 센다. 확인 필요로 먼저 안내했다가 지연이 되면 선제 안내다", () => {
  const items = [
    { order: { status: "지연", due: "2026-10-05" }, entries: ent("확인필요", "2026-10-02", "") },   // 확인 필요로 안내 -> 지연 (재안내 필요, 선제 안내)
    { order: { status: "지연", due: "2026-10-05" }, entries: [] },                                  // 지연·미안내
    { order: { status: "임박", due: "2026-10-14" }, entries: [] },
    { order: unknown, entries: [] },
    { order: unknown, entries: ent("확인필요", "2026-10-11", "") },                                  // 확인 필요·안내완료
  ];
  const s = I.summary(items, "2026-10-12");
  assert.equal(s.total, 5);
  assert.equal(s.지연, 2); assert.equal(s.임박, 1); assert.equal(s.확인필요, 2);
  assert.equal(s.미안내, 3); assert.equal(s.안내완료, 1); assert.equal(s.재안내필요, 1);
  assert.equal(s.preempt, 1);       // 지연 전에 (확인 필요 단계에서) 먼저 안내
  assert.equal(s.lateNone, 1);
  assert.equal(s.needAction, 4);
});

test("저장본: 안내 기록의 상태 '확인필요'를 버리지 않는다", () => {
  const c = clean({ informed: { A: [{ date: "2026-10-10", channel: "메일", status: "확인필요", due: "", note: "" }, { date: "2026-10-10", channel: "메일", status: "엉뚱", due: "" }] } });
  assert.equal(c.informed.A.length, 1);
  assert.equal(c.informed.A[0].status, "확인필요");
});

test("예외 목록 CSV: 확인 필요 주문에도 '연구원 안내' 상태가 들어간다", () => {
  const exc = [{ "주문번호": "A", "공급사": "s", status: "지연", daysLeft: -3 }];
  const chk = [{ "주문번호": "B", "공급사": "s", status: "확인필요" }];
  const rows = Report.exceptionRows(exc, chk, () => "기타·미확인", () => "", {}, o => "안내완료(" + o["주문번호"] + ")");
  assert.equal(rows[1][0], "확인 필요");
  assert.equal(rows[1][10], "안내완료(B)");
});

test("보고서: 확인 필요 주문이 있으면 안내 대상 문구에 '확인 필요'가 들어간다", () => {
  const input = informed => ({ base: "2026-10-12", fileName: "x.csv", total: 3, counts: { 지연: 1, 임박: 1, 정상: 0, 입고완료: 0, 확인필요: 1 }, delay: { total: 0, byCause: [], bySupplier: [], byRequester: [] }, groups: [], informed });
  const withUnknown = Report.buildReport(input({ total: 3, 지연: 1, 임박: 1, 확인필요: 1, 미안내: 3, 안내완료: 0, 재안내필요: 0, lateNone: 1, preempt: 0 }));
  assert.match(withUnknown, /연구원 안내: 지연·임박·확인 필요 3건 중 안내 완료 0건, 안내 안 함 3건/);
  const without = Report.buildReport(input({ total: 2, 지연: 1, 임박: 1, 확인필요: 0, 미안내: 2, 안내완료: 0, 재안내필요: 0, lateNone: 1, preempt: 0 }));
  assert.match(without, /연구원 안내: 지연·임박 2건 중/);          // 확인 필요가 없으면 예전 문구 그대로
});

const base = { researcher: "홍길동", item: "볼트", orderNo: "PO-1", reason: "", alternative: "", signature: "" };

test("안내문: 납기일을 읽을 수 없으면 '기존 납기일은 입니다' 같은 빈 문장 대신 확인하지 못했다고 쓴다", () => {
  const t = Notice.renderNotice("공지형", { ...base, due: "", oldDue: "", newDue: "", daysLeft: null, daysLate: 0 });
  assert.match(t, /납기일을 아직 확인하지 못했습니다\./);
  assert.ok(!/기존 납기일은/.test(t));
  assert.match(t, /확인되는 대로 다시 안내드리겠습니다/);
});

test("안내문: 파일에 적힌 값이 있으면 그대로 보여 주되 날짜로 지어내지 않는다", () => {
  const t = Notice.renderNotice("사과형", { ...base, due: "미정", oldDue: "미정", newDue: "", daysLeft: null, daysLate: 0 });
  assert.match(t, /납기일을 아직 확인하지 못했습니다\. \(파일에 적힌 값: 미정\)/);
  assert.ok(!/\d월 \d+일/.test(t));
});

test("한 통 안내문: 확인 필요 주문은 '납기 확인 중' 구간에 따로 담는다", () => {
  const items = [
    { orderNo: "A", item: "가", status: "지연", daysLeft: -5, due: "2026-10-07", oldDue: "", reason: "", partial: null, schedule: [] },
    { orderNo: "B", item: "나", status: "확인필요", daysLeft: null, due: "", oldDue: "", reason: "", partial: null, schedule: [] },
    { orderNo: "C", item: "다", status: "확인필요", daysLeft: null, due: "미정", oldDue: "", reason: "", partial: null, schedule: [] },
  ];
  const t = Notice.renderDigest("홍길동", items, "");
  assert.match(t, /■ 납기 지연 1건/);
  assert.match(t, /■ 납기 확인 중 2건/);
  assert.match(t, /1\. 나 \(B\)\n   - 납기: 아직 확인하지 못했습니다\n/);
  assert.match(t, /2\. 다 \(C\)\n   - 납기: 아직 확인하지 못했습니다 \(파일에 적힌 값: 미정\)/);
  assert.ok(!/■ 납기 임박/.test(t));                              // 임박이 없으면 그 구간은 없다
});
