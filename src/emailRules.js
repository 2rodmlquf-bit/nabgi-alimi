// 규칙 기반 이메일 납기 추출 (API 키 불필요). 명확한 날짜만 읽고, 애매하면 비워 둔다.
// 반환 형식은 Claude 모드(src/email.js)와 같다.
(function (root) {
  const J = typeof require !== "undefined" ? require("./judge") : root.Judge;
  const DAY = 86400000;
  const WEEKDAYS = "일월화수목금토";
  // 애매한 표현: 날짜를 확정하지 않는다.
  const HEDGE = /빠르면|늦으면|늦어도|(?:\d일|\d월)\s?경|쯤|정도|전후|내외|미정|확인 후|가능성|또는|(?:\d+월|주)\s?(?:초|중순|말|상순|하순)|[\d일]\s?[~∼–]\s?\d/;
  const CHANGE = /변경|연기|수정|에서|→|->/;
  const RELATIVE_WEEK = /(?:다음|이번|담)\s?주|(?:월|화|수|목|금|토|일)요일/;
  const REASON = /((?:[가-힣]+ ){0,2}[가-힣]*(?:보완|지연|부족|불량|파업|악화))(?:으로|로|때문에|때문)/;
  // 날짜 앞뒤의 말로 '도착 쪽'인지 '출발 쪽'인지 가른다.
  const ARRIVE = /ETA|도착|입고|납기|인도/i;
  const DEPART = /ETD|출항|출고|선적|발송|출발/i;
  // 월/일(10/23, 10.23)은 숫자 모양만으로는 1/2인치 같은 것과 구별이 안 되므로, 이런 말이 가까이 있을 때만 날짜로 본다.
  const CTX = /납기|입고|출고|도착|출항|선적|ETA|ETD|예정|까지|일정/i;
  // 대체품이 의심되는 말 (가정). 공급사 회신에 이런 말이 있으면 연구원 승인 확인이 필요하다고 알린다.
  const SUBST = /대체|동급|호환|변경\s?모델|단종|다른\s?모델|상위\s?모델|후속\s?모델/;
  const SENT_LINE = /발신|작성일|보낸 날짜|sent\s?:|date\s?:/i; // 메일을 보낸 날짜는 납기가 아니다

  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 한 문장을 원문 그대로 잘라 온다 (근거 문장은 반드시 원문의 일부여야 한다).
  function sentenceAt(text, idx) {
    let a = idx, b = idx;
    while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--;
    while (b < text.length && !/[.!?\n]/.test(text[b])) b++;
    if (b < text.length && /[.!?]/.test(text[b])) b++;
    return text.slice(a, b).trim();
  }
  const lineAt = (s, i) => { const a = s.lastIndexOf("\n", i - 1) + 1; let b = s.indexOf("\n", i); if (b < 0) b = s.length; return s.slice(a, b); };

  function findDates(seg, offset, base) {
    const raw = [];
    const yearOf = (m, d) => {
      let year = base.getUTCFullYear(), rolled = false;
      const cand = J.parseDate(year + "-" + m + "-" + d);
      if (cand && cand < new Date(base.getTime() - 180 * DAY)) { year += 1; rolled = true; }
      return { year, rolled };
    };
    const push = (y, m, d, index, len, kind) => {
      let year = y, rolled = false;
      if (!year) ({ year, rolled } = yearOf(m, d));
      const dt = J.parseDate(year + "-" + m + "-" + d);
      if (!dt) return;
      const wd = seg.slice(index + len, index + len + 5).match(/^\s?\(([월화수목금토일])\)/);
      raw.push({ iso: iso(dt), index, len, kind, rolled, wdBad: wd ? WEEKDAYS[dt.getUTCDay()] !== wd[1] : false, wdGiven: wd ? wd[1] : "" });
    };
    let m;
    const reIso = /(\d{4})[-/.]\s?(\d{1,2})[-/.]\s?(\d{1,2})/g;
    while ((m = reIso.exec(seg))) push(+m[1], +m[2], +m[3], m.index, m[0].length, "abs");
    const reKo = /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/g;
    while ((m = reKo.exec(seg))) push(m[1] ? +m[1] : 0, +m[2], +m[3], m.index, m[0].length, "abs");
    // 월/일 표기
    const reMd = /(?<![\d/.:-])(\d{1,2})([/.])(\d{1,2})(?![\d/.])/g;
    while ((m = reMd.exec(seg))) {
      const mo = +m[1], da = +m[3];
      if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
      const end = m.index + m[0].length;
      if (/^\s?(?:kg|g|mm|cm|m|l|톤|%|개|ea|인치|배|원|만|건|매|리터)/i.test(seg.slice(end, end + 4))) continue; // 2.5톤, 1/2인치 같은 수량·규격
      const hasWeekday = /^\s?\([월화수목금토일]\)/.test(seg.slice(end, end + 5));
      const near = seg.slice(Math.max(0, m.index - 12), m.index) + " " + seg.slice(end, end + 10);
      const line = lineAt(seg, m.index);
      const cell = /[|\t]/.test(line) && line.split(/[|\t]/).some(c => c.trim() === m[0]);
      if (hasWeekday || CTX.test(near) || cell) push(0, mo, da, m.index, m[0].length, "abs");
    }
    const reRel = /오늘|내일|모레/g;
    while ((m = reRel.exec(seg))) {
      const add = { 오늘: 0, 내일: 1, 모레: 2 }[m[0]];
      raw.push({ iso: iso(new Date(base.getTime() + add * DAY)), index: m.index, len: m[0].length, kind: "rel", rolled: false, wdBad: false, wdGiven: "" });
    }
    raw.sort((a, b) => a.index - b.index);
    // 메일 발신 날짜 같은 줄은 버린다
    const kept = raw.filter(d => !SENT_LINE.test(lineAt(seg, d.index)));
    // 도착·출발 라벨 붙이기. ETA/ETD처럼 날짜 앞에 쓰는 영문 라벨은 뒤 날짜의 것이고,
    // "10월 18일 출항"처럼 날짜 뒤에 붙는 한글 설명은 앞 날짜의 것이다 (두 날짜 사이의 글자가 양쪽에 섞이지 않게).
    const pick = s => (ARRIVE.test(s) && !DEPART.test(s) ? "arr" : DEPART.test(s) && !ARRIVE.test(s) ? "dep" : "");
    const LATIN = /ETA|ETD/gi;
    kept.forEach((d, i) => {
      const prevEnd = i ? kept[i - 1].index + kept[i - 1].len : 0;
      const nextStart = i + 1 < kept.length ? kept[i + 1].index : seg.length;
      const before = seg.slice(Math.max(prevEnd, d.index - 12), d.index);
      const after = seg.slice(d.index + d.len, Math.min(d.index + d.len + 8, nextStart));
      const latinBefore = (before.match(LATIN) || []).join(" ");
      d.label = pick(latinBefore) || pick(after.replace(LATIN, " ")) || (i === 0 ? pick(before.replace(LATIN, " ")) : "");
    });
    kept.forEach(d => { d.index += offset; });
    return kept;
  }

  const SEP_ONLY = /^[\s,、·/&와과및]*$/;

  function extract(text, today, knownIds) {
    const base = J.parseDate(today);
    if (!base) throw new Error("기준일을 해석할 수 없습니다: " + today);
    const src = String(text);
    // 1) 주문번호 위치 찾기: 목록에 있는 번호 + 일반적인 번호 모양
    const hits = new Map();
    const reId = /[A-Z]{2,}-\d[\d-]*\d/g;
    let m;
    while ((m = reId.exec(src))) hits.set(m.index, m[0]);
    (knownIds || []).filter(Boolean).forEach(id => {
      const re = new RegExp(esc(id), "g");
      while ((m = re.exec(src))) if (!hits.has(m.index)) hits.set(m.index, id);
    });
    const order = [...hits.entries()].sort((a, b) => a[0] - b[0]);
    // 2) 주문번호마다 다음 주문번호가 나오기 전까지를 한 덩어리로 본다
    const parts = order.map(([idx, id], i) => ({ id, idx, end: i + 1 < order.length ? order[i + 1][0] : src.length }));
    const byId = new Map();
    parts.forEach((p, i) => {
      if (!byId.has(p.id)) byId.set(p.id, []);
      const segs = byId.get(p.id);
      segs.push({ start: p.idx, text: src.slice(p.idx, p.end) });
      // "PO-1, PO-2 두 건은 10월 23일"처럼 번호만 이어 붙여 쓴 경우, 뒤 번호의 내용도 같이 본다
      for (let j = i + 1; j < parts.length; j++) {
        const gap = src.slice(parts[j - 1].idx + parts[j - 1].id.length, parts[j].idx);
        if (!SEP_ONLY.test(gap)) break;
        segs.push({ start: parts[j].idx, text: src.slice(parts[j].idx, parts[j].end) });
      }
    });
    const items = [], texts = new Map();
    byId.forEach((segs, id) => {
      const all = segs.map(s => s.text).join("\n");
      texts.set(id, all);
      const dates = [];
      segs.forEach(s => dates.push(...findDates(s.text, s.start, base)));
      const uniq = [...new Map(dates.map(d => [d.iso, d])).values()].sort((a, b) => a.index - b.index);
      const rm = all.match(REASON);
      const reason = rm ? rm[1] : "";
      const hedge = HEDGE.exec(all);
      const base_ = { orderNo: id, reason, evidenceOk: true };
      const evOf = idx => sentenceAt(src, idx);
      const one = d => {
        const notes = [];
        if (d.kind === "rel") notes.push("'오늘/내일/모레'를 기준일로 계산했어요.");
        if (d.rolled) notes.push("연도가 없어 다음 해로 봤어요. 확인하세요.");
        if (d.wdBad) notes.push("요일(" + d.wdGiven + ")이 날짜와 맞지 않아요. 날짜나 요일 중 하나가 잘못 적혔을 수 있어요.");
        return { ...base_, dueDate: d.iso, evidence: evOf(d.index), confidence: d.kind === "rel" || d.rolled || d.wdBad ? "보통" : "높음", note: notes.join(" ") };
      };
      if (hedge) {
        const hi = src.indexOf(hedge[0], segs[0].start);
        items.push({ ...base_, dueDate: null, evidence: evOf(hi >= 0 ? hi : segs[0].start), confidence: "보통",
          note: (/[~∼–]/.test(hedge[0]) ? "날짜가 범위(~)로 적혀 있어" : "'" + hedge[0] + "' 같은 표현이 있어") + " 날짜를 확정하지 않았어요. 직접 확인하세요." });
      } else if (!uniq.length) {
        const rel = RELATIVE_WEEK.exec(all);
        items.push({ ...base_, dueDate: null, evidence: rel ? evOf(src.indexOf(rel[0], segs[0].start)) : "", confidence: "낮음",
          note: rel ? "'" + rel[0] + "' 같은 상대 표현은 규칙 모드에서 계산하지 않아요. Claude 모드를 쓰거나 직접 확인하세요." : "이 주문번호 근처에서 날짜를 찾지 못했어요." });
      } else if (uniq.length === 1) {
        items.push(one(uniq[0]));
      } else if (CHANGE.test(all)) {
        const d = uniq[uniq.length - 1];
        items.push({ ...base_, dueDate: d.iso, evidence: evOf(d.index), confidence: "보통",
          note: "날짜가 여러 개(" + uniq.map(u => u.iso).join(", ") + ")라 마지막 날짜를 변경 후 날짜로 봤어요. 확인하세요." });
      } else if (uniq.filter(d => d.label === "arr").length === 1) {
        const d = uniq.find(x => x.label === "arr");
        items.push({ ...base_, dueDate: d.iso, evidence: evOf(d.index), confidence: "보통",
          note: "날짜가 여러 개(" + uniq.map(u => u.iso).join(", ") + ")라 도착·입고로 적힌 날짜를 썼어요. 확인하세요." });
      } else {
        items.push({ ...base_, dueDate: null, evidence: evOf(uniq[0].index), confidence: "낮음",
          note: "날짜가 여러 개(" + uniq.map(u => u.iso).join(", ") + ")라 확정하지 않았어요." });
      }
    });
    // 대체품 의심: 날짜를 읽었든 못 읽었든 알린다 (날짜 판정과는 별개)
    items.forEach(it => {
      const m = SUBST.exec(texts.get(it.orderNo) || "");
      if (!m) return;
      it.substitute = true; it.subWord = m[0];
      it.note = (it.note ? it.note + " " : "") + "'" + m[0] + "' 같은 말이 있어 대체품일 수 있어요. 연구원 승인 확인이 필요해요.";
    });
    return items;
  }

  const api = { extract, SUBST };
  if (typeof module !== "undefined") module.exports = api; else root.EmailRules = api;
})(typeof window !== "undefined" ? window : globalThis);
