// 지연 원인 분류 (규칙 기반). 원인 항목과 키워드는 여기 한 곳에서만 바꾼다.
(function (root) {
  const CATEGORIES = ["통관·서류", "생산·재고", "운송·선적", "주문 변경", "공급사 회신 없음", "기타·미확인"];
  const FALLBACK = "기타·미확인";
  // 위에서부터 처음 맞는 항목으로 분류한다. 키워드는 MRO 현업 경험(단종·대체품, 사양·수량 재확인, 해외 제조사 재고·생산)을 반영했다.
  // 항목 이름은 저장된 기록과 이어지므로 바꾸지 않는다.
  const RULES = [
    ["통관·서류", /통관|서류|세관|관세|인보이스|원산지|수입\s?허가|검역/],
    ["생산·재고", /생산|제작|재고|품절|부품|원자재|수급|단종|백오더|back\s?-?order|리드\s?타임|제조사|재생산|EOL/i],
    ["운송·선적", /선적|운송|배송|물류|항공|해상|선박|컨테이너|입항|화물|파업|기상|날씨/],
    // 연구원에게 다시 확인해야 하는 경우: 사양·수량 재확인, 대체품(대체 모델) 승인, 변경 요청
    ["주문 변경", /(?:사양|수량|규격|스펙|도면|모델)\s?(?:변경|수정|확인|재확인|불일치|오류)|대체\s?(?:품|모델|제품)|호환\s?(?:품|모델)|재견적|재발주|변경\s?요청|주문\s?(?:변경|수정)/],
    ["공급사 회신 없음", /회신\s?(?:없|미|지연)|납기\s?(?:미확인|문의|확인\s?중)|연락\s?두절|답변\s?없|문의\s?필요|재확인/],
  ];

  function classifyCause(text) {
    const s = String(text == null ? "" : text);
    if (!s.trim()) return FALLBACK;
    const hit = RULES.find(([, re]) => re.test(s));
    return hit ? hit[0] : FALLBACK;
  }

  const api = { CATEGORIES, FALLBACK, classifyCause };
  if (typeof module !== "undefined") module.exports = api; else root.Cause = api;
})(typeof window !== "undefined" ? window : globalThis);
