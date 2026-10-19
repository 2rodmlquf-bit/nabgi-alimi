// 메일 목록 거르기: 기간, 납기 관련 여부, 주문별 가장 최근 메일 고르기. 화면과 무관한 순수 함수.
(function (root) {
  // 납기 관련 말 (가정). "일정" 같은 흔한 말은 회의 안내까지 걸리므로 넣지 않았다.
  const DUE_WORDS = /납기|납품|입고|도착|출고|선적|출항|인도|배송|ETA|ETD/i;
  const ORDER_ID = /[A-Z]{2,}-\d[\d-]*\d/;
  const pad = n => String(n).padStart(2, "0");
  const localStr = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());

  // "YYYY-MM-DDTHH:MM"(화면의 datetime-local 값) → 이 컴퓨터 시간대의 Date
  function parseLocal(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(str || "").trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
  }

  // 기준일(YYYY-MM-DD)에서 자주 쓰는 기간을 만든다.
  //  lastFriNoon: 지난주 금요일 0시 ~ 기준일 낮 12시 ("지난주 금요일부터 오늘 오전까지")
  //  last7: 기준일 7일 전 0시 ~ 기준일 끝
  function presetRange(kind, baseStr) {
    const b = parseLocal(baseStr.slice(0, 10));
    if (!b) return null;
    if (kind === "lastFriNoon") {
      const monday = new Date(b); monday.setDate(b.getDate() - ((b.getDay() + 6) % 7)); // 이번 주 월요일
      const fri = new Date(monday); fri.setDate(monday.getDate() - 3);                   // 지난주 금요일
      return { start: localStr(fri), end: localStr(new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12, 0)) };
    }
    if (kind === "last7") {
      const s = new Date(b); s.setDate(b.getDate() - 7);
      return { start: localStr(s), end: localStr(new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59)) };
    }
    return { start: "", end: "" }; // 전체
  }

  // 날짜를 읽을 수 없는 메일은 기간 안에 있다고 보지 않는다 (잘못 섞이는 것보다 빼는 쪽이 안전).
  function inRange(dateISO, start, end) {
    if (!start && !end) return true;
    const d = new Date(dateISO);
    if (!dateISO || isNaN(d)) return false;
    const s = parseLocal(start), e = parseLocal(end);
    return (!s || d >= s) && (!e || d <= e);
  }

  // 제목·본문에 납기 관련 말이 있고, 주문번호(목록에 있는 번호 또는 일반 모양)가 하나라도 있으면 납기 메일로 본다.
  function isDueMail(mail, knownIds) {
    const text = (mail.subject || "") + "\n" + (mail.body || "");
    if (!DUE_WORDS.test(text)) return false;
    return ORDER_ID.test(text) || (knownIds || []).some(id => id && text.includes(id));
  }

  // 같은 주문이 여러 메일에 나오면 가장 최근 메일을 기준으로 삼고, 나머지는 older로 붙여 화면에서 볼 수 있게 한다.
  // 더 최근 메일이 "확인 필요"여도 최신 정보가 우선이다(옛 날짜를 새 정보인 것처럼 보여 주지 않으려고).
  function pickLatestPerOrder(items) {
    const groups = new Map();
    items.forEach(it => { if (!groups.has(it.orderNo)) groups.set(it.orderNo, []); groups.get(it.orderNo).push(it); });
    return [...groups.values()].map(list => {
      const sorted = list.slice().sort((a, b) => new Date(b.mail.date) - new Date(a.mail.date));
      const [first, ...older] = sorted;
      return { ...first, older };
    });
  }

  const api = { DUE_WORDS, parseLocal, presetRange, inRange, isDueMail, pickLatestPerOrder, localStr };
  if (typeof module !== "undefined") module.exports = api; else root.MailFilter = api;
})(typeof window !== "undefined" ? window : globalThis);
