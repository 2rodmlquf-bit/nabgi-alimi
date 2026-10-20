// 같은 주문번호가 여러 줄에 나오는지 찾는다. 앱은 안내 기록·메모·사유를 "주문번호 하나"에 붙이므로,
// 주문번호가 겹치면(품목이 여러 줄인 주문 등) 기록이 그 주문번호의 모든 줄에 함께 보인다. 그 사실을 알리려고 쓴다 (ADR-0004의 미검증 가정).
(function (root) {
  // rows: 객체 배열, col: 주문번호 열 이름. 돌려주는 값: { count: 겹치는 주문번호 수, rows: 겹치는 줄 수, sample: 앞쪽 5개 [{ no, n }] }
  function findDuplicates(rows, col) {
    const seen = new Map();
    if (col) for (const r of rows || []) { const no = String(r[col] == null ? "" : r[col]).trim(); if (no) seen.set(no, (seen.get(no) || 0) + 1); }
    const dup = [...seen].filter(([, n]) => n > 1).map(([no, n]) => ({ no, n }));
    return { count: dup.length, rows: dup.reduce((a, d) => a + d.n, 0), sample: dup.slice(0, 5) };
  }
  const api = { findDuplicates };
  if (typeof module !== "undefined") module.exports = api; else root.Duplicates = api;
})(typeof window !== "undefined" ? window : globalThis);
