// 공급사 회신·약속일의 입력 검증과 "회신 늦음" 판정 (Intent.md 체크리스트 1번, PRD FR-21·22, ADR-0007·0008). 화면·파일과 무관한 순수 함수라서 규칙을 모두 시험으로 고정한다.
//
// 회신(reply) 한 건: { date: 회신 받은 날, promised: 약속일(없으면 ""), channel, note(200자), source: "manual"|"email", supplier }
// 회신 늦음은 저장하지 않고 매번 계산한다. 가장 최근 회신의 약속일이 기준일보다 지났으면(당일은 아님) 늦음이다.
//   - "가장 최근"은 회신 받은 날(date)이 가장 늦은 것, 같으면 만든 시각(createdAt)이 늦은 것. 약속일이 여러 번 바뀌어도 최신 것이 이긴다.
//   - 최신 회신에 약속일이 없으면 판정하지 않는다("약속일 없음"). 입고 완료면 판정하지 않는다("완료").
//   - 공급사 "연락함" 기록(contactedOn)이 기준일 이후면 그날은 조용하다(quiet). 다음 날 기준일이 바뀌면 다시 울린다.
(function (root) {
  const CHANNELS = ["메일", "카톡·문자", "전화", "구두", "기타"];            // store/core.js, persist.js와 같아야 한다 (시험이 비교한다)
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const NOTE_MAX = 200;

  const utcDay = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const daysBetween = (from, to) => Math.round((utcDay(to) - utcDay(from)) / 86400000);        // to - from (일). 시각이 아니라 날짜만 본다
  const live = list => (Array.isArray(list) ? list : []).filter(e => e && !e.deletedAt && ISO.test(e.date || ""));
  const byRecent = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt || "") < String(b.createdAt || "") ? -1 : String(a.createdAt || "") > String(b.createdAt || "") ? 1 : 0);

  // 살아 있는 회신을 오래된 것부터 정렬해서 돌려준다 (삭제 표시된 것은 뺀다)
  const history = list => live(list).slice().sort(byRecent);
  const latest = list => { const h = history(list); return h.length ? h[h.length - 1] : null; };

  // 화면에서 받은 입력을 검사하고 저장할 모양으로 만든다. 실패하면 한국어 이유를 돌려준다.
  function validate(input) {
    const i = input || {};
    if (!ISO.test(String(i.date || ""))) return { ok: false, error: "회신 받은 날을 골라 주세요." };
    const promised = String(i.promised || "");
    if (promised && !ISO.test(promised)) return { ok: false, error: "약속일 날짜 모양이 맞지 않아요." };
    const channel = i.channel == null || i.channel === "" ? "기타" : String(i.channel);
    if (!CHANNELS.includes(channel)) return { ok: false, error: "받은 방법은 " + CHANNELS.join("·") + " 중에서 골라 주세요." };
    return { ok: true, reply: { date: i.date, promised, channel, note: String(i.note || "").slice(0, NOTE_MAX), source: i.source === "email" ? "email" : "manual", supplier: String(i.supplier || "").slice(0, 100) } };
  }

  // 한 주문의 회신 상태. ctx = { today: 기준일, received: 입고 완료인가, contactedOn: 그 공급사에 마지막으로 연락한 날 ("" 가능) }
  //   state: "none"(회신 없음) | "no-promise"(약속일 없음) | "done"(입고 완료) | "waiting"(약속일이 아직 안 됨) | "due-today"(약속일 당일) | "late"(늦음)
  function status(list, ctx) {
    const c = ctx || {}, last = latest(list);
    if (!last) return { state: "none", last: null };
    if (!last.promised) return { state: "no-promise", last };
    if (c.received) return { state: "done", last, promised: last.promised };
    if (!ISO.test(c.today || "")) return { state: "none", last };                                   // 기준일을 모르면 판정하지 않는다
    const d = daysBetween(last.promised, c.today);                                                    // 기준일 - 약속일
    if (d < 0) return { state: "waiting", last, promised: last.promised, daysLeft: -d };
    if (d === 0) return { state: "due-today", last, promised: last.promised };
    return { state: "late", last, promised: last.promised, daysLate: d, quiet: ISO.test(c.contactedOn || "") && c.contactedOn >= c.today };
  }

  // 여러 주문에서 회신 늦음만 골라 오래 늦은 순으로. items = [{ no, supplier, replies, received, contactedOn }]
  // 돌려주는 값: { late: [조용하지 않은 것], quiet: [그날 연락해서 조용한 것] }, 각 원소 = { no, supplier, ...status }
  function lateOrders(items, today) {
    const late = [], quiet = [];
    (items || []).forEach(it => {
      const st = status(it.replies, { today, received: !!it.received, contactedOn: it.contactedOn || "" });
      if (st.state !== "late") return;
      (st.quiet ? quiet : late).push({ no: it.no, supplier: it.supplier || "", ...st });
    });
    const order = (a, b) => b.daysLate - a.daysLate || (a.no < b.no ? -1 : a.no > b.no ? 1 : 0);
    return { late: late.sort(order), quiet: quiet.sort(order) };
  }

  const api = { CHANNELS, NOTE_MAX, daysBetween, history, latest, validate, status, lateOrders };
  if (typeof module !== "undefined") module.exports = api; else root.Replies = api;
})(typeof window !== "undefined" ? window : globalThis);
