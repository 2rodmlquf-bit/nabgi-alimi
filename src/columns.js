// 열 이름 추측: 파일의 열 이름을 우리 표준 열(주문번호, 납기일 …)에 연결한다. 화면과 무관한 순수 함수.
// (예전에는 renderer.js 안에 있어서 단위 테스트를 할 수 없었다.)
(function (root) {
  const STD = ["주문번호", "품목명", "공급사", "요청자", "발주일", "납기일", "선적상태", "통관상태", "입고여부", "주문수량", "입고수량", "잔량납기", "규격", "비고"];
  // 열 이름을 추측할 때 더 구체적인 이름(잔량납기, 입고수량)을 먼저 맞춘다. 안 그러면 "납기"·"입고"가 그 열을 가져가 버린다.
  const GUESS_ORDER = ["잔량납기", "입고수량", "주문번호", "품목명", "공급사", "요청자", "발주일", "납기일", "선적상태", "통관상태", "입고여부", "주문수량", "규격", "비고"];
  const REQUIRED = ["주문번호", "납기일"];
  // 열 이름 추측용 단어 (가정). 나중에 Claude 매핑이 이 자리를 대신한다.
  const HINTS = {
    주문번호: ["주문번호", "발주번호", "po", "오더"], 품목명: ["품목", "품명", "자재", "item"], 공급사: ["공급사", "공급업체", "거래처", "vendor", "supplier"],
    요청자: ["요청자", "신청자", "연구원", "담당"], 발주일: ["발주일", "주문일", "order date"], 납기일: ["납기", "due", "delivery"],
    선적상태: ["선적", "shipping"], 통관상태: ["통관", "customs"], 입고여부: ["입고", "수령", "검수", "received"], 비고: ["비고", "메모", "note", "remark"],
    주문수량: ["주문수량", "발주수량", "수량", "qty", "quantity"], 입고수량: ["입고수량", "수령수량", "입고량", "받은수량", "누적입고"],
    잔량납기: ["잔량납기", "잔여납기", "분납납기", "2차납기"], 규격: ["규격", "모델", "사양", "spec", "model"],
  };

  function guessMapping(columns) {
    const m = {}, used = new Set();
    GUESS_ORDER.forEach(std => {
      const lower = columns.map(c => c.toLowerCase());
      let idx = lower.indexOf(std.toLowerCase());
      if (idx < 0) idx = lower.findIndex((c, i) => !used.has(i) && HINTS[std].some(h => c.includes(h.toLowerCase())));
      if (idx >= 0 && !used.has(idx)) { used.add(idx); m[std] = columns[idx]; } else m[std] = "";
    });
    return m;
  }

  const api = { STD, GUESS_ORDER, REQUIRED, HINTS, guessMapping };
  if (typeof module !== "undefined") module.exports = api; else root.Columns = api;
})(typeof window !== "undefined" ? window : globalThis);
