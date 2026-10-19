// 빠른 메모: 전화·메신저로 받은 지연 소식을 잊기 전에 주문에 남긴다 (PRD FR-12, CUJ-3). 화면과 무관한 순수 함수.
// 입력은 메모 글 하나뿐이고 시각은 자동이다. 채널·분류 같은 필수 항목을 두지 않는다 (입력이 번거로우면 쓰지 않게 된다).
// 메모는 안내 상태·판정에 영향을 주지 않는다. 그런 규칙을 이 모듈에 넣지 않는다 (열린 질문 Q-3.1).
//
// notes = { 주문번호: [{ text, createdAt, id? }] }  오래된 것부터. id는 저장소가 저장할 때 붙인다 (src/store/core.js).
(function (root) {
  const MAX_LEN = 300;    // 한 건 글자 수
  const MAX_LIVE = 50;    // 주문당 최근 몇 건까지 보관하나

  // 300자(UTF-16 기준, 저장소와 같다)로 자르되 이모지 같은 문자 쌍의 반쪽만 남기지 않는다.
  function clip(text) {
    if (text.length <= MAX_LEN) return text;
    const cut = text.slice(0, MAX_LEN), last = cut.charCodeAt(MAX_LEN - 1);
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, MAX_LEN - 1) : cut;
  }

  // 메모를 남긴다. now는 ISO 시각 글자. 성공하면 { ok: true, clipped, dropped, note }, 빈 글이면 { ok: false, reason: "empty" }.
  // dropped = 상한(50건) 때문에 목록에서 빠진 오래된 메모 수. notes를 직접 바꾼다.
  function add(notes, orderNo, text, now) {
    const t = typeof text === "string" ? text.trim() : "";
    if (!t) return { ok: false, reason: "empty" };
    const clipped = t.length > MAX_LEN;
    const note = { text: clip(t), createdAt: now };
    const list = notes[orderNo] = notes[orderNo] || [];
    list.push(note);
    let dropped = 0;
    while (list.length > MAX_LIVE) { list.shift(); dropped++; }
    return { ok: true, clipped, dropped, note };
  }

  // 화면에 보여 줄 목록: 최신순. 저장 순서는 바꾸지 않고, 같은 객체를 돌려준다 (지울 때 그 객체를 넘긴다).
  const list = (notes, orderNo) => (notes[orderNo] || []).slice().reverse();
  const count = (notes, orderNo) => (notes[orderNo] || []).length;

  // 메모를 지운다. 같은 객체이거나 같은 id이면 찾는다 (다시 불러온 메모는 다른 객체라서). 마지막 메모를 지우면 주문 항목도 없앤다.
  function remove(notes, orderNo, ref) {
    const l = notes[orderNo];
    if (!l || !ref) return false;
    let i = l.indexOf(ref);
    if (i < 0 && ref.id) i = l.findIndex(n => n.id === ref.id);
    if (i < 0) return false;
    l.splice(i, 1);
    if (!l.length) delete notes[orderNo];
    return true;
  }

  // 표시용 시각: 로컬 시각 "월-일 시:분". 읽을 수 없으면 빈 글자.
  function stamp(iso) {
    const d = typeof iso === "string" ? new Date(iso) : null;
    if (!d || isNaN(d)) return "";
    const p = n => String(n).padStart(2, "0");
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  const api = { MAX_LEN, MAX_LIVE, add, list, count, remove, stamp };
  if (typeof module !== "undefined") module.exports = api; else root.QuickNote = api;
})(typeof window !== "undefined" ? window : globalThis);
