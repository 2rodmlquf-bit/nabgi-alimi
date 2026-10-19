const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { plan, UNKNOWN } = require("../src/contact");
const { findExceptions } = require("../src/judge");
const { classifyCause } = require("../src/cause");
const { renderFollowUp } = require("../src/reask");
const { clean, mergeState } = require("../src/persist");
const { csvToObjects } = require("../src/csv");

const sampleOrders = () => csvToObjects(fs.readFileSync(path.join(__dirname, "..", "샘플주문.csv"), "utf8")).rows;
const planOf = (noReply = []) => {
  const r = findExceptions(sampleOrders(), "2026-10-12");
  return plan({ exceptions: r.exceptions, needCheck: r.needCheck, noReply, causeOf: o => classifyCause(o["비고"]) });
};

test("공급사별로 묶고 급한 순서로 정렬한다 (샘플: 지연 7·임박 8·확인 필요 2)", () => {
  const g = planOf();
  const total = g.reduce((n, x) => n + x.orders.length, 0);
  assert.equal(total, 17);                                              // 7 + 8 + 2, 한 주문은 한 번만
  assert.ok(g.every((x, i, a) => i === 0 || a[i - 1].score >= x.score));  // 점수 내림차순
  assert.equal(g[0].supplier, "가온산업");                              // 18일·1일 지연이 있는 업체가 가장 급하다
  assert.equal(g[0].maxLate, 18);
});

test("업체 안에서는 지연(오래된 순) → 임박(가까운 순) → 미회신 → 확인 필요", () => {
  const g = planOf().find(x => x.supplier === "가온산업");
  const rank = { 지연: 0, 임박: 1, 미회신: 2, 확인필요: 3 };
  assert.ok(g.orders.every((o, i, a) => i === 0 || rank[a[i - 1].status] <= rank[o.status]));
  const late = g.orders.filter(o => o.status === "지연");
  assert.ok(late.every((o, i, a) => i === 0 || a[i - 1].days >= o.days));
});

test("지연 주문에는 지연 원인(규칙)이 붙는다", () => {
  const o = planOf().flatMap(x => x.orders).find(x => x.orderNo === "PO-2026-1002");
  assert.equal(o.status, "지연");
  assert.equal(o.cause, "통관·서류");
});

test("공급사 엑셀의 미회신: 이미 있는 주문에는 표시만, 정상 주문이면 새로 추가", () => {
  const g = planOf([
    { orderNo: "PO-2026-1001", supplier: "가온산업", item: "산업용 베어링 6204", from: "2026-09-24", reply: "확인 후 회신" },  // 이미 지연
    { orderNo: "PO-2026-1020", supplier: "다온상사", item: "냉각 팬 120mm", from: "2026-11-01", reply: "" },                    // 정상 주문인데 회신이 없음
  ]);
  const all = g.flatMap(x => x.orders);
  const a = all.find(o => o.orderNo === "PO-2026-1001");
  assert.equal(a.status, "지연");
  assert.equal(a.noReply, true);
  assert.equal(a.reply, "확인 후 회신");
  const b = all.find(o => o.orderNo === "PO-2026-1020");
  assert.deepEqual([b.status, b.supplier], ["미회신", "다온상사"]);
  assert.equal(all.filter(o => o.orderNo === "PO-2026-1001").length, 1);       // 중복 없음
});

test("공급사 열이 없으면 '(공급사 미상)'으로 모은다", () => {
  const g = plan({ exceptions: [{ 주문번호: "A1", status: "지연", daysLeft: -3, 납기일: "2026-10-09" }] });
  assert.equal(g[0].supplier, UNKNOWN);
  assert.equal(g[0].orders[0].days, 3);
});

test("문의 문구: 지연·임박·확인 필요·미회신을 나눠 적고, 공급사가 적은 말과 서명을 남긴다", () => {
  const orders = [
    { orderNo: "PO-1", item: "베어링", status: "지연", days: 18, due: "2026-09-24", noReply: true, reply: "확인 후 회신" },
    { orderNo: "PO-2", item: "호스", status: "임박", days: 0, due: "2026-10-12" },
    { orderNo: "PO-3", item: "", status: "확인필요", days: 0, due: "" },
    { orderNo: "PO-4", item: "필터", status: "미회신", days: 0, due: "2026-10-30", reply: "" },
  ];
  const t = renderFollowUp("가온산업", orders, "구매팀 홍길동 드림");
  assert.ok(t.startsWith("안녕하세요, 가온산업 담당자님."));
  assert.ok(t.includes("[납기 지연]\n- PO-1 베어링 (납기 9월 24일(목), 18일 경과, 회신 내용: 확인 후 회신)"));
  assert.ok(t.includes("- PO-2 호스 (납기 10월 12일(월), 오늘)"));
  assert.ok(t.includes("- PO-3 (납기일이 비어 있어 확인 부탁드립니다)"));
  assert.ok(renderFollowUp("A", [{ orderNo: "P", item: "", status: "확인필요", days: 0, due: "곧 도착" }]).includes('(납기일 "곧 도착"을 읽을 수 없어 확인 부탁드립니다)'));
  assert.ok(t.includes("[회신 미확인]\n- PO-4 필터 (현재 납기 10월 30일(금))"));
  assert.ok(t.endsWith("구매팀 홍길동 드림"));
  assert.ok(renderFollowUp("(공급사 미상)", [orders[0]]).startsWith("안녕하세요, 담당자님."));
  assert.ok(!renderFollowUp("A", [orders[1]]).includes("[납기 지연]"));       // 없는 구간은 빼고 쓴다
});

test("연락함 표시는 저장되고, 해제하면 저장본에서도 사라진다", () => {
  assert.deepEqual(clean({ contacted: { 가온산업: "2026-10-12", 깨진: 5 } }).contacted, { 가온산업: "2026-10-12" });
  const saved = { contacted: { 가온산업: "2026-10-09", 나래테크: "2026-10-09" } };
  const m = mergeState(saved, { edited: {}, reasons: {}, causeOverride: {}, notice: null, contacted: { 가온산업: "2026-10-12" } }, []);
  assert.deepEqual(m.contacted, { 가온산업: "2026-10-12" });                   // 나래테크는 해제됨
});

// ---- 무응답 대응 (연락 이력, 다음 조치 문구) ----
const { renderChat, renderHeadsUp, renderEscalation } = require("../src/reask");
const { status } = require("../src/escalate");

const ords = [
  { orderNo: "PO-1", item: "베어링", status: "지연", days: 18, due: "2026-09-24", requester: "연구1팀 A연구원" },
  { orderNo: "PO-2", item: "호스", status: "임박", days: 2, due: "2026-10-14" },
  { orderNo: "PO-3", item: "필터", status: "지연", days: 4, due: "2026-10-08" },
  { orderNo: "PO-4", item: "펌프", status: "지연", days: 1, due: "2026-10-11" },
];
const st3 = status([{ date: "2026-10-08", kind: "attempt", channel: "메일" }, { date: "2026-10-09", kind: "attempt", channel: "카톡·문자" }, { date: "2026-10-10", kind: "attempt", channel: "전화" }], "2026-10-12");

test("무응답 횟수가 많은 업체는 점수가 올라 더 위에 온다", () => {
  const res = findExceptions(sampleOrders(), "2026-10-12");
  const base = plan({ exceptions: res.exceptions, needCheck: res.needCheck, causeOf: o => classifyCause(o["비고"]) });
  const idx = name => base.findIndex(g => g.supplier === name);
  assert.ok(idx("나래테크") > idx("가온산업"));
  const boosted = plan({ exceptions: res.exceptions, needCheck: res.needCheck, causeOf: o => classifyCause(o["비고"]), bonus: { 나래테크: 100 } });
  assert.equal(boosted[0].supplier, "나래테크");
  assert.equal(boosted[0].bonus, 100);
  assert.equal(base.flatMap(g => g.orders).find(o => o.orderNo === "PO-2026-1001").requester, "연구1팀 A연구원");   // 연구원 안내용
});

test("짧은 재연락 문구: 주문은 3건까지, 나머지는 '외 N건', 날짜는 적지 않는다", () => {
  const t = renderChat("가온산업", ords, "구매팀 홍길동");
  assert.ok(t.startsWith("안녕하세요, 가온산업 담당자님."));
  assert.ok(t.includes("- PO-1 베어링") && t.includes("- PO-3 필터") && !t.includes("PO-4"));
  assert.ok(t.includes("외 1건"));
  assert.ok(!t.includes("2026"));
  assert.ok(t.endsWith("구매팀 홍길동"));
  assert.ok(t.split("\n").length <= 10);                                              // 카톡·문자용으로 짧게
});

test("연구원 사전 안내: 연락 횟수·채널과 지연 가능성, 전화로 들은 날짜가 지났으면 그 사실", () => {
  const t = renderHeadsUp("연구1팀 A연구원", "가온산업", ords.slice(0, 2), st3, "구매팀 홍길동");
  assert.ok(t.startsWith("안녕하세요, 연구1팀 A연구원님."));
  assert.ok(t.includes("- PO-1 베어링 (납기 9월 24일(목), 18일 경과)"));
  assert.ok(t.includes("가온산업에 3회(메일, 카톡·문자, 전화) 연락했으나 아직 회신이 없습니다."));
  assert.ok(t.includes("대체 방안도 함께 검토하겠습니다"));
  const broken = status([{ date: "2026-10-06", kind: "reply", channel: "전화", promised: "2026-10-09" }], "2026-10-12", true);
  assert.ok(renderHeadsUp("김연구", "가온산업", ords.slice(0, 1), broken).includes("전화로 들은 날짜(10월 9일(금))가 지났지만 아직 입고되지 않았습니다."));
});

test("상급자 보고: 연락 이력·영향 주문·요청 사항", () => {
  const t = renderEscalation("가온산업", ords, st3, "");
  assert.ok(t.includes("- 공급사: 가온산업"));
  assert.ok(t.includes("총 3회(메일, 카톡·문자, 전화), 마지막 2026-10-10, 무응답 4일째"));
  assert.ok(t.includes("영향 주문 4건:"));
  assert.ok(t.includes("대체 공급사·대체품 검토"));
  assert.ok(!renderEscalation("A", ords, status([], "2026-10-12"), "").includes("무응답"));      // 기록이 없으면 "기록 없음"
});

test("연락 이력 저장: 깨진 항목은 버리고, 해제하면 저장본에서도 사라진다", () => {
  const log = { 가온산업: [{ date: "2026-10-10", kind: "attempt", channel: "메일" }, { date: "깨짐", kind: "attempt" }, { date: "2026-10-11", kind: "reply", channel: "전화", promised: "2026-10-15", note: "다음 주" }, { date: "2026-10-12", kind: "x" }] };
  const c = clean({ contactLog: log }).contactLog;
  assert.equal(c.가온산업.length, 2);
  assert.deepEqual(c.가온산업[1], { date: "2026-10-11", kind: "reply", channel: "전화", promised: "2026-10-15", note: "다음 주" });
  const m = mergeState({ contactLog: log }, { edited: {}, reasons: {}, causeOverride: {}, notice: null, contacted: {}, contactLog: {} }, []);
  assert.deepEqual(m.contactLog, {});
});

// ---- 대체품 확인, 분납 일정 ----
const { renderSubstApprove, renderSubstSupplier } = require("../src/reask");
const { renderNotice } = require("../src/notice");
const rowsCmp = [
  { label: "품목명", list: "에어 필터 카트리지", sup: "에어 필터 (FA-130)", differs: true },
  { label: "규격", list: "FA-120", sup: "FA-130", differs: true },
  { label: "수량", list: "10", sup: "10", differs: false },
  { label: "비고", list: "", sup: "" },
];

test("대체품 승인 요청 문구: 항목별 비교와 확인 근거, 승인 전 발송 보류", () => {
  const t = renderSubstApprove("연구2팀 D연구원", { orderNo: "PO-2026-1004", item: "에어 필터 카트리지" }, rowsCmp, ["품목명이 달라요"], "구매팀 홍길동");
  assert.ok(t.startsWith("안녕하세요, 연구2팀 D연구원님."));
  assert.ok(t.includes("- 품목명: 주문 에어 필터 카트리지 / 회신 에어 필터 (FA-130) (다름)"));
  assert.ok(t.includes("- 수량: 주문 10 / 회신 10") && !t.includes("- 수량: 주문 10 / 회신 10 (다름)"));
  assert.ok(!t.includes("- 비고"));                                              // 둘 다 비어 있는 항목은 뺀다
  assert.ok(t.includes("확인 근거: 품목명이 달라요"));
  assert.ok(t.includes("승인해 주시기 전에는 대체품이 발송되지 않도록"));
  assert.ok(t.endsWith("구매팀 홍길동"));
});

test("공급사 문구: 사전 승인 요구(발송 보류)와 반려(원 품목으로 재발송)", () => {
  const hold = renderSubstSupplier("나래테크", { orderNo: "PO-2026-1004", item: "에어 필터 카트리지" }, rowsCmp, "hold", "");
  assert.ok(hold.startsWith("안녕하세요, 나래테크 담당자님."));
  assert.ok(hold.includes("대체품을 발송하지 말아 주세요") && hold.includes("대체품 사양서"));
  const rej = renderSubstSupplier("나래테크", { orderNo: "PO-2026-1004", item: "" }, rowsCmp, "reject", "");
  assert.ok(rej.includes("사용 승인이 나지 않아, 원래 주문한 품목으로 발송을 부탁드립니다."));
  assert.ok(!rej.includes("사양서"));
  assert.ok(renderSubstSupplier("(공급사 미상)", { orderNo: "A" }, [], "hold").startsWith("안녕하세요, 담당자님."));
});

test("부분 납품 안내문: 수량과 분납 일정을 숫자로 보여 주고, 수량 정보가 없으면 지어내지 않는다", () => {
  const v = { researcher: "김연구", item: "윤활 그리스", orderNo: "PO-8", oldDue: "2026-10-12", newDue: "", daysLate: 0, reason: "", alternative: "", signature: "",
    partial: { ordered: 10, received: 6, remaining: 4, remainDue: "2026-10-20" }, schedule: [{ date: "2026-10-15", qty: "6" }, { date: "2026-10-20", qty: "4" }] };
  const t = renderNotice("부분 납품 안내", v);
  assert.ok(t.includes("- 주문 수량: 10") && t.includes("- 입고 수량: 6") && t.includes("- 잔량: 4 (입고 예정 10월 20일(화))"));
  assert.ok(t.includes("- 1차 입고 예정: 10월 15일(목) · 수량 6") && t.includes("- 2차 입고 예정: 10월 20일(화) · 수량 4"));
  assert.ok(t.includes("급히 필요한 수량이 있으신지"));
  const none = renderNotice("부분 납품 안내", { ...v, partial: null, schedule: [] });
  assert.ok(none.includes("일부 수량만 먼저 입고되었음") && !none.includes("주문 수량:"));
});

test("대체품 상태·분납 일정 저장: 허용된 상태만, 해제하면 저장본에서도 사라진다", () => {
  const saved = { subst: { A: { state: "의심", supItem: "x", date: "2026-10-12" }, B: { state: "이상한상태" }, C: null }, schedule: { A: [{ date: "2026-10-15", qty: 6 }, { date: "깨짐" }] } };
  const c = clean(saved);
  assert.deepEqual(Object.keys(c.subst), ["A"]);
  assert.equal(c.subst.A.supItem, "x");
  assert.deepEqual(c.schedule.A, [{ date: "2026-10-15", qty: "6" }]);
  const m = mergeState(saved, { edited: {}, reasons: {}, causeOverride: {}, notice: null, contacted: {}, contactLog: {}, subst: {}, schedule: {} }, ["A"]);
  assert.deepEqual([m.subst, m.schedule], [{}, {}]);
});
