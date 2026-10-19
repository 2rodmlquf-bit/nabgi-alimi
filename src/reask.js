// 공급사에 보내는 재문의 문구(미회신 주문 모음). 격식 있는 존댓말, 공급사별로 한 통씩.
(function (root) {
  const N = typeof require !== "undefined" ? require("./notice") : root.Notice;

  // items: [{ orderNo, item, from(현재 납기), reply(공급사가 적은 말, 있으면) }]
  function renderReask(supplier, items, signature) {
    const who = String(supplier || "").trim() ? supplier.trim() + " 담당자님" : "담당자님";
    const lines = items.map(it => "- " + it.orderNo + (it.item ? " " + it.item : "") +
      (it.from ? " (현재 납기 " + N.formatDate(it.from) + ")" : " (납기 미확인)") +
      (it.reply ? " · 회신 내용: " + it.reply : ""));
    const blocks = [
      ["안녕하세요, " + who + "."],
      ["아래 주문의 납기 회신이 확인되지 않아 문의드립니다."].concat(lines),
      ["확인되는 대로 납기일(날짜)을 회신해 주시면 감사하겠습니다."],
      ["감사합니다."],
    ];
    if (String(signature || "").trim()) blocks.push([signature.trim()]);
    return blocks.map(b => b.join("\n")).join("\n\n");
  }

  // 공급사 한 곳에 보낼 "납기 현황 확인" 문구. orders: Contact.plan()의 주문들(지연·임박·확인필요·미회신)
  function renderFollowUp(supplier, orders, signature) {
    const who = String(supplier || "").trim() && !/^\(/.test(supplier) ? supplier.trim() + " 담당자님" : "담당자님";
    const F = N.formatDate;
    const line = o => {
      const head = "- " + o.orderNo + (o.item ? " " + o.item : "");
      const part = o.partial ? ", 부분 입고 " + o.partial.received + "/" + o.partial.ordered : "";
      if (o.status === "지연") return head + " (납기 " + F(o.due) + ", " + o.days + "일 경과" + part + (o.noReply ? (o.reply ? ", 회신 내용: " + o.reply : ", 회신 미확인") : "") + ")";
      if (o.status === "임박") return head + " (납기 " + F(o.due) + ", " + (o.days === 0 ? "오늘" : o.days + "일 남음") + part + ")";
      if (o.status === "확인필요") return head + (o.due ? " (납기일 \"" + o.due + "\"을 읽을 수 없어 확인 부탁드립니다)" : " (납기일이 비어 있어 확인 부탁드립니다)");
      return head + (o.due ? " (현재 납기 " + F(o.due) + ")" : " (납기 미확인)") + (o.reply ? " · 회신 내용: " + o.reply : "");
    };
    const sections = [["지연", "[납기 지연]"], ["임박", "[납기 임박]"], ["확인필요", "[납기일 확인 필요]"], ["미회신", "[회신 미확인]"]]
      .map(([st, title]) => { const list = orders.filter(o => o.status === st); return list.length ? [title].concat(list.map(line)) : null; }).filter(Boolean);
    const blocks = [["안녕하세요, " + who + "."], ["아래 주문의 납기 현황 확인을 부탁드립니다."]].concat(sections)
      .concat([["확인되는 대로 새 납기일(날짜)을 회신해 주시면 감사하겠습니다."], ["감사합니다."]]);
    if (String(signature || "").trim()) blocks.push([signature.trim()]);
    return blocks.map(b => b.join("\n")).join("\n\n");
  }

  const orderLine = (o, withDue = true) => "- " + o.orderNo + (o.item ? " " + o.item : "") +
    (withDue && o.due ? " (납기 " + N.formatDate(o.due) + (o.status === "지연" ? ", " + o.days + "일 경과" : o.status === "임박" ? ", " + (o.days === 0 ? "오늘" : o.days + "일 남음") : "") + ")" : "");

  // 카톡·문자용 짧은 재연락 문구. 메일로 이미 보냈다는 전제에서 한두 줄로 답을 구한다.
  function renderChat(supplier, orders, signature) {
    const who = String(supplier || "").trim() && !/^\(/.test(supplier) ? supplier.trim() + " 담당자님" : "담당자님";
    const shown = orders.slice(0, 3), more = orders.length - shown.length;
    const lines = ["안녕하세요, " + who + ".", "앞서 문의드린 납기 건이 확인되지 않아 다시 연락드립니다.", ...shown.map(o => orderLine(o, false)), ...(more > 0 ? ["외 " + more + "건"] : []),
      "날짜가 확정되지 않았어도 현재 예상 일정만이라도 오늘 중 회신 부탁드립니다. 감사합니다."];
    if (String(signature || "").trim()) lines.push(signature.trim());
    return lines.join("\n");
  }

  // 연구원에게 보내는 지연 가능성 사전 안내. st: Escalate.status() 결과
  function renderHeadsUp(requester, supplier, orders, st, signature) {
    const lines = ["안녕하세요, " + N.honorific(requester) + ".", "", "주문하신 아래 건은 납기가 늦어질 수 있어 미리 알려드립니다.", ...orders.map(o => orderLine(o))];
    lines.push("", (supplier ? supplier + "에 " : "공급사에 ") + (st.attempts ? st.attempts + "회(" + st.channels.join(", ") + ") " : "") + "연락했으나 아직 회신이 없습니다.");
    if (st.promiseBroken) lines.push("전화로 들은 날짜(" + N.formatDate(st.promised) + ")가 지났지만 아직 입고되지 않았습니다.");
    lines.push("회신이 오는 대로 다시 안내드리겠습니다. 급히 필요한 일정이 있으시면 알려 주세요. 대체 방안도 함께 검토하겠습니다.", "", "불편을 드려 죄송합니다.");
    if (String(signature || "").trim()) lines.push("", signature.trim());
    return lines.join("\n");
  }

  // 상급자 보고 및 대체 검토 요청 문구 (내부용)
  function renderEscalation(supplier, orders, st, signature) {
    const shown = orders.slice(0, 8), more = orders.length - shown.length;
    const lines = ["안녕하세요.", "", "아래 공급사의 납기 회신이 반복해서 확인되지 않아 보고드립니다.", "", "- 공급사: " + supplier,
      "- 연락 이력: " + (st.attempts ? "총 " + st.attempts + "회(" + st.channels.join(", ") + "), 마지막 " + (st.lastDate || "-") + ", 무응답 " + st.daysSilent + "일째" : "기록 없음") +
      (st.promiseBroken ? "\n- 구두로 들은 날짜(" + N.formatDate(st.promised) + ")가 지났지만 입고되지 않음" : ""),
      "- 영향 주문 " + orders.length + "건:", ...shown.map(o => "  " + orderLine(o)), ...(more > 0 ? ["  외 " + more + "건"] : []), "",
      "요청 사항", "1) 공급사의 다른 담당자나 상급자를 통한 확인", "2) 지연이 계속될 경우 대체 공급사·대체품 검토", "", "감사합니다."];
    if (String(signature || "").trim()) lines.push(signature.trim());
    return lines.join("\n");
  }

  // 대체품 확인용 항목별 비교 줄. rows: [{ label, list, sup, differs }]  (없는 값은 "-")
  const cmpLines = rows => rows.filter(r => r.list || r.sup).map(r => "- " + r.label + ": 주문 " + (r.list || "-") + " / 회신 " + (r.sup || "-") + (r.differs ? " (다름)" : ""));

  // 연구원에게 보내는 대체품 사용 승인 요청. o: { orderNo, item }, reasons: 확인 근거 문장들
  function renderSubstApprove(requester, o, rows, reasons, signature) {
    const lines = ["안녕하세요, " + N.honorific(requester) + ".", "", "주문하신 " + (o.item ? o.item + " " : "") + "(" + o.orderNo + ") 건과 관련하여 확인을 부탁드립니다.",
      "공급사 회신에 원래 주문과 다른 품목(대체품)으로 보이는 내용이 있습니다.", "", "항목별 비교", ...cmpLines(rows)];
    if (reasons && reasons.length) lines.push("", "확인 근거: " + reasons.join(", "));
    lines.push("", "대체품을 사용하셔도 되는지 확인 부탁드립니다.", "승인해 주시기 전에는 대체품이 발송되지 않도록 공급사에 요청해 두겠습니다.", "", "감사합니다.");
    if (String(signature || "").trim()) lines.push(signature.trim());
    return lines.join("\n");
  }

  // 공급사에 보내는 문구. mode: "hold"(사전 승인 요구, 발송 보류) | "reject"(반려, 원 품목으로 재발송)
  function renderSubstSupplier(supplier, o, rows, mode, signature) {
    const who = String(supplier || "").trim() && !/^\(/.test(supplier) ? supplier.trim() + " 담당자님" : "담당자님";
    const lines = ["안녕하세요, " + who + "."];
    if (mode === "reject") lines.push("", "아래 주문의 대체품은 사용 승인이 나지 않아, 원래 주문한 품목으로 발송을 부탁드립니다.");
    else lines.push("", "아래 주문의 회신 내용에 원래 주문과 다른 품목(대체품)으로 보이는 부분이 있어 확인드립니다.");
    lines.push("- 주문번호: " + o.orderNo + (o.item ? " " + o.item : ""), ...cmpLines(rows), "");
    if (mode === "reject") lines.push("원래 품목의 납기가 확정되면 날짜를 회신해 주시기 바랍니다.");
    else lines.push("사용처의 승인을 확인하기 전까지는 대체품을 발송하지 말아 주세요.", "대체품 사양서(모델명, 규격, 원래 품목과의 차이점)를 보내 주시면 승인 여부를 확인해 알려드리겠습니다.");
    lines.push("", "감사합니다.");
    if (String(signature || "").trim()) lines.push(signature.trim());
    return lines.join("\n");
  }

  const api = { renderReask, renderFollowUp, renderChat, renderHeadsUp, renderEscalation, renderSubstApprove, renderSubstSupplier };
  if (typeof module !== "undefined") module.exports = api; else root.Reask = api;
})(typeof window !== "undefined" ? window : globalThis);
