// 지연 주문 집계. 화면과 무관한 순수 함수.
// 입력: 판정이 끝난 지연 주문 배열(각각 daysLeft 음수, 표준 열 포함), causeOf(주문) → 원인 항목.
(function (root) {
  function group(orders, keyOf) {
    const map = new Map();
    orders.forEach(o => {
      const key = keyOf(o);
      const late = -o.daysLeft;
      const g = map.get(key) || { name: key, count: 0, sum: 0, max: 0 };
      g.count += 1; g.sum += late; g.max = Math.max(g.max, late);
      map.set(key, g);
    });
    return [...map.values()].map(g => ({ name: g.name, count: g.count, avg: Math.round((g.sum / g.count) * 10) / 10, max: g.max }))
      .sort((a, b) => b.count - a.count || b.max - a.max || a.name.localeCompare(b.name, "ko"));
  }

  function summarize(delayed, causeOf) {
    const total = delayed.length;
    const days = delayed.map(o => -o.daysLeft);
    return {
      total,
      avgDays: total ? Math.round((days.reduce((a, b) => a + b, 0) / total) * 10) / 10 : 0,
      maxDays: total ? Math.max(...days) : 0,
      byCause: group(delayed, causeOf),
      bySupplier: group(delayed, o => (o["공급사"] || "").trim() || "(공급사 없음)"),
      byRequester: group(delayed, o => (o["요청자"] || "").trim() || "(요청자 없음)"),
    };
  }

  const api = { summarize };
  if (typeof module !== "undefined") module.exports = api; else root.Analyze = api;
})(typeof window !== "undefined" ? window : globalThis);
