// 용어 사전 (IA 5절, 결정 G-3). 화면에 쓰는 말을 한곳에 모아 같은 개념이 다른 이름으로 흩어지지 않게 한다.
// 전체 문자열이 아니라 "용어 사전의 항목"만 둔다 (상태 이름처럼 여러 화면에 반복되는 말).
// 코드 안의 값(재안내필요, 확인필요, 안내완료 ...)은 붙여 쓰지만, 화면에는 아래 말만 보인다.
(function (root) {
  // 안내 상태: Informed.stateOf의 state 값 → 화면 문구
  const STATE = { 미안내: "미안내", 안내완료: "안내 완료", 재안내필요: "다시 안내" };
  // 주문 상태: Judge의 status / counts 키 → 화면 문구
  const STATUS = { 지연: "지연", 임박: "임박", 확인필요: "확인 필요", 정상: "정상", 입고완료: "입고 완료" };
  // 화면에 나오면 안 되는 말과 대신 쓸 말. 화면 문구 점검(E2E S-06)이 이 목록으로 화면 전체를 훑는다.
  const BANNED = [
    { word: "재안내", use: "다시 안내" },
    { word: "확인필요", use: "확인 필요" },
    { word: "안내완료", use: "안내 완료" },
    { word: "입고완료", use: "입고 완료" },
  ];

  const state = s => (STATE[s] !== undefined ? STATE[s] : String(s));
  const status = s => (STATUS[s] !== undefined ? STATUS[s] : String(s));
  // 글 안에서 금지어를 찾아 [{ word, use, count }]로 돌려준다.
  const findBanned = text => BANNED.map(b => ({ ...b, count: String(text).split(b.word).length - 1 })).filter(b => b.count > 0);

  const api = { STATE, STATUS, BANNED, state, status, findBanned };
  if (typeof module !== "undefined") module.exports = api; else root.Labels = api;
})(typeof window !== "undefined" ? window : globalThis);
