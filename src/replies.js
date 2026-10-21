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

  // 한눈에: 주문 하나의 회신 쪽 요약 (FR-23). 화면이 글자로 바꿔 보여 주기 쉽게 사실만 돌려준다.
  //   ctx = { today, received, contactedOn, due(파일의 납기일 글자) }
  function glance(list, ctx) {
    const st = status(list, ctx), last = st.last;
    const differs = !!(st.promised && ctx && ctx.due && /^\d{4}-\d{2}-\d{2}$/.test(ctx.due) && ctx.due !== st.promised);   // 파일의 납기와 공급사 약속일이 다르면 눈에 띄게
    return { state: st.state, promised: st.promised || "", differs, last, daysLate: st.daysLate || 0, daysLeft: st.daysLeft || 0, quiet: !!st.quiet };
  }

  const dash = v => (v == null || v === "" ? "확인 중" : v);          // 모르는 값은 빈칸이 아니라 "확인 중"으로 쓴다 (FR-24)
  const lastText = last => (last ? last.date + " " + last.channel + "로 회신을 받았어요" + (last.note ? " (" + last.note + ")" : "") : "");

  // 연구원 문의에 답할 이메일 글 (복사해서 쓴다. 이 앱은 보내지 않는다).
  //   d = { no, product, supplier, researcher, statusText, due, replies(글), today, received, contactedOn, signature }
  function draftEmail(d) {
    const g = glance(d.replies, { today: d.today, received: d.received, contactedOn: d.contactedOn, due: d.due }), last = g.last;
    const mid = last ? last.date + "에 " + last.channel + "로 " + (g.promised ? "약속일 " + g.promised + "로 안내받았습니다" : "회신을 받았으나 새 일정은 받지 못했습니다") + (last.note ? " (" + last.note + ")" : "") : "아직 받은 회신이 없습니다";
    const next = g.state === "late" ? "약속일이 지나 공급사에 확인하고 있습니다" : g.state === "waiting" || g.state === "due-today" ? "약속일에 맞춰 입고 여부를 확인하겠습니다" : g.state === "done" ? "입고가 확인되었습니다" : "공급사에 일정을 확인하고 있습니다";
    return ["제목: [납기 문의 회신] " + d.no + (d.product ? " " + d.product : ""), "",
      (d.researcher ? d.researcher + "님, " : "") + "안녕하세요.", "문의하신 " + d.no + (d.product ? "(" + d.product + ")" : "") + " 진행 상황을 알려 드립니다.", "",
      "- 현재 상태: " + dash(d.statusText) + " (파일 납기 " + dash(d.due) + ")",
      "- 공급사 회신: " + mid,
      "- 다음 조치: " + next, "",
      "새 소식이 있으면 바로 다시 알려 드리겠습니다." + (d.signature ? "\n" + d.signature : "")].join("\n");
  }

  // 전화로 말할 요점 3줄
  function draftCall(d) {
    const g = glance(d.replies, { today: d.today, received: d.received, contactedOn: d.contactedOn, due: d.due }), last = g.last;
    return ["1. 상태: " + d.no + (d.product ? " " + d.product : "") + " — " + dash(d.statusText) + ", 파일 납기 " + dash(d.due),
      "2. 공급사: " + (last ? lastText(last) + (g.promised ? ", 약속일 " + g.promised : ", 새 약속일은 아직 없어요") + (g.state === "late" ? " (" + g.daysLate + "일 지남)" : "") : "아직 받은 회신이 없어요"),
      "3. 다음: " + (g.state === "late" ? "공급사에 다시 확인하고 결과를 바로 알려 드릴게요" : g.state === "done" ? "입고가 확인됐어요" : g.promised ? "약속일에 맞춰 확인하고 알려 드릴게요" : "공급사에 일정을 확인하고 알려 드릴게요")].join("\n");
  }

  // 이메일에서 읽은 결과를 "공급사 회신으로 기록할까요?" 제안으로 바꾼다 (FR-25, Intent 열린 질문 4번의 임시 기본값을 확정).
  // 제안만 하고, 사람이 누를 때만 기록한다(source: "email"). 틀린 약속일이 쌓이면 "회신 늦음"이 거짓으로 울리기 때문이다.
  //   item = 이메일 납기 추출 결과 { orderNo, dueDate, confidence("높음"|"보통"|"낮음"), evidence, evidenceOk, mail: { date } }
  //   ctx  = { today, supplier, existing: 이 주문의 회신 목록 }
  // 규칙: 근거 문장이 메일 원문에서 확인되지 않으면(evidenceOk 아님) 제안하지 않는다. 신뢰도가 낮으면 약속일을 비운다. 같은 메일을 이미 기록했으면 다시 제안하지 않는다.
  const localDay = v => { const d = new Date(v); if (isNaN(d)) return ""; return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function suggestFromMail(item, ctx) {
    const it = item || {}, c = ctx || {};
    if (!it.evidence || !it.evidenceOk) return { ok: false, reason: "근거 문장이 메일 원문에서 확인되지 않아 회신 기록은 제안하지 않아요." };
    const date = (it.mail && localDay(it.mail.date)) || (ISO.test(c.today || "") ? c.today : "");
    const promised = ISO.test(it.dueDate || "") && it.confidence !== "낮음" ? it.dueDate : "";
    const v = validate({ date, promised, channel: "메일", note: it.evidence, source: "email", supplier: c.supplier || "" });
    if (!v.ok) return { ok: false, reason: v.error };
    const dup = (Array.isArray(c.existing) ? c.existing : []).some(e => e && !e.deletedAt && e.source === "email" && e.date === v.reply.date && (e.promised || "") === v.reply.promised);
    if (dup) return { ok: false, duplicate: true, reason: "이 메일은 이미 회신으로 기록했어요." };
    return { ok: true, reply: v.reply, dateDropped: !!it.dueDate && !promised };            // dateDropped = 신뢰도가 낮아 날짜를 비웠다
  }

  const api = { suggestFromMail, glance, draftEmail, draftCall, CHANNELS, NOTE_MAX, history, latest, validate, status, lateOrders };
  if (typeof module !== "undefined") module.exports = api; else root.Replies = api;
})(typeof window !== "undefined" ? window : globalThis);
