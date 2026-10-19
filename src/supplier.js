// 공급사가 보내 준 표(엑셀)를 읽는 규칙. 머리글 줄·열 찾기, 납기 칸 분류(날짜/빈칸/애매함), 주문 목록과 비교.
// 화면·파일과 무관한 순수 함수. 입력은 문자열 2차원 배열(rows)이다.
(function (root) {
  const J = typeof require !== "undefined" ? require("./judge") : root.Judge;
  const ER = typeof require !== "undefined" ? require("./emailRules") : root.EmailRules;

  // 공급사가 열 이름을 마음대로 바꿔도 알아보기 위한 말 (가정: 흔한 표현. 실제 파일을 보면서 늘려 간다).
  const SYN = {
    주문번호: ["주문번호", "발주번호", "po", "p/o", "order", "오더", "주문no", "발주no", "po#"],
    납기일: ["납기", "회신납기", "납품", "입고예정", "도착예정", "출고예정", "확정일", "eta", "delivery", "due"],
    품목명: ["품목", "품명", "자재명", "자재", "item", "description", "제품"],
    공급사: ["공급사", "공급업체", "거래처", "업체", "vendor", "supplier"],
    비고: ["비고", "메모", "사유", "특이", "note", "remark", "comment"],
    수량: ["수량", "qty", "quantity"],
    규격: ["규격", "모델", "사양", "spec", "model"],
  };
  const FIELDS = ["주문번호", "수량", "납기일", "품목명", "공급사", "규격", "비고"];
  // 대체품이 의심되는 말 (가정). 공급사 회신·메모에 이런 말이 있으면 연구원 승인 확인이 필요하다고 알린다.
  const SUBST_WORDS = /대체|동급|호환|변경\s?모델|단종|다른\s?모델|상위\s?모델|후속\s?모델/;

  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/[\s_\-.:()[\]]/g, "");
  function fieldOf(cell) {
    const c = norm(cell);
    if (!c || c.length > 30) return null;
    return FIELDS.find(f => SYN[f].some(w => c.includes(norm(w)))) || null;
  }

  // 한 줄을 머리글로 봤을 때의 열 위치 { 주문번호: 열번호, ... }
  function columnsOfRow(row) {
    const cols = {};
    row.forEach((cell, i) => { const f = fieldOf(cell); if (f && cols[f] == null) cols[f] = i; });
    return cols;
  }

  // 앞쪽 40줄 중 머리글처럼 보이는 줄을 찾는다. 주문번호나 납기일 열이 있고 서로 다른 열 이름이 2개 이상이어야 한다.
  function findHeader(rows, maxScan = 40) {
    let best = null;
    for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
      const columns = columnsOfRow(rows[i]);
      const score = Object.keys(columns).length;
      if (score >= 2 && (columns.주문번호 != null || columns.납기일 != null) && (!best || score > best.score)) best = { index: i, columns, score };
    }
    return best;
  }

  const idKey = s => String(s || "").toUpperCase().replace(/[\s]/g, "");
  const BLANKISH = /^(?:[-–—./·\s]*|n\/?a|na|tbd|none|null)$/i;
  const TEXT_REPLY = /확인|추후|미정|문의|회신|연락|재고|협의|조율|검토|조회/;

  // 납기 칸 하나를 분류한다.
  //  date   : 날짜로 읽힘 (date)
  //  blank  : 비어 있음/자리표시(-, TBD) → 미회신
  //  unclear: 날짜 없이 말만 있음("확인 후 회신") → 미회신 (메모에 그 말을 남김)
  //  vague  : 날짜인 듯하나 확정이 아님("11월 초", "다음 주쯤", 범위) → 확인 필요
  function classifyDue(raw, baseISO) {
    const s = String(raw == null ? "" : raw).trim();
    if (BLANKISH.test(s)) return { kind: "blank", text: s };
    if (/^\d{8}$/.test(s)) { const d = J.parseDate(s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6)); if (d) return { kind: "date", date: isoOf(d), text: s }; }
    const direct = J.parseDate(s);
    if (direct) return { kind: "date", date: isoOf(direct), text: s };
    // 숫자가 전혀 없고 "확인 후 회신", "추후 안내" 같은 말뿐이면 날짜 얘기가 아니라 아직 모른다는 뜻이다 → 미회신
    if (!/\d/.test(s) && TEXT_REPLY.test(s)) return { kind: "unclear", text: s, note: "날짜 없이 말만 적혀 있어요." };
    // 그 밖의 글: 이메일 규칙(10/14, 10월 23일, 빠르면~, 범위 등)을 그대로 재사용한다
    const r = ER.extract("ZZ-100 납기 " + s, baseISO)[0]; // 이메일 규칙이 주문번호 모양을 요구해서 자리표시용 번호를 붙인다
    if (r && r.dueDate) return { kind: "date", date: r.dueDate, text: s, note: r.note };
    if (r && /확정하지 않았어요/.test(r.note || "")) return { kind: "vague", text: s, note: r.note };
    return { kind: TEXT_REPLY.test(s) ? "unclear" : "vague", text: s, note: "날짜로 읽을 수 없는 답이에요." };
  }
  const isoOf = d => d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");

  // 머리글 아래의 줄을 항목으로 바꾼다. columns: { 주문번호, 납기일, (공급사, 품목명, 비고) } → 열 번호
  function buildEntries(rows, headerIndex, columns) {
    const get = (row, f) => (columns[f] != null ? String(row[columns[f]] == null ? "" : row[columns[f]]).trim() : "");
    const entries = [], skipped = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every(c => String(c).trim() === "")) continue;
      const orderNo = get(row, "주문번호");
      if (!orderNo || /^(합계|소계|총계|total|sum)/i.test(orderNo)) { skipped.push({ line: i + 1, text: row.filter(Boolean).join(" ").slice(0, 60) }); continue; }
      entries.push({ line: i + 1, orderNo, supplier: get(row, "공급사"), item: get(row, "품목명"), dueRaw: get(row, "납기일"), note: get(row, "비고"), qty: get(row, "수량"), spec: get(row, "규격") });
    }
    return { entries, skipped };
  }

  // 공급사 항목을 주문 목록과 비교한다.
  //  listRows: [{...}] (주문 목록의 행), idCol/dueCol/supplierCol/itemCol: 목록의 열 이름
  // 반환: changed(목록과 다른 납기) / same / noReply(미회신) / vague(확인 필요) / notInList / multi(같은 주문이 여러 줄)
  function compare(listRows, cols, entries, baseISO) {
    const byId = new Map(listRows.map(r => [idKey(r[cols.id]), r]));
    const groups = new Map();
    entries.forEach(e => { const k = idKey(e.orderNo); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
    const out = { changed: [], same: [], noReply: [], vague: [], notInList: [], multi: [], subst: [] };
    groups.forEach(list => {
      const first = list[0];
      const listRow = byId.get(idKey(first.orderNo));
      const cls = list.map(e => ({ e, c: classifyDue(e.dueRaw, baseISO) }));
      const dates = [...new Set(cls.filter(x => x.c.kind === "date").map(x => x.c.date))];
      const base = { orderNo: listRow ? listRow[cols.id] : first.orderNo, supplier: first.supplier || (listRow && cols.supplier ? listRow[cols.supplier] : "") || "", item: first.item || (listRow && cols.item ? listRow[cols.item] : "") || "", note: list.map(e => e.note).filter(Boolean).join(" / "), lines: list.map(x => x.line) };
      if (!listRow) { out.notInList.push({ ...base, dueRaw: first.dueRaw }); return; }
      // 대체품 의심: 품목명·규격이 목록과 다르거나, 회신·메모에 "대체·동급·호환" 같은 말이 있으면 표시한다 (날짜 비교와는 별개로 항상 확인)
      const listItem = cols.item ? String(listRow[cols.item] || "") : "", listSpec = cols.spec ? String(listRow[cols.spec] || "") : "";
      const supItem = first.item, supSpec = first.spec;
      const reasons = [];
      if (differs(listItem, supItem)) reasons.push("품목명이 달라요");
      if (differs(listSpec, supSpec)) reasons.push("규격이 달라요");
      const word = SUBST_WORDS.exec(list.map(e => e.note + " " + e.dueRaw).join(" "));
      if (word) reasons.push("회신에 '" + word[0] + "'(이)라는 말이 있어요");
      const listQty = cols.qty ? J.parseNumber(listRow[cols.qty]) : null, supQtyNum = list.reduce((n, e) => n + (J.parseNumber(e.qty) || 0), 0), hasSupQty = list.some(e => J.parseNumber(e.qty) != null);
      if (reasons.length) out.subst.push({ ...base, listItem, listSpec, supItem, supSpec, listQty: listQty == null ? "" : listQty, supQty: hasSupQty ? supQtyNum : "", reasons, qtyDiff: listQty != null && hasSupQty && listQty !== supQtyNum });
      const listDue = listRow[cols.due] || "";
      if (list.length > 1 && dates.length > 1) {
        // 같은 주문이 여러 줄이고 날짜가 다르면 분납 일정으로 본다. 수량이 있으면 합계가 주문수량과 맞는지도 알려 준다.
        const schedule = cls.filter(x => x.c.kind === "date").map(x => ({ date: x.c.date, qty: x.e.qty, line: x.e.line })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        out.multi.push({ ...base, from: listDue, dates, schedule, qtySum: hasSupQty ? supQtyNum : "", listQty: listQty == null ? "" : listQty, qtyMatch: hasSupQty && listQty != null ? supQtyNum === listQty : null, dueRaw: list.map(e => e.dueRaw).join(" / ") });
        return;
      }
      if (dates.length === 1) {
        const ld = J.parseDate(listDue);
        if (ld && isoOf(ld) === dates[0]) out.same.push({ ...base, from: listDue, to: dates[0] });
        else out.changed.push({ ...base, from: listDue, to: dates[0], dueRaw: first.dueRaw, careful: cls.some(x => x.c.note) });
        return;
      }
      const c = cls[0].c;
      if (c.kind === "vague") out.vague.push({ ...base, from: listDue, dueRaw: first.dueRaw, why: c.note });
      else out.noReply.push({ ...base, from: listDue, dueRaw: c.kind === "unclear" ? first.dueRaw : "", reply: c.kind === "unclear" ? first.dueRaw : "" });
    });
    return out;
  }

  // 두 이름이 같다고 볼 수 있는지: 공백·기호·대소문자를 무시하고, 한쪽이 다른 쪽을 포함하면("산업용 베어링 6204" ⊃ "베어링 6204") 같다고 본다. 한쪽이 비어 있으면 비교하지 않는다.
  const flat = s => String(s || "").toLowerCase().replace(/[\s_\-.,()/[\]]/g, "");
  function differs(a, b) {
    const x = flat(a), y = flat(b);
    if (!x || !y) return false;
    return !(x === y || x.includes(y) || y.includes(x));
  }

  const api = { SYN, SUBST_WORDS, differs, fieldOf, columnsOfRow, findHeader, classifyDue, buildEntries, compare, idKey };
  if (typeof module !== "undefined") module.exports = api; else root.Supplier = api;
})(typeof window !== "undefined" ? window : globalThis);
