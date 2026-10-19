// "오늘 연락할 곳": 지연·임박·확인 필요·미회신 주문을 공급사별로 묶고, 급한 순서로 정렬한다. 화면과 무관한 순수 함수.
(function (root) {
  const UNKNOWN = "(공급사 미상)";
  // 정렬 점수(가정): 지연은 오래될수록, 임박은 가까울수록 급하다. 확인 필요·미회신은 상대적으로 낮다.
  const scoreOf = o => (o.status === "지연" ? 10 + Math.min(o.days, 30) : o.status === "임박" ? 6 + Math.max(0, 7 - o.days) : o.status === "확인필요" ? 4 : 3) + (o.noReply && o.status !== "미회신" ? 3 : 0);
  const ORDER = { 지연: 0, 임박: 1, 미회신: 2, 확인필요: 3 };

  // exceptions: 판정된 지연·임박 주문(daysLeft 포함, 표준 열 포함) / needCheck: 납기일을 읽을 수 없는 주문
  // noReply: 공급사 엑셀 비교에서 나온 미회신 [{orderNo, supplier, item, from, reply}]
  // bonus: { 공급사: 점수 } 연락해도 답이 없는 업체는 더 위로 올린다 (화면에서 무응답 횟수로 계산해 넘긴다)
  function plan({ exceptions = [], needCheck = [], noReply = [], causeOf = () => "", bonus = {} }) {
    const byNo = new Map();
    const supplierOf = o => (o["공급사"] || "").trim() || UNKNOWN;
    exceptions.forEach(o => {
      const late = o.status === "지연";
      byNo.set(o["주문번호"], { orderNo: o["주문번호"], item: (o["품목명"] || "").trim(), supplier: supplierOf(o), requester: (o["요청자"] || "").trim(), partial: o.partial || null, status: o.status, days: late ? -o.daysLeft : o.daysLeft, due: o["납기일"] || "", cause: late ? causeOf(o) : "", noReply: false, reply: "" });
    });
    needCheck.forEach(o => { if (!byNo.has(o["주문번호"])) byNo.set(o["주문번호"], { orderNo: o["주문번호"], item: (o["품목명"] || "").trim(), supplier: supplierOf(o), status: "확인필요", days: 0, due: o["납기일"] || "", cause: "", noReply: false, reply: "" }); });
    noReply.forEach(x => {
      const e = byNo.get(x.orderNo);
      if (e) { e.noReply = true; e.reply = x.reply || ""; if (e.supplier === UNKNOWN && x.supplier) e.supplier = x.supplier; }
      else byNo.set(x.orderNo, { orderNo: x.orderNo, item: x.item || "", supplier: (x.supplier || "").trim() || UNKNOWN, status: "미회신", days: 0, due: x.from || "", cause: "", noReply: true, reply: x.reply || "" });
    });
    const groups = new Map();
    byNo.forEach(o => {
      o.score = scoreOf(o);
      if (!groups.has(o.supplier)) groups.set(o.supplier, { supplier: o.supplier, orders: [], counts: { 지연: 0, 임박: 0, 확인필요: 0, 미회신: 0 }, score: 0, maxLate: 0 });
      const g = groups.get(o.supplier);
      g.orders.push(o); g.counts[o.status]++; g.score += o.score;
      if (o.status === "지연") g.maxLate = Math.max(g.maxLate, o.days);
    });
    groups.forEach(g => { g.bonus = bonus[g.supplier] || 0; g.score += g.bonus; });
    groups.forEach(g => g.orders.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === "지연" ? b.days - a.days : a.days - b.days) || a.orderNo.localeCompare(b.orderNo)));
    return [...groups.values()].sort((a, b) => b.score - a.score || a.supplier.localeCompare(b.supplier, "ko"));
  }

  const api = { UNKNOWN, plan };
  if (typeof module !== "undefined") module.exports = api; else root.Contact = api;
})(typeof window !== "undefined" ? window : globalThis);
