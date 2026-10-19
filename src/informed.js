// 연구원 안내 기록: 지연·임박 주문마다 "연구원에게 알렸는가"를 남기고, 다시 알려야 하는지 판단한다. 화면과 무관한 순수 함수.
// 기록 한 건: { date, channel, status("지연"|"임박": 알린 시점의 상태), due(알린 시점의 납기일), note }
(function (root) {
  const J = typeof require !== "undefined" ? require("./judge") : root.Judge;
  const CHANNELS = ["메일", "카톡·문자", "전화", "구두", "기타"];
  // 가정: 지연 중인 주문은 이 일수가 넘도록 새 소식을 안 알리면 다시 알려야 한다고 본다.
  const STALE_DAYS = 7;

  const dayGap = (a, b) => { const x = J.parseDate(a), y = J.parseDate(b); return x && y ? Math.round((y - x) / 86400000) : 0; };
  // 납기일은 표기가 제각각이라 날짜로 바꿔 비교하고, 날짜로 읽을 수 없으면 글자로 비교한다.
  const sameDue = (a, b) => {
    const x = J.parseDate(a), y = J.parseDate(b);
    return x && y ? x.getTime() === y.getTime() : String(a || "").trim() === String(b || "").trim();
  };

  function makeEntry(order, base, channel, note) {
    return { date: base, channel: CHANNELS.includes(channel) ? channel : "기타", status: order.status === "지연" ? "지연" : "임박", due: String(order.due || ""), note: String(note || "").slice(0, 200) };
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
    else if (last.status === "임박" && order.status === "지연") reason = "임박 안내 뒤 납기를 넘겼어요";
    else if (order.status === "지연" && ago >= staleDays) reason = ago + "일째 새 소식을 알리지 않았어요";
    return { state: reason ? "재안내필요" : "안내완료", reason, last, ago };
  }

  // items: [{ order, entries }]. 선제 안내 = 지연 주문 중, 처음 안내가 아직 늦기 전(임박 단계)에 나간 것.
  function summary(items, base, staleDays = STALE_DAYS) {
    const s = { total: items.length, 지연: 0, 임박: 0, 미안내: 0, 안내완료: 0, 재안내필요: 0, lateNone: 0, preempt: 0 };
    items.forEach(({ order, entries }) => {
      const st = stateOf(order, entries, base, staleDays);
      s[order.status === "지연" ? "지연" : "임박"]++;
      s[st.state]++;
      if (order.status === "지연") {
        if (st.state === "미안내") s.lateNone++;
        if (entries && entries.length && entries[0].status === "임박") s.preempt++;
      }
    });
    s.needAction = s.미안내 + s.재안내필요;
    return s;
  }

  const api = { CHANNELS, STALE_DAYS, makeEntry, append, undo, stateOf, summary };
  if (typeof module !== "undefined") module.exports = api; else root.Informed = api;
})(typeof window !== "undefined" ? window : globalThis);
