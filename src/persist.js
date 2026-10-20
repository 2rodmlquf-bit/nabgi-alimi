// 저장된 기록을 새로 연 목록에 다시 적용하고, 현재 상태를 저장본에 합치는 순수 함수.
// 저장하는 것: edited(이메일로 바꾼 납기 {from,to}), reasons(사유), causeOverride(직접 지정한 원인), notice(템플릿 선택)
(function (root) {
  const empty = () => ({ edited: {}, reasons: {}, causeOverride: {}, notice: null, contacted: {}, contactLog: {}, informed: {}, quickNotes: {}, subst: {}, schedule: {}, soonRules: null });
  const CHANNELS = ["메일", "카톡·문자", "전화", "구두", "기타"];
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const SUBST_STATES = ["의심", "확인요청중", "승인", "거절"];

  // opts.cap === false 이면 항목 수 상한으로 자르지 않는다. 저장소(store/core.js)가 상한을 직접 적용하면서 "한도로 밀림"을 기록하려고 쓴다.
  // 기록마다 저장소가 붙인 id와 만든 시각은 화면을 거쳐 다시 저장될 때 같은 기록임을 알려 주므로 버리지 않는다.
  const idc = e => ({ ...(typeof e.id === "string" && e.id ? { id: e.id.slice(0, 64) } : {}), ...(typeof e.createdAt === "string" && e.createdAt ? { createdAt: e.createdAt.slice(0, 40) } : {}) });

  function clean(saved, opts = {}) {
    const capped = opts.cap !== false;
    const s = empty();
    if (!saved || typeof saved !== "object") return s;
    ["edited", "reasons", "causeOverride"].forEach(k => { if (saved[k] && typeof saved[k] === "object" && !Array.isArray(saved[k])) s[k] = { ...saved[k] }; });
    // 연락함 표시: { 공급사 이름: "YYYY-MM-DD" }
    if (saved.contacted && typeof saved.contacted === "object" && !Array.isArray(saved.contacted)) Object.entries(saved.contacted).forEach(([k, v]) => { if (typeof v === "string") s.contacted[k] = v; });
    // 대체품 확인 상태(주문별): { state, note, supItem, supSpec, supQty, source, date }
    if (saved.subst && typeof saved.subst === "object" && !Array.isArray(saved.subst)) {
      Object.entries(saved.subst).forEach(([no, v]) => {
        if (!v || !SUBST_STATES.includes(v.state)) return;
        const t = x => String(x == null ? "" : x).slice(0, 120);
        s.subst[no] = { state: v.state, note: t(v.note), supItem: t(v.supItem), supSpec: t(v.supSpec), supQty: t(v.supQty), source: t(v.source), date: /^\d{4}-\d{2}-\d{2}$/.test(v.date || "") ? v.date : "" };
      });
    }
    // 분납 일정(주문별): [{ date, qty }]
    if (saved.schedule && typeof saved.schedule === "object" && !Array.isArray(saved.schedule)) {
      Object.entries(saved.schedule).forEach(([no, arr]) => {
        if (!Array.isArray(arr)) return;
        const all = arr.filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "")).map(e => ({ date: e.date, qty: String(e.qty == null ? "" : e.qty).slice(0, 20), ...idc(e) }));
        const ok = capped ? all.slice(0, 20) : all;
        if (ok.length) s.schedule[no] = ok;
      });
    }
    // 공급사 연락 이력: { 공급사: [{ date, kind, channel, promised, note }] } (공급사당 최근 200건까지)
    if (saved.contactLog && typeof saved.contactLog === "object" && !Array.isArray(saved.contactLog)) {
      Object.entries(saved.contactLog).forEach(([k, arr]) => {
        if (!Array.isArray(arr)) return;
        const ok = arr.filter(e => e && typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && (e.kind === "attempt" || e.kind === "reply"))
          .map(e => ({ date: e.date, kind: e.kind, channel: String(e.channel || "기타").slice(0, 10), promised: /^\d{4}-\d{2}-\d{2}$/.test(e.promised || "") ? e.promised : "", note: String(e.note || "").slice(0, 200), ...idc(e) }));
        if (ok.length) s.contactLog[k] = capped ? ok.slice(-200) : ok;
      });
    }
    // 연구원 안내 기록(주문별): [{ date, channel, status, due, note }] (주문당 최근 50건까지)
    if (saved.informed && typeof saved.informed === "object" && !Array.isArray(saved.informed)) {
      Object.entries(saved.informed).forEach(([no, arr]) => {
        if (!Array.isArray(arr)) return;
        const ok = arr.filter(e => e && ISO.test(e.date || "") && (e.status === "지연" || e.status === "임박" || e.status === "확인필요"))
          .map(e => ({ date: e.date, channel: CHANNELS.includes(e.channel) ? e.channel : "기타", status: e.status, due: String(e.due == null ? "" : e.due).slice(0, 40), note: String(e.note || "").slice(0, 200),
            // 저장소가 붙인 고유 id와 만든 시각은 화면을 거쳐 다시 저장될 때 같은 기록임을 알려 주므로 버리지 않는다
            ...(typeof e.id === "string" && e.id ? { id: e.id.slice(0, 64) } : {}), ...(typeof e.createdAt === "string" && e.createdAt ? { createdAt: e.createdAt.slice(0, 40) } : {}) }));
        if (ok.length) s.informed[no] = capped ? ok.slice(-50) : ok;
      });
    }
    // 빠른 메모(주문별): [{ text, createdAt?, id? }] (주문당 최근 50건, 한 건 300자). 안내 상태와는 무관하다.
    if (saved.quickNotes && typeof saved.quickNotes === "object" && !Array.isArray(saved.quickNotes)) {
      Object.entries(saved.quickNotes).forEach(([no, arr]) => {
        if (!Array.isArray(arr)) return;
        const ok = arr.filter(e => e && typeof e.text === "string" && e.text.trim())
          .map(e => ({ text: e.text.slice(0, 300), ...(typeof e.id === "string" && e.id ? { id: e.id.slice(0, 64) } : {}), ...(typeof e.createdAt === "string" && e.createdAt ? { createdAt: e.createdAt.slice(0, 40) } : {}) }));
        if (ok.length) s.quickNotes[no] = capped ? ok.slice(-50) : ok;
      });
    }
    if (typeof saved.soonRules === "string") s.soonRules = saved.soonRules.slice(0, 2000);
    if (Number.isInteger(saved.reAlertDays) && saved.reAlertDays >= 1 && saved.reAlertDays <= 30) s.reAlertDays = saved.reAlertDays;   // 다시 안내 기준 일수 (FR-18). 없으면 기본 7일
    if (saved.notice && typeof saved.notice === "object") s.notice = { template: String(saved.notice.template || ""), alt: String(saved.notice.alt || ""), signature: String(saved.notice.signature || "") };
    return s;
  }

  // 저장된 납기 변경을 목록 행에 다시 적용한다.
  // - 목록의 현재 납기가 저장된 'from'과 같으면 'to'로 바꾼다.
  // - 이미 'to'이면 그대로 두고 "적용된 것"으로 본다.
  // - 둘 다 아니면(새 파일에서 납기가 달라짐) 덮어쓰지 않고 충돌로 알린다.
  function applySavedDue(rows, idCol, dueCol, edited) {
    const applied = {}, conflicts = [];
    const byId = new Map(rows.map(r => [r[idCol], r]));
    Object.entries(edited || {}).forEach(([no, ed]) => {
      const row = byId.get(no);
      if (!row || !ed) return;
      if (row[dueCol] === ed.from) { row[dueCol] = ed.to; applied[no] = ed; }
      else if (row[dueCol] === ed.to) applied[no] = ed;
      else conflicts.push(no);
    });
    return { applied, conflicts };
  }

  // 현재 목록에 있는 주문번호의 기록은 현재 상태로 바꾸고, 다른 목록의 기록은 그대로 둔다.
  function mergeState(saved, current, orderNos) {
    const out = clean(saved);
    const here = new Set(orderNos);
    ["edited", "reasons", "causeOverride", "subst", "schedule", "informed", "quickNotes"].forEach(k => {
      Object.keys(out[k]).forEach(no => { if (here.has(no)) delete out[k][no]; });
      Object.entries(current[k] || {}).forEach(([no, v]) => { if (here.has(no)) out[k][no] = v; });
    });
    out.notice = current.notice || out.notice;
    if (typeof current.soonRules === "string") out.soonRules = current.soonRules.slice(0, 2000); // 품목별 임박 기준은 주문과 무관하게 현재 값이 전부다
    const days = clean({ reAlertDays: current.reAlertDays }).reAlertDays;                         // 다시 안내 기준도 현재 값이 전부다 (기본값으로 되돌리면 지워진다)
    if (days) out.reAlertDays = days; else delete out.reAlertDays;
    if (current.contactLog) out.contactLog = clean({ contactLog: current.contactLog }, { cap: false }).contactLog; // 공급사 이름 기준이라 현재 값이 전부다 (상한은 저장소가 적용한다)
    if (current.contacted) out.contacted = { ...current.contacted }; // 공급사 이름 기준이라 주문 목록과 무관하게 현재 값이 전부다 (해제도 반영)
    return out;
  }

  function counts(saved) {
    const s = clean(saved);
    return { edited: Object.keys(s.edited).length, causeOverride: Object.keys(s.causeOverride).length, reasons: Object.keys(s.reasons).length };
  }

  const api = { empty, clean, applySavedDue, mergeState, counts };
  if (typeof module !== "undefined") module.exports = api; else root.Persist = api;
})(typeof window !== "undefined" ? window : globalThis);
