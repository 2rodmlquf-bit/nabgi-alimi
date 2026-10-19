// 공급사 연락 이력 → 무응답 단계와 다음 조치 제안. 화면과 무관한 순수 함수.
// 이력 한 줄: { date: "YYYY-MM-DD", kind: "attempt"(연락함) | "reply"(답변 받음), channel: "메일"|"카톡·문자"|"전화"|"기타", promised: "YYYY-MM-DD"(구두로 들은 날짜), note }
// 현업 경험(반복 무응답 공급사에 전화 → 연구원에게 미리 알림 → 상급자·다른 담당자 → 대체 공급사 검토)을 단계로 옮겼다. 단계 기준은 가정이다.
(function (root) {
  const J = typeof require !== "undefined" ? require("./judge") : root.Judge;
  const CHANNELS = ["메일", "카톡·문자", "전화", "기타"];
  const MAIN_CHANNELS = ["메일", "카톡·문자", "전화"];

  const days = (a, b) => { const x = J.parseDate(a), y = J.parseDate(b); return x && y ? Math.round((y - x) / 86400000) : 0; };

  // log: 이력 배열, base: 기준일(YYYY-MM-DD), hasOpenOrders: 이 공급사에 아직 지연·임박 주문이 남아 있는지
  function status(log, base, hasOpenOrders = true) {
    const entries = (log || []).filter(e => e && e.date).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let lastReplyIdx = -1;
    entries.forEach((e, i) => { if (e.kind === "reply") lastReplyIdx = i; });
    const since = entries.slice(lastReplyIdx + 1).filter(e => e.kind === "attempt"); // 마지막 답변 이후의 연락
    const attempts = since.length;
    const channels = [...new Set(since.map(e => e.channel))];
    const lastReply = lastReplyIdx >= 0 ? entries[lastReplyIdx] : null;
    const promised = lastReply && lastReply.promised ? lastReply.promised : "";
    // 구두로 들은 날짜가 지났는데 아직 지연·임박 주문이 남아 있으면 '약속한 날짜가 지난' 것으로 본다 (주문별 약속이었는지는 알 수 없음)
    const promiseBroken = !!promised && promised < base && hasOpenOrders;
    const contactedToday = entries.some(e => e.date === base);
    const score = attempts + (promiseBroken ? 2 : 0);
    const level = Math.min(4, score);
    const untried = MAIN_CHANNELS.filter(c => !channels.includes(c));

    let suggestions;
    if (level === 0) suggestions = [{ key: "mail", text: "먼저 메일로 납기 확인을 요청하세요." }];
    else if (level === 1) suggestions = [{ key: "chat", text: untried.length ? "아직 쓰지 않은 채널(" + untried.join("·") + ")로 짧게 재연락하세요." : "짧은 문구로 다시 연락하세요." }];
    else if (level === 2) suggestions = [{ key: "call", text: "전화로 직접 확인하고, 들은 날짜를 기록하세요." }, { key: "other", text: "연락 가능한 다른 담당자가 있는지 확인하세요." }];
    else if (level === 3) suggestions = [{ key: "headsup", text: "영향받는 연구원에게 지연 가능성을 미리 알리세요." }, { key: "boss", text: "상급자나 공급사의 다른 담당자를 통해 연락하세요." }];
    else suggestions = [{ key: "alt", text: "대체 공급사·대체품 검토를 시작하세요." }, { key: "headsup", text: "영향받는 연구원에게 지연 가능성을 미리 알리세요." }, { key: "boss", text: "상급자에게 상황을 보고하세요." }];

    const parts = [];
    if (attempts) parts.push("무응답 " + attempts + "회" + (since[0] ? " · " + days(since[0].date, base) + "일째" : ""));
    if (promiseBroken) parts.push("들은 날짜(" + promised + ")가 지났는데 아직 지연 주문이 남아 있어요");
    else if (promised && !attempts) parts.push("구두로 들은 날짜 " + promised);
    if (!attempts && !promiseBroken && !promised) parts.push(entries.length ? "답변을 받았어요" : "연락 기록 없음");
    return {
      attempts, channels, level, suggestions, promised, promiseBroken, contactedToday,
      lastDate: since.length ? since[since.length - 1].date : "", daysSilent: since[0] ? days(since[0].date, base) : 0,
      headline: parts.join(" · "),
    };
  }

  const api = { CHANNELS, status };
  if (typeof module !== "undefined") module.exports = api; else root.Escalate = api;
})(typeof window !== "undefined" ? window : globalThis);
