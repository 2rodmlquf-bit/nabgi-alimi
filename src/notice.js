// 연구원 안내 문구 만들기. 없는 값(새 납기, 사유, 대안)은 지어내지 않고 문장을 바꾸거나 뺀다.
// 말투: 격식 있는 존댓말(업무 메일). 날짜는 "10월 23일(금)" 형태로 쓴다.
(function (root) {
  const J = typeof require !== "undefined" ? require("./judge") : root.Judge;
  const TEMPLATES = ["사과형", "공지형", "대안 제시형", "부분 납품 안내", "임박 사전 안내"];
  const WEEKDAYS = "일월화수목금토";

  // 호칭: "OO 연구원님". 이미 직함이 있으면 그대로 두고 님만 붙인다.
  function honorific(name) {
    const s = String(name || "").trim();
    if (!s) return "담당자님";
    if (/님$/.test(s)) return s;
    if (/(연구원|박사|교수|팀장|책임|선임|수석|위원)$/.test(s)) return s + "님";
    return s + " 연구원님";
  }

  // "2026-10-23" → "10월 23일(금)". 해석할 수 없으면 받은 글자 그대로 쓴다. withYear면 연도도 붙인다.
  function formatDate(value, withYear) {
    const d = J.parseDate(value);
    if (!d) return String(value || "");
    return (withYear ? d.getUTCFullYear() + "년 " : "") + (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일(" + WEEKDAYS[d.getUTCDay()] + ")";
  }

  // v: { researcher, item, orderNo, oldDue, newDue, daysLate, reason, alternative, signature }
  function renderNotice(template, v) {
    if (template === "임박 사전 안내" && !(v.daysLeft >= 0)) template = "사과형"; // 이미 지났거나 일정을 모르면 사전 안내가 아니다
    const who = honorific(v.researcher);
    const what = (v.item ? v.item + " " : "") + "(" + v.orderNo + ")";
    const reason = (v.reason || "").trim().replace(/[.。]+$/, "");
    const alt = (v.alternative || "").trim();
    const sign = (v.signature || "").trim();
    const od = J.parseDate(v.oldDue), nd = J.parseDate(v.newDue);
    const withYear = !!(od && nd && od.getUTCFullYear() !== nd.getUTCFullYear());
    const oldF = formatDate(v.oldDue, withYear), newF = formatDate(v.newDue, withYear);

    // 날짜 뒤에는 조사를 붙이지 않는다 (요일 글자에 따라 이/가가 달라져 어색해지므로).
    let status;
    if (v.newDue) status = "납기가 변경되었습니다.\n- 기존: " + (oldF || "미확인") + "\n- 변경: " + newF;
    else if (v.daysLate > 0) status = "기존 납기일은 " + oldF + "입니다.\n현재 " + v.daysLate + "일이 지났으나 아직 입고되지 않았습니다.";
    else status = "기존 납기일은 " + oldF + "입니다.\n현재 일정 확인이 필요한 상태입니다.";
    const reasonLine = reason ? "사유는 " + reason + "입니다." : "";
    const follow = v.newDue ? "" : "공급사에 일정을 확인 중이며, 확인되는 대로 다시 안내드리겠습니다.";

    const hello = ["안녕하세요, " + who + "."];
    const p = v.partial;
    const body = ["주문하신 " + what + " 납기와 관련하여 안내드립니다.", status, reasonLine, follow];
    let blocks;
    if (template === "부분 납품 안내") {
      // 수량 정보가 있으면 숫자를 보여 주고, 없으면 지어내지 않고 "일부 수량만 입고"라고만 쓴다. 숫자 뒤에는 조사를 붙이지 않는다.
      const remainF = p && p.remainDue ? formatDate(p.remainDue) : "";
      const qty = p ? ["- 주문 수량: " + p.ordered, "- 입고 수량: " + p.received, "- 잔량: " + p.remaining + (remainF ? " (입고 예정 " + remainF + ")" : " (입고 일정은 공급사에 확인 중입니다)")] : [];
      const sched = (v.schedule || []).map((s, i) => "- " + (i + 1) + "차 입고 예정: " + formatDate(s.date) + (s.qty ? " · 수량 " + s.qty : ""));
      blocks = [hello, ["주문하신 " + what + " 일부 수량만 먼저 입고되었음을 안내드립니다.", ...qty, ...sched, reasonLine],
        ["먼저 입고된 수량으로 우선 사용하실 수 있는지, 급히 필요한 수량이 있으신지 알려 주시면 그에 맞춰 조율하겠습니다."], ["감사합니다."]];
    } else if (template === "임박 사전 안내") {
      // 아직 늦지 않았다. 새 납기나 입고 시점을 지어내지 않고, 일정을 확인 중이라는 것과 지연 가능성이 보이면 다시 알린다는 것만 쓴다.
      const dueF = formatDate(v.due || v.oldDue);
      const left = v.daysLeft === 0 ? "납기일이 오늘, " + dueF + "입니다." : "납기일은 " + dueF + "이며, " + v.daysLeft + "일 남았습니다.";
      const part = p ? "현재 일부 수량(" + p.received + "/" + p.ordered + ")만 입고되었고 잔량은 " + p.remaining + "입니다." : "";
      blocks = [hello, ["주문하신 " + what + " 납기가 가까워 미리 안내드립니다.", left, part, reason ? "참고 사항: " + reason : ""],
        ["현재 공급사에 입고 일정을 확인 중이며, 지연 가능성이 확인되면 바로 다시 안내드리겠습니다.", "급하게 필요한 일정이나 수량이 있으시면 알려 주시면 공급사와 조율하겠습니다."], ["감사합니다."]];
    } else if (template === "공지형") {
      blocks = [hello, ["주문하신 " + what + " 납기 관련 안내드립니다.", status, reasonLine, follow], ["감사합니다."]];
    } else if (template === "대안 제시형") {
      blocks = [hello, body, alt ? ["아래 방법을 제안드립니다.", alt] : [],
        ["원하시는 방향을 알려 주시면 바로 조치하겠습니다. 불편을 드려 죄송합니다."]];
    } else {
      blocks = [hello, body, ["불편을 드려 진심으로 죄송합니다."]];
    }
    if (sign) blocks.push([sign]);
    // 빈 줄은 문단 안에서 빼고, 비어 버린 문단은 통째로 뺀다.
    return blocks.map(b => b.filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
  }

  // 한 연구원에게 여러 건을 한 통으로 알린다. items: [{ orderNo, item, status("지연"|"임박"), daysLeft, due, oldDue, reason, partial, schedule }]
  // 없는 값(사유, 새 납기)은 지어내지 않고 그 줄을 뺀다. 지연은 오래된 순, 임박은 가까운 순으로 이미 정렬돼 들어온다고 본다.
  function renderDigest(researcher, items, signature) {
    const late = items.filter(i => i.status === "지연"), soon = items.filter(i => i.status === "임박");
    const lines = ["안녕하세요, " + honorific(researcher) + ".", "", "요청하신 주문 중 납기 확인이 필요한 건을 한 번에 정리해 안내드립니다."];
    const block = (title, list, tail) => {
      if (!list.length) return;
      lines.push("", "■ " + title + " " + list.length + "건");
      list.forEach((i, n) => {
        const reason = String(i.reason || "").trim().replace(/[.。]+$/, "");
        lines.push((n + 1) + ". " + (i.item ? i.item + " " : "") + "(" + i.orderNo + ")");
        const due = formatDate(i.due);
        lines.push("   - 납기: " + (i.oldDue ? formatDate(i.oldDue) + " → " + due + " (변경)" : due) + tail(i));
        if (i.partial) lines.push("   - 입고: " + i.partial.received + "/" + i.partial.ordered + " (잔량 " + i.partial.remaining + ")");
        (i.schedule || []).forEach((s, k) => lines.push("   - " + (k + 1) + "차 입고 예정: " + formatDate(s.date) + (s.qty ? " · 수량 " + s.qty : "")));
        if (reason) lines.push("   - 사유: " + reason);
      });
    };
    block("납기 지연", late, i => i.daysLeft < 0 ? " · " + -i.daysLeft + "일 지남" : "");
    block("납기 임박", soon, i => i.daysLeft === 0 ? " · 오늘" : i.daysLeft > 0 ? " · " + i.daysLeft + "일 남음" : "");
    lines.push("", "공급사와 일정을 확인하는 대로 변경 사항을 다시 안내드리겠습니다.", "감사합니다.");
    if (String(signature || "").trim()) lines.push(signature.trim());
    return lines.join("\n");
  }

  const api = { TEMPLATES, renderNotice, renderDigest, honorific, formatDate };
  if (typeof module !== "undefined") module.exports = api; else root.Notice = api;
})(typeof window !== "undefined" ? window : globalThis);
