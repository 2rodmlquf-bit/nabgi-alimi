// 홈(HM-11-T)의 "지금 할 일" 세 묶음을 만든다 (Intent 체크리스트 3번, PRD FR-20·26). 화면과 무관한 순수 함수라서 규칙을 시험으로 고정한다.
//   - 안내할 것: 지연·임박·확인 필요 주문 중 아직 안내하지 않았거나 "다시 안내"인 것
//   - 회신 늦음: src/replies.js가 계산한 것 (약속일이 지났는데 새 회신이 없음)
//   - 오늘 연락할 곳: "오늘 연락할 곳" 탭(src/contact.js)의 결과를 읽기만 한다. 그 탭의 계산은 바꾸지 않는다.
(function (root) {
  const TOP = 3;
  const NEED = ["지연", "임박", "확인필요"];                      // 판정 상태 (내부 값)
  const RANK = { 지연: 0, 임박: 1, 확인필요: 2 };

  // 안내할 것. orders: 판정된 주문(status, daysLeft, 주문번호, 품목명), stateOf(o) -> { state: "미안내"|"재안내필요"|… }
  // 급한 순서: 지연(오래된 것 먼저) → 임박(가까운 것 먼저) → 확인 필요. 같으면 주문번호 순.
  function informList(orders, stateOf) {
    const out = [];
    (orders || []).forEach(o => {
      if (!NEED.includes(o.status)) return;
      const st = (stateOf(o) || {}).state;
      if (st !== "미안내" && st !== "재안내필요") return;
      out.push({ no: o["주문번호"], product: (o["품목명"] || "").trim(), status: o.status, again: st === "재안내필요", days: o.status === "지연" ? -(o.daysLeft || 0) : o.daysLeft || 0 });
    });
    return out.sort((a, b) => RANK[a.status] - RANK[b.status] || (a.status === "지연" ? b.days - a.days : a.days - b.days) || (a.no < b.no ? -1 : a.no > b.no ? 1 : 0));
  }

  // 세 묶음을 화면용으로 줄인다. input = { inform: informList 결과, late: Replies.lateOrders 결과, contact: Contact.plan 결과(오늘 연락 안 한 곳만) }
  function summarize(input, top) {
    const n = top || TOP, i = input || {}, inform = i.inform || [], late = (i.late && i.late.late) || [], quiet = (i.late && i.late.quiet) || [], contact = i.contact || [];
    const res = {
      inform: { total: inform.length, again: inform.filter(x => x.again).length, fresh: inform.filter(x => !x.again).length, top: inform.slice(0, n) },
      late: { total: late.length, quiet: quiet.length, top: late.slice(0, n) },
      contact: { total: contact.length, orders: contact.reduce((a, g) => a + g.orders.length, 0), top: contact.slice(0, n).map(g => ({ supplier: g.supplier, orders: g.orders.length, counts: g.counts })) },
    };
    res.empty = !res.inform.total && !res.late.total && !res.contact.total;
    return res;
  }

  // 처음 시작 안내(HM-24-A): 파일이 열려 있는데 기록이 하나도 없을 때. 3단계의 끝난 정도를 돌려준다.
  //   state = { hasFile, opened(주문을 눌러 본 적 있음), records(안내·메모·회신 기록 수) }
  function startSteps(state) {
    const s = state || {};
    const steps = [{ n: 1, title: "목록 열기", done: !!s.hasFile }, { n: 2, title: "예외 목록에서 주문 눌러 보기", done: !!s.opened }, { n: 3, title: "안내함으로 기록 남기기", done: (s.records || 0) > 0 }];
    return { show: !!s.hasFile && !(s.records > 0), steps, current: (steps.find(x => !x.done) || {}).n || 0 };
  }

  // 연구원 문의 요약(LS-27-A): 연구원으로 필터했을 때 그 사람의 주문을 한 줄로 요약한다 (FR-23, 결정 2026-10-20: 입고 완료는 뺀다).
  //   orders: 그 연구원의 판정된 주문(status), informCount: 그 중 안내할 것 수, lateCount·quietCount: 회신 늦음(조용하지 않은 것·조용한 것) 수
  function requesterSummary(orders, extra) {
    const x = extra || {}, open = (orders || []).filter(o => NEED.includes(o.status));
    const count = st => open.filter(o => o.status === st).length;
    return { total: open.length, late: count("지연"), soon: count("임박"), check: count("확인필요"), inform: x.informCount || 0, replyLate: x.lateCount || 0, replyQuiet: x.quietCount || 0 };
  }

  const api = { TOP, informList, summarize, startSteps, requesterSummary };
  if (typeof module !== "undefined") module.exports = api; else root.Home = api;
})(typeof window !== "undefined" ? window : globalThis);
