// 연구원 안내 기록: 지연·임박 주문마다 "연구원에게 알렸는가"를 남기고, 다시 알려야 하는지 판단한다. 화면과 무관한 순수 함수.
// 기록 한 건: { date, channel, status("지연"|"임박"|"확인필요": 알린 시점의 상태), due(알린 시점의 납기일 칸의 글자), note }
// "확인필요"는 납기일을 읽을 수 없는 주문이다. 이런 주문도 연구원에게 "아직 납기를 모른다"고 알려야 하므로 안내 대상이다 (G-8).
(function (root) {
  const J = typeof require !== "undefined" ? require("./judge") : root.Judge;
  const CHANNELS = ["메일", "카톡·문자", "전화", "구두", "기타"];
  // 가정: 지연 중인 주문은 이 일수가 넘도록 새 소식을 안 알리면 다시 알려야 한다고 본다.
  // 설정할 수 있는 범위 (FR-18). 기본은 7일.
  const STALE_DAYS = 7, MIN_STALE_DAYS = 1, MAX_STALE_DAYS = 30;

  // 화면 입력(글자)을 검사한다. 1~30의 정수만 받는다. 성공 { ok: true, days }, 실패 { ok: false, reason }.
  function parseDays(raw) {
    const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    if (!s) return { ok: false, reason: "일수를 입력해 주세요." };
    if (!/^-?\d+$/.test(s)) return { ok: false, reason: "숫자(정수)만 넣을 수 있어요." };
    const n = parseInt(s, 10);
    if (n < MIN_STALE_DAYS || n > MAX_STALE_DAYS) return { ok: false, reason: MIN_STALE_DAYS + "~" + MAX_STALE_DAYS + "일 사이로 넣어 주세요." };
    return { ok: true, days: n };
  }
  // 저장된 값 정리: 범위 안의 정수만 인정하고 나머지는 null(= 기본값을 쓴다).
  const cleanDays = v => (Number.isInteger(v) && v >= MIN_STALE_DAYS && v <= MAX_STALE_DAYS ? v : null);
  const dayGap = (a, b) => { const x = J.parseDate(a), y = J.parseDate(b); return x && y ? Math.round((y - x) / 86400000) : 0; };
  // 납기일은 표기가 제각각이라 날짜로 바꿔 비교하고, 날짜로 읽을 수 없으면 글자로 비교한다.
  const sameDue = (a, b) => {
    const x = J.parseDate(a), y = J.parseDate(b);
    return x && y ? x.getTime() === y.getTime() : String(a || "").trim() === String(b || "").trim();
  };

  function makeEntry(order, base, channel, note) {
    return { date: base, channel: CHANNELS.includes(channel) ? channel : "기타", status: order.status === "지연" ? "지연" : order.status === "확인필요" ? "확인필요" : "임박", due: String(order.due || ""), note: String(note || "").slice(0, 200) };
  }

  // 같은 날 같은 채널로 같은 상태·납기를 또 기록하는 중복 클릭은 막는다. 새로 쌓았으면 true.
  function append(log, orderNo, entry) {
    const list = log[orderNo] = log[orderNo] || [];
    const last = list[list.length - 1];
    if (last && last.date === entry.date && last.channel === entry.channel && last.status === entry.status && last.due === entry.due) return false;
    list.push(entry);
    return true;
  }

  // 가장 최근 기록을 지운다. 지울 게 없으면 false.
  function undo(log, orderNo) {
    const list = log[orderNo];
    if (!list || !list.length) return false;
    list.pop();
    if (!list.length) delete log[orderNo];
    return true;
  }

  // order: { status("지연"|"임박"), due } / entries: 그 주문의 기록 / base: 기준일
  // state: 미안내 | 안내완료 | 재안내필요 (reason은 재안내가 필요한 이유)
  function stateOf(order, entries, base, staleDays = STALE_DAYS) {
    const list = entries || [];
    if (!list.length) return { state: "미안내", reason: "", last: null, ago: null };
    const last = list[list.length - 1];
    const ago = dayGap(last.date, base);
    let reason = "";
    if (last.due && order.due && !sameDue(last.due, order.due)) reason = "안내한 뒤 납기가 바뀌었어요";
    else if (last.status === "확인필요" && order.status !== "확인필요") reason = "납기를 확인하지 못했다고 안내한 뒤 납기가 확인됐어요";
    else if (last.status === "임박" && order.status === "지연") reason = "임박 안내 뒤 납기를 넘겼어요";
    else if ((order.status === "지연" || order.status === "확인필요") && ago >= staleDays) reason = ago + "일째 새 소식을 알리지 않았어요";
    return { state: reason ? "재안내필요" : "안내완료", reason, last, ago };
  }

  // items: [{ order, entries }]. 선제 안내 = 지연 주문 중, 처음 안내가 아직 늦기 전(임박 또는 확인 필요 단계)에 나간 것.
  function summary(items, base, staleDays = STALE_DAYS) {
    const s = { total: items.length, 지연: 0, 임박: 0, 확인필요: 0, 미안내: 0, 안내완료: 0, 재안내필요: 0, lateNone: 0, preempt: 0 };
    items.forEach(({ order, entries }) => {
      const st = stateOf(order, entries, base, staleDays);
      s[order.status === "지연" ? "지연" : order.status === "확인필요" ? "확인필요" : "임박"]++;
      s[st.state]++;
      if (order.status === "지연") {
        if (st.state === "미안내") s.lateNone++;
        if (entries && entries.length && entries[0].status !== "지연") s.preempt++;   // 지연 전(임박·확인 필요 단계)에 처음 안내했다
      }
    });
    s.needAction = s.미안내 + s.재안내필요;
    return s;
  }

  const api = { CHANNELS, STALE_DAYS, MIN_STALE_DAYS, MAX_STALE_DAYS, parseDays, cleanDays, makeEntry, append, undo, stateOf, summary };
  if (typeof module !== "undefined") module.exports = api; else root.Informed = api;
})(typeof window !== "undefined" ? window : globalThis);
