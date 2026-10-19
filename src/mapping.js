// Claude 열 매핑: 보낼 문장 만들기와 돌아온 답 검증. 네트워크 호출은 main.js가 한다.
const STD_INFO = {
  주문번호: "주문(발주) 하나를 구분하는 번호",
  품목명: "주문한 물품 이름",
  공급사: "물품을 공급하는 업체",
  요청자: "주문을 요청한 사람 또는 팀",
  발주일: "주문을 낸 날짜",
  납기일: "공급사가 회신한 납기(도착 예정) 날짜",
  선적상태: "선적 진행 상태",
  통관상태: "통관 진행 상태",
  입고여부: "물품이 들어왔는지(입고 완료 여부)",
  주문수량: "주문한 수량",
  입고수량: "지금까지 들어온(입고된) 수량",
  잔량납기: "일부만 들어온 뒤 남은 수량의 납기(분납 일정)",
  규격: "규격·모델명·사양",
  비고: "메모",
};
const STD = Object.keys(STD_INFO);
const LEVELS = ["높음", "보통", "낮음"];

// 보내는 내용: 열 이름과 앞 3행뿐이다.
function buildPayload(columns, rows) {
  return { columns, sampleRows: rows.slice(0, 3).map(r => columns.map(c => String(r[c] == null ? "" : r[c]).slice(0, 60))) };
}

function buildPrompt(payload) {
  return "너는 주문 목록 CSV의 열을 표준 열에 연결하는 도우미다.\n" +
    "표준 열:\n" + STD.map(k => "- " + k + ": " + STD_INFO[k]).join("\n") + "\n\n" +
    "CSV 열 이름(순서대로): " + JSON.stringify(payload.columns) + "\n" +
    "앞 " + payload.sampleRows.length + "행의 값(같은 순서): " + JSON.stringify(payload.sampleRows) + "\n\n" +
    "규칙: 열 이름과 값을 함께 보고 판단한다. 확실하지 않으면 column을 null로 두고 지어내지 않는다. 같은 CSV 열을 두 표준 열에 쓰지 않는다. CSV 열 이름은 위 목록의 것을 글자 그대로 쓴다. " +
    "confidence는 높음, 보통, 낮음 중 하나. reason은 한국어 한 문장.\n" +
    "JSON만 답한다: {\"mapping\":{" + STD.map(k => "\"" + k + "\":{\"column\":null,\"confidence\":\"낮음\",\"reason\":\"\"}").join(",") + "}}";
}

// 답에서 JSON을 꺼내 검증한다. 목록에 없는 열, 중복된 열은 버린다.
function parseMapping(text, columns) {
  const a = String(text).indexOf("{"), b = String(text).lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("응답에서 JSON을 찾지 못했습니다");
  const raw = JSON.parse(String(text).slice(a, b + 1)).mapping || {};
  const used = new Set(), out = {};
  const order = STD.slice().sort((x, y) => LEVELS.indexOf((raw[x] || {}).confidence) - LEVELS.indexOf((raw[y] || {}).confidence));
  order.forEach(std => {
    const e = raw[std] || {};
    const ok = typeof e.column === "string" && columns.includes(e.column) && !used.has(e.column);
    if (ok) used.add(e.column);
    out[std] = { column: ok ? e.column : "", confidence: LEVELS.includes(e.confidence) ? e.confidence : "낮음", reason: String(e.reason || "").slice(0, 120) };
  });
  return out;
}

module.exports = { STD, buildPayload, buildPrompt, parseMapping };
