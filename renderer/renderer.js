// 화면 코드. 파일 읽기는 main.js가 하고, 여기서는 표시와 클릭만 다룬다.
const { STD, REQUIRED, guessMapping } = Columns;   // 열 이름 추측은 src/columns.js
const TABLE_COLS = ["주문번호", "품목명", "공급사", "요청자", "납기일", "선적상태", "통관상태"];

const $ = id => document.getElementById(id);
const S = { name: "", columns: [], rows: [], mapping: {}, selected: null, result: null, picked: new Set(), q: "", sort: null };

function localToday() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}


function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k === "style") String(v).split(";").forEach(p => { const i = p.indexOf(":"); if (i > 0) e.style.setProperty(p.slice(0, i).trim(), p.slice(i + 1).trim()); }); // 보안 설정상 style 속성은 막혀 있어 코드로 지정
    else e.setAttribute(k, v);
  });
  kids.forEach(k => e.append(k));
  return e;
}

function showMapping() {
  const grid = $("mapGrid");
  grid.replaceChildren();
  STD.forEach(std => {
    const sel = el("select", { id: "map-" + std });
    sel.append(el("option", { value: "" }, "(연결 안 함)"));
    S.columns.forEach(c => { const o = el("option", { value: c }, c); if (S.mapping[std] === c) o.selected = true; sel.append(o); });
    grid.append(el("label", {}, std + (REQUIRED.includes(std) ? " *" : ""), sel, el("span", { class: "mapnote", id: "mapnote-" + std })));
  });
  $("mapPanel").hidden = false;
  Object.entries(S.ai || {}).forEach(([std, a]) => showNote(std, a));
}

function sentPreview() {
  return { columns: S.columns, sampleRows: S.rows.slice(0, 3).map(r => S.columns.map(c => String(r[c] == null ? "" : r[c]).slice(0, 60))) };
}

function showNote(std, a) {
  const n = $("mapnote-" + std);
  if (!n) return;
  const cls = a.confidence === "높음" ? "high" : a.confidence === "보통" ? "mid" : "low";
  n.className = "mapnote " + cls;
  n.textContent = a.column ? "Claude 제안 · 신뢰도 " + a.confidence + (a.reason ? " · " + a.reason : "") : "Claude가 찾지 못함" + (a.reason ? " · " + a.reason : "");
}


function missingRequired() { return REQUIRED.filter(k => !S.mapping[k]); }

function toStd(row) {
  const o = { _raw: row };
  STD.forEach(std => (o[std] = S.mapping[std] ? row[S.mapping[std]] || "" : ""));
  if (!S.mapping["입고여부"]) o["입고여부"] = "";
  return o;
}

function compute() {
  const soon = Math.max(1, parseInt($("soon").value, 10) || 7);
  const today = $("today").value || localToday();
  S.result = Judge.findExceptions(S.rows.map(toStd), today, { def: soon, rules: Judge.parseRules(S.soonRules) });
  render();
}

// ---- 키보드로 표 쓰기 (접근성) ----
// 표에서 탭 정지 지점은 한 줄(고른 줄 또는 첫 줄)이다. 위·아래 화살표로 줄을 옮기고, Enter는 상세 열기, Space는 체크.
// 그 줄의 체크 상자와 연구원·공급사 단추는 그 줄에 있을 때만 탭으로 닿는다.
function activateRow(tr) {
  [...$("tbody").children].forEach(r => { const on = r === tr; r.tabIndex = on ? 0 : -1; r.querySelectorAll("[data-rowctl]").forEach(c => (c.tabIndex = on ? 0 : -1)); });
}
function rowKey(e, tr, o, cb) {
  if (e.target !== tr) return;                                                   // 줄 안의 체크 상자·단추가 받은 키는 건드리지 않는다
  const rows = [...$("tbody").children], i = rows.indexOf(tr);
  const go = j => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (r) { e.preventDefault(); r.focus(); } };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(rows.length - 1);
  else if (e.key === "Enter" && !e.repeat) { e.preventDefault(); S.selected = NO(o); S.focusDetail = true; render(); }   // 상세 패널로 포커스를 옮긴다 (Tab으로 안내 기록에 닿는다). 기록은 자동으로 하지 않는다
  else if (e.key === " ") { e.preventDefault(); cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
}
document.addEventListener("focusin", e => { const tr = e.target.closest && e.target.closest("#tbody tr"); if (tr) activateRow(tr); });

function partialBadge(o) { return el("span", { class: "badge warn" }, "부분입고 " + o.partial.received + "/" + o.partial.ordered); }
function badge(status) { return el("span", { class: "badge " + (status === "지연" ? "late" : status === "임박" ? "soon" : "warn") }, Labels.status(status)); }
function daysText(o) { return o.daysLeft == null ? "-" : o.daysLeft < 0 ? "D+" + -o.daysLeft : o.daysLeft === 0 ? "D-day" : "D-" + o.daysLeft; }

// ---- 2차: 지연 원인, 안내문, 지연 분석 ----
S.reasons = {}; S.causeOverride = {}; S.filter = {}; S.view = "home"; S.bulk = null; S.notice = { template: "사과형", alt: "", signature: "" };
// ---- 저장: 직접 고친 값을 이 컴퓨터에 남긴다 ----
let P = Persist.empty(), saveTimer = null;
S.savedNote = ""; S.contacted = {}; S.contactLog = {}; S.informed = {}; S.quickNotes = {}; S.replies = {}; S.onlyNeed = false; S.subst = {}; S.schedule = {};

function showSaved() {
  const c = Persist.counts(P), total = c.edited + c.causeOverride + c.reasons;
  const counts = total ? "저장된 기록: 납기 변경 " + c.edited + "건, 원인 지정 " + c.causeOverride + "건, 사유 " + c.reasons + "건" : "";
  $("savedInfo").textContent = [S.stateNotice, S.sizeWarn, counts].filter(Boolean).join(" · ");   // 저장 파일에 문제가 있었으면(예전 형식 이전, 손상, 읽기 전용) 그 사실을 먼저 보여 준다
  $("clearSaved").hidden = !total;
}
function snapshot() {
  const idc = S.mapping["주문번호"];
  const nos = idc ? S.rows.map(r => r[idc]) : [];
  P = Persist.mergeState(P, { edited: S.edited, reasons: S.reasons, causeOverride: S.causeOverride, notice: S.notice, contacted: S.contacted, contactLog: S.contactLog, informed: S.informed, quickNotes: S.quickNotes, replies: S.replies, subst: S.subst, schedule: S.schedule, soonRules: S.soonRules, reAlertDays: S.reAlertDays || undefined }, nos);
  return P;
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const r = await window.app.saveState(snapshot());
    S.sizeWarn = r.ok && r.warning ? r.warning : "";                 // 저장 공간이 80%를 넘으면 미리 알린다
    if (r.ok) showSaved(); else $("savedInfo").textContent = r.error;
  }, 300);
}
// 저장본(P)의 기록을 화면 상태(S)로 복사한다. 두 곳(파일을 새로 열 때, 앱을 켤 때)이 같이 쓴다.
function copySavedIntoState() {
  S.contacted = { ...P.contacted }; S.contactLog = JSON.parse(JSON.stringify(P.contactLog)); S.informed = JSON.parse(JSON.stringify(P.informed)); S.quickNotes = JSON.parse(JSON.stringify(P.quickNotes)); S.replies = JSON.parse(JSON.stringify(P.replies)); S.subst = JSON.parse(JSON.stringify(P.subst)); S.schedule = JSON.parse(JSON.stringify(P.schedule));
}
// 새로 연 목록에 저장된 기록을 다시 적용한다. 새 파일의 납기가 저장된 값과 다르면 덮어쓰지 않고 알린다.
function applySaved() {
  S.reasons = { ...P.reasons }; S.causeOverride = { ...P.causeOverride }; copySavedIntoState();
  const r = Persist.applySavedDue(S.rows, S.mapping["주문번호"], S.mapping["납기일"], P.edited);
  S.edited = r.applied;
  const n = Object.keys(r.applied).length;
  S.savedNote = (n ? "저장된 납기 변경 " + n + "건을 다시 적용했어요. " : "") +
    (r.conflicts.length ? "새 파일의 납기가 저장된 값과 달라서 적용하지 않은 주문이 " + r.conflicts.length + "건 있어요: " + r.conflicts.slice(0, 5).join(", ") + (r.conflicts.length > 5 ? " 외" : "") : "");
}
async function initState() {
  P = Persist.clean(await window.app.loadState());
  const info = await window.app.stateInfo();                      // 저장소가 알려 주는 것: 예전 형식을 바꿨는지, 손상 파일을 치웠는지, 읽기 전용인지
  S.stateNotice = (info && info.notices || []).map(n => n.message).join(" ");
  copySavedIntoState();
  if (P.notice && Notice.TEMPLATES.includes(P.notice.template)) S.notice = { template: P.notice.template, alt: P.notice.alt, signature: P.notice.signature || "" };
  S.soonRules = P.soonRules;
  S.reAlertDays = P.reAlertDays || null;
  $("rulesText").value = S.soonRules || "";
  $("reAlertDays").value = String(staleDays());
  showSaved();
}

const NO = o => o["주문번호"];
const reasonOf = o => S.reasons[NO(o)] || o["비고"] || "";
const causeOf = o => S.causeOverride[NO(o)] || Cause.classifyCause(reasonOf(o));
const delayedList = () => S.result.exceptions.filter(o => o.status === "지연");
// 표에 보이는 모든 주문: 지연·임박(급한 순) 다음에 '확인 필요'(맨 아래). 납기일을 읽을 수 없는 주문도 안내 대상이다 (G-8).
const listed = () => S.result.exceptions.concat(S.result.needCheck);
const requesterOf = o => (o["요청자"] || "").trim() || "(요청자 없음)";
// 필터: 원인(지연만), 요청자(사람), 공급사. 요청자·공급사 필터는 지연과 임박을 모두 보여 준다.
const norm = (v, empty) => (v || "").trim() || empty;
const hasFilter = () => !!(S.filter.cause || S.filter.requester || S.filter.supplier);

// ---- 연구원 안내 기록: "연구원에게 알렸는가"를 주문마다 남기고, 다시 알려야 할 때를 알려 준다 ----
const baseDay = () => $("today").value || localToday();
const informedOrder = o => ({ status: o.status, due: o["납기일"] || "" });
// 다시 안내 기준 일수 (FR-18): 설정한 값, 없으면 기본 7일
const staleDays = () => S.reAlertDays || Informed.STALE_DAYS;
const informedOf = o => Informed.stateOf(informedOrder(o), S.informed[NO(o)], baseDay(), staleDays());
const informedSummary = list => Informed.summary(list.map(o => ({ order: informedOrder(o), entries: S.informed[NO(o)] })), baseDay(), staleDays());
const informedLabel = o => { const st = informedOf(o); return st.state === "안내완료" ? Labels.state("안내완료") + "(" + st.last.date + ")" : st.state === "재안내필요" ? Labels.state("재안내필요") + "(" + st.reason + ")" : Labels.state("미안내"); };
function informedBadge(o) {
  const st = informedOf(o);
  if (st.state === "안내완료") return el("span", { class: "badge ok", title: st.last.channel + "로 " + st.last.date + "에 안내함" }, "안내 " + st.last.date.slice(5));
  if (st.state === "재안내필요") return el("span", { class: "badge soon", title: st.reason }, Labels.state("재안내필요"));
  return el("span", { class: "badge late" }, Labels.state("미안내"));
}
// 표의 안내 칸에 붙는 작은 표시: 이 주문에 빠른 메모가 몇 건 있는지. 안내 상태와는 무관하다.
function memoBadge(o) {
  const n = QuickNote.count(S.quickNotes, NO(o));
  return el("span", { class: "badge memo", title: "빠른 메모 " + n + "건" }, "메모 " + n);
}
// 주문들을 안내함으로 기록한다. 같은 날 같은 채널로 이미 기록한 주문은 건너뛰고, 새로 쌓은 건수를 돌려준다.
function recordInformed(list, channel, note) {
  let added = 0;
  list.forEach(o => { if (Informed.append(S.informed, NO(o), Informed.makeEntry(informedOrder(o), baseDay(), channel, note))) added++; });
  if (added) persist();
  return added;
}
function channelSelect() {
  const sel = el("select", { "aria-label": "안내 채널" }); Informed.CHANNELS.forEach(c => sel.append(el("option", { value: c }, c)));
  return sel;
}

function visible() {
  let l = listed();
  if (S.onlyNeed) l = l.filter(o => informedOf(o).state !== "안내완료");
  if (S.filter.cause) l = l.filter(o => o.status === "지연" && causeOf(o) === S.filter.cause);
  if (S.filter.requester) l = l.filter(o => norm(o["요청자"], "(요청자 없음)") === S.filter.requester);
  if (S.filter.supplier) l = l.filter(o => norm(o["공급사"], "(공급사 없음)") === S.filter.supplier);
  const q = S.q.trim().toLowerCase();
  if (q) l = l.filter(o => ["주문번호", "품목명", "공급사", "요청자"].some(k => String(o[k] || "").toLowerCase().includes(q)));
  return S.sort ? sorted(l, S.sort) : l;
}
// 표 머리글을 눌러 정렬: 같은 머리글을 누를 때마다 오름차순 → 내림차순 → 원래 순서(지연 오래된 순, 임박 가까운 순)
function sortValue(o, key) {
  if (key === "상태") return (o.status === "지연" ? 0 : 1) * 1000 + (o.daysLeft == null ? 999 : o.daysLeft);
  if (key === "남은 일수") return o.daysLeft == null ? Infinity : o.daysLeft;
  if (key === "안내") return { 미안내: 0, 재안내필요: 1, 안내완료: 2 }[informedOf(o).state]; // 안내가 필요한 것부터
  if (key === "납기일") { const d = Judge.parseDate(o["납기일"]); return d ? d.getTime() : Infinity; } // 날짜 표기가 제각각이라 날짜로 바꿔서 비교
  return String(o[key] || "");
}
function sorted(list, { key, dir }) {
  const sign = dir === "desc" ? -1 : 1;
  return list.map((o, i) => [o, i]).sort(([a, i], [b, j]) => {
    const x = sortValue(a, key), y = sortValue(b, key);
    const c = typeof x === "number" ? (x === y ? 0 : x < y ? -1 : 1) : x.localeCompare(y, "ko");
    return c * sign || i - j;
  }).map(p => p[0]);
}
function sortHead(label) {
  const th = el("th", { class: "sortable", title: "누르면 정렬해요", tabindex: "0", "aria-sort": S.sort && S.sort.key === label ? (S.sort.dir === "asc" ? "ascending" : "descending") : "none" }, label + (S.sort && S.sort.key === label ? (S.sort.dir === "asc" ? " ▲" : " ▼") : ""));
  th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); S.focusSort = label; th.click(); } });   // 키보드로도 정렬 (표가 다시 그려져도 포커스를 돌려준다)
  if (S.focusSort === label) { S.focusSort = null; setTimeout(() => th.focus(), 0); }
  th.addEventListener("click", () => {
    if (!S.sort || S.sort.key !== label) S.sort = { key: label, dir: "asc" };
    else if (S.sort.dir === "asc") S.sort = { key: label, dir: "desc" };
    else S.sort = null;
    render();
  });
  return th;
}
// 선택한 주문을 한꺼번에 처리하는 막대: 공급사에 연락함 기록, 사유 일괄 입력, CSV 저장
function pickedOrders() { return listed().filter(o => S.picked.has(NO(o))); }
function renderPickBar() {
  const bar = $("pickBar");
  const list = S.result ? pickedOrders() : [];
  S.picked = new Set(list.map(NO)); // 목록에서 사라진 주문은 선택에서 뺀다
  if (!list.length || S.view !== "list") { bar.hidden = true; bar.replaceChildren(); return; }
  const base = $("today").value || localToday();
  const sups = [...new Set(list.map(o => (o["공급사"] || "").trim()).filter(Boolean))];
  const status = el("span", { class: "sub" });
  const msg = (t, ok) => { status.className = "sub " + (ok ? "msg-ok" : "msg-err"); status.textContent = t; };

  const chSel = el("select", { "aria-label": "연락 채널" }); Escalate.CHANNELS.forEach(c => chSel.append(el("option", { value: c }, c)));
  const contactBtn = el("button", {}, "공급사 " + sups.length + "곳에 연락함 기록");
  contactBtn.disabled = !sups.length;
  contactBtn.addEventListener("click", () => {
    let added = 0, skipped = 0;
    sups.forEach(sup => {
      const log = S.contactLog[sup] = S.contactLog[sup] || [];
      if (log.some(e => e.date === base && e.kind === "attempt")) { skipped++; return; } // 오늘 이미 기록한 업체는 또 쌓지 않는다
      log.push({ date: base, kind: "attempt", channel: chSel.value, promised: "", note: "" });
      S.contacted[sup] = base; added++;
    });
    persist(); showSaved();
    msg(added + "곳에 오늘(" + base + ") 연락함을 기록했어요." + (skipped ? " (오늘 이미 기록한 " + skipped + "곳은 건너뛰었어요.)" : ""), true);
  });

  const infCh = channelSelect();
  const infBtn = el("button", {}, "연구원 안내함 기록");
  infBtn.addEventListener("click", () => {
    const n = recordInformed(list, infCh.value, "");
    render();
    const b = $("pickBar").querySelector(".sub"); if (b) { b.className = "sub msg-ok"; b.textContent = n + "건을 연구원 안내함으로 기록했어요." + (n < list.length ? " (오늘 같은 채널로 이미 기록한 " + (list.length - n) + "건은 건너뛰었어요.)" : ""); }
  });

  const reasonIn = el("input", { type: "text", placeholder: "사유 (예: 공급사 회신 대기)", maxlength: "120" });
  const reasonBtn = el("button", {}, "사유 적용");
  reasonBtn.addEventListener("click", () => {
    const t = reasonIn.value.trim();
    if (!t) { msg("적용할 사유를 적어 주세요.", false); return; }
    list.forEach(o => { S.reasons[NO(o)] = t; });
    persist(); const n = list.length; render();
    const b = $("pickBar").querySelector(".sub"); if (b) { b.className = "sub msg-ok"; b.textContent = n + "건에 사유를 적용했어요."; }
  });

  const csvBtn = el("button", {}, "선택한 " + list.length + "건 CSV 저장");
  csvBtn.addEventListener("click", async () => {
    msg("저장 위치를 고르세요…", true);
    const body = Report.toCsv(Report.EXC_HEAD, Report.exceptionRows(list, [], causeOf, reasonOf, S.contacted, informedLabel));
    const r = await window.app.saveFile({ name: "선택주문_" + base, text: body, ext: "csv" });
    if (!r) msg("저장을 취소했어요.", true); else msg(r.ok ? "저장했어요: " + r.path : r.error, r.ok);
  });

  const clear = el("button", { class: "quiet" }, "선택 해제");
  clear.addEventListener("click", () => { S.picked = new Set(); render(); });
  bar.replaceChildren(el("b", {}, "선택 " + list.length + "건"), clear, chSel, contactBtn, infCh, infBtn, reasonIn, reasonBtn, csvBtn, status);
  bar.hidden = false;
}

// 한 연구원의 지연·임박 주문을 한 통으로 묶은 안내문
function digestItems(name) {
  return listed().filter(o => requesterOf(o) === name).map(o => {
    const ed = S.edited[NO(o)];
    return { orderNo: NO(o), item: (o["품목명"] || "").trim(), status: o.status, daysLeft: o.daysLeft, due: o["납기일"], oldDue: ed ? ed.from : "", reason: reasonOf(o), partial: o.partial || null, schedule: S.schedule[NO(o)] || [] };
  });
}
function renderDigestBox() {
  const box = $("digestBox");
  const name = S.filter.requester;
  if (!S.digestOpen || !name || S.view !== "list") { box.hidden = true; return; }
  const items = digestItems(name);
  const ta = el("textarea", { rows: "14", "aria-label": "한 통 안내문" });
  ta.value = Notice.renderDigest(name === "(요청자 없음)" ? "" : name, items, S.notice.signature);
  const copy = el("button", { class: "primary" }, "복사");
  const close = el("button", { class: "quiet" }, "닫기"); close.addEventListener("click", () => { S.digestOpen = false; S.digestMsg = ""; renderDigestBox(); });
  // 보낸 뒤에 누르는 단추: 이 연구원의 지연·임박 주문 전부를 안내함으로 남긴다
  const orders = listed().filter(o => requesterOf(o) === name);
  const ch = channelSelect();
  const rec = el("button", {}, "이 " + orders.length + "건 안내함으로 기록");
  rec.addEventListener("click", () => {
    const n = recordInformed(orders, ch.value, "한 통 안내문");
    S.digestMsg = n + "건을 안내함으로 기록했어요." + (n < orders.length ? " (오늘 같은 채널로 이미 기록한 " + (orders.length - n) + "건은 건너뛰었어요.)" : "");
    render();
  });
  copy.addEventListener("click", () => copyText(ta.value, copy, () => nudgeRecord(rec)));   // 복사 직후 "이 N건 안내함으로 기록"으로 (FR-19)
  box.replaceChildren(el("div", { class: "drawerhead" }, el("h2", {}, name + "님께 한 통으로 안내 (" + items.length + "건)"), close), ta,
    el("div", { class: "row" }, copy, ch, rec, el("span", { class: "sub" }, S.digestMsg || "사유는 비고·이메일 추출에서 가져왔어요. 보내기 전에 확인하세요. 이 앱은 메시지를 보내지 않아요. 보낸 뒤에 '안내함으로 기록'을 눌러 두세요.")));
  box.hidden = false;
}

// 분석 표의 한 줄을 누르면 그 연구원·공급사의 주문만 목록으로 보여 준다
function pickRow(kind, name, tr) {
  tr.addEventListener("click", () => { S.filter = { [kind]: name }; S.selected = null; S.view = "list"; render(); });
  return tr;
}
// 누르면 그 사람(공급사)의 주문만 목록에 보여 주는 칸
function filterCell(kind, value) {
  const v = norm(value, kind === "requester" ? "(요청자 없음)" : "(공급사 없음)");
  const td = el("td", { class: "pick", title: "누르면 '" + v + "' 주문만 보여요" }, value ? el("button", { type: "button", class: "cellbtn", "data-rowctl": "1", tabindex: "-1" }, value) : "");
  td.addEventListener("click", e => { e.stopPropagation(); S.filter = { ...S.filter, [kind]: v }; S.selected = null; S.view = "list"; render(); });
  return td;
}

// info(선택): 아직 목록에 반영하지 않은 이메일 결과로 안내문을 미리 만들 때 쓴다 { oldDue, newDue, reason }
function noticeFor(o, template, alt, info) {
  const ed = info ? (info.newDue ? { from: info.oldDue, to: info.newDue } : null) : S.edited[NO(o)];
  return Notice.renderNotice(template, {
    researcher: (o["요청자"] || "").trim(), item: (o["품목명"] || "").trim(), orderNo: NO(o),
    due: ed ? ed.to : (info && info.newDue) || o["납기일"], daysLeft: o.daysLeft, oldDue: ed ? ed.from : info ? info.oldDue : o["납기일"], newDue: ed ? ed.to : "", daysLate: o.daysLeft < 0 && !ed ? -o.daysLeft : 0,
    reason: (info && info.reason) || reasonOf(o), alternative: alt, signature: S.notice.signature, partial: o.partial || null, schedule: S.schedule[NO(o)] || [],
  });
}

// 복사한 뒤 onCopied가 있으면 불러 준다 (복사가 실제로 됐을 때만).
async function copyText(text, btn, onCopied) {
  try { await navigator.clipboard.writeText(text); btn.textContent = "복사됨"; setTimeout(() => (btn.textContent = "복사"), 1500); if (onCopied) onCopied(); }
  catch (e) { btn.textContent = "복사가 막혀 있어요. 직접 선택해 주세요"; }
}

// 안내문을 복사한 직후: 보낸 뒤 누를 "안내함으로 기록" 버튼을 눈에 띄게 하고 포커스를 옮긴다 (FR-19).
// 자동으로 기록하지는 않는다: 앱은 실제로 보냈는지 모른다. 기록하지 않고 다른 주문으로 넘어가도 막지 않는다.
function nudgeRecord(btn, hint) {
  if (!btn || !btn.isConnected) return;
  btn.classList.add("nudge");
  if (hint && !hint.textContent) hint.textContent = "복사했어요. 안내문을 보낸 뒤 눌러 두세요.";
  btn.focus();
}

function templateControls(onChange, o) {
  const tpl = el("select", {});
  Notice.TEMPLATES.forEach(t => tpl.append(el("option", { value: t }, t)));
  tpl.value = o && o.status === "임박" && S.notice.template === "사과형" ? "임박 사전 안내" : o && o.status === "확인필요" && S.notice.template === "사과형" ? "공지형" : S.notice.template; // 아직 늦지 않은 주문은 사과형 대신 사전 안내를 먼저 보여 준다
  const alt = el("textarea", { rows: "2", placeholder: "대안 내용을 직접 입력하세요 (예: 대체품 문의 가능, 납기 단축 요청 가능)" });
  alt.value = S.notice.alt;
  const altWrap = el("label", {}, "대안 (대안 제시형에만 들어가요)", alt);
  const sync = () => { altWrap.hidden = tpl.value !== "대안 제시형"; };
  const sig = el("textarea", { rows: "2", placeholder: "예: 구매팀 홍길동 드림 (한 번 적어 두면 모든 안내문 끝에 붙어요)" });
  sig.value = S.notice.signature || "";
  tpl.addEventListener("change", () => { S.notice.template = tpl.value; sync(); onChange(); persist(); });
  alt.addEventListener("input", () => { S.notice.alt = alt.value; onChange(); persist(); });
  sig.addEventListener("input", () => { S.notice.signature = sig.value; onChange(); persist(); });
  sync();
  const ctl = [el("label", {}, "템플릿", tpl), altWrap, el("label", {}, "서명 (보내는 사람 이름·소속)", sig)];
  ctl.tpl = tpl;
  return ctl;
}

function noticeBox(o, info) {
  const out = el("textarea", { rows: "10" });
  const copyBtn = el("button", {}, "복사");
  let ctl;
  const refresh = () => { out.value = noticeFor(o, ctl ? ctl.tpl.value : S.notice.template, S.notice.alt, info); };
  ctl = templateControls(refresh, o);
  const nudge = el("span", { class: "sub nudgehint", "aria-live": "polite" });
  copyBtn.addEventListener("click", () => copyText(out.value, copyBtn, () => {
    const rec = [...$("detail").querySelectorAll('[data-screen-id="LS-31-A"] button')].find(b => b.textContent.trim() === "안내함으로 기록");
    nudgeRecord(rec, nudge);
  }));
  refresh();
  return el("div", { class: "noticebox", "data-screen-id": "LS-32-A" }, el("h3", {}, "안내문 만들기"), ...ctl,
    el("label", {}, "안내문 (고쳐 쓸 수 있어요)", out), el("div", { class: "row" }, copyBtn, nudge),
    el("p", { class: "sub" }, "사유는 이메일 추출이나 비고 열에서 가져왔어요. 보내기 전에 확인하세요. 이 앱은 메시지를 보내지 않아요."));
}

function causeBox(o) {
  const sel = el("select", {});
  sel.append(el("option", { value: "" }, "자동 (규칙)"));
  Cause.CATEGORIES.forEach(c => sel.append(el("option", { value: c }, c)));
  sel.value = S.causeOverride[NO(o)] || "";
  sel.addEventListener("change", () => { if (sel.value) S.causeOverride[NO(o)] = sel.value; else delete S.causeOverride[NO(o)]; persist(); render(); });
  return el("div", { class: "causebox", "data-screen-id": "LS-34-A" }, el("label", {}, "지연 원인", sel),
    el("p", { class: "sub" }, "현재: " + causeOf(o) + " (" + (S.causeOverride[NO(o)] ? "직접 지정" : "규칙") + ") · 사유 글: " + (reasonOf(o) || "없음")));
}

function atable(headers, rows) {
  const t = el("table", { class: "atable" });
  t.append(el("thead", {}, el("tr", {}, ...headers.map((h, i) => el("th", { class: i > 0 && h.n ? "n" : "" }, h.t)))));
  const tb = el("tbody", {});
  rows.forEach(r => tb.append(r));
  t.append(tb);
  return el("div", { style: "overflow:auto" }, t);
}

function bulkBox(d) {
  const mine = d.filter(o => requesterOf(o) === S.bulk);
  const wrap = el("div", { class: "apanel noticebox", "data-screen-id": "AN-22-A", style: "border-top:0;margin-top:0" }, el("h3", {}, S.bulk + "님의 지연 " + mine.length + "건 안내문"));
  const list = el("div", { class: "emailres" });
  const fill = () => {
    list.replaceChildren();
    mine.forEach(o => {
      const ta = el("textarea", { rows: "8", "aria-label": "안내문" }); ta.value = noticeFor(o, S.notice.template, S.notice.alt);
      const b = el("button", {}, "복사"); b.addEventListener("click", () => copyText(ta.value, b));
      list.append(el("div", { class: "nblock" }, el("b", {}, NO(o) + " " + (o["품목명"] || "")), ta, el("div", { class: "row" }, b)));
    });
  };
  fill();
  wrap.append(...templateControls(fill), list, el("p", { class: "sub" }, "사유는 이메일 추출이나 비고 열에서 가져왔어요. 보내기 전에 확인하세요. 이 앱은 메시지를 보내지 않아요."));
  const close = el("button", { class: "quiet" }, "닫기"); close.addEventListener("click", () => { S.bulk = null; renderAnalysis(); });
  wrap.append(el("div", { class: "row" }, close));
  return wrap;
}

// ---- 오늘 연락할 곳 ----
function daysBetween(fromISO, toISO) { const a = Judge.parseDate(fromISO), b = Judge.parseDate(toISO); return a && b ? Math.round((b - a) / 86400000) : 0; }

// "오늘 연락할 곳" 묶음 계산. 연락 탭과 홈(HM-23-A)이 같은 결과를 보도록 한 곳에 둔다. 기준일에 이미 연락·기록한 곳은 finished로 나뉜다.
function contactPlanNow(base) {
  const bonus = {};
  Object.keys(S.contactLog).forEach(sup => { const s = Escalate.status(S.contactLog[sup], base, true); bonus[sup] = Math.min(s.attempts, 3) * 4 + (s.promiseBroken ? 6 : 0); });
  const groups = Contact.plan({ exceptions: S.result.exceptions, needCheck: S.result.needCheck, noReply: S.supRes ? S.supRes.noReply : [], causeOf, bonus });
  const done = g => S.contacted[g.supplier] === base;
  return { groups, pending: groups.filter(g => !done(g)), finished: groups.filter(done) };
}

function renderContact() {
  const box = $("contactView");
  const base = $("today").value || localToday();
  const sig = S.notice.signature;
  // 연락해도 답이 없는 업체는 위로 올린다 (무응답 1회당 +4, 최대 +12 / 들은 날짜가 지났으면 +6)
  const bonus = {};
  Object.keys(S.contactLog).forEach(sup => { const s = Escalate.status(S.contactLog[sup], base, true); bonus[sup] = Math.min(s.attempts, 3) * 4 + (s.promiseBroken ? 6 : 0); });
  const groups = Contact.plan({ exceptions: S.result.exceptions, needCheck: S.result.needCheck, noReply: S.supRes ? S.supRes.noReply : [], causeOf, bonus });
  const done = g => S.contacted[g.supplier] === base;               // 기준일에 이미 연락·기록함
  const pending = groups.filter(g => !done(g)), finished = groups.filter(done);
  const sum = k => pending.reduce((n, g) => n + g.counts[k], 0);
  const silent = pending.filter(g => Escalate.status(S.contactLog[g.supplier] || [], base, true).attempts > 0).length;
  const parts = [];

  parts.push(el("div", { class: "apanel" },
    el("div", { class: "sumline" },
      el("div", {}, el("b", {}, pending.length + "곳"), el("span", {}, "연락할 공급사")),
      el("div", {}, el("b", {}, String(pending.reduce((n, g) => n + g.orders.length, 0)) + "건"), el("span", {}, "관련 주문")),
      el("div", {}, el("b", {}, String(sum("지연"))), el("span", {}, "지연")), el("div", {}, el("b", {}, String(sum("임박"))), el("span", {}, "임박")),
      el("div", {}, el("b", {}, String(sum("미회신") + sum("확인필요"))), el("span", {}, "미회신·확인 필요")),
      el("div", {}, el("b", {}, silent + "곳"), el("span", {}, "무응답 중"))),
    el("p", { class: "sub" }, "급한 순서(지연이 오래될수록, 임박이 가까울수록, 연락해도 답이 없을수록)로 정렬했어요. 기준일 " + base + "." +
      (S.supRes && S.supRes.noReply.length ? " 공급사 엑셀 비교의 미회신 " + S.supRes.noReply.length + "건도 포함했어요." : " 공급사 엑셀을 비교하면 미회신도 여기에 모여요."))));

  if (!groups.length) parts.push(el("div", { class: "apanel" }, el("p", { class: "sub" }, "지금 기준으로 연락할 곳이 없어요.")));

  const LEVEL = ["", "재연락", "전화 권장", "연구원 알림·상급자", "대체 검토"];
  const syncContacted = sup => { const l = S.contactLog[sup] || []; if (l.some(e => e.date === base)) S.contacted[sup] = base; else delete S.contacted[sup]; };
  const addLog = (sup, entry) => { (S.contactLog[sup] = S.contactLog[sup] || []).push(entry); S.contacted[sup] = base; persist(); renderContact(); };
  const undo = (sup, onlyToday) => {
    const l = S.contactLog[sup] || [];
    if (onlyToday) S.contactLog[sup] = l.filter(e => e.date !== base); else l.pop();
    if (!(S.contactLog[sup] || []).length) delete S.contactLog[sup];
    syncContacted(sup); persist(); renderContact();
  };

  const card = (g, isDone) => {
    const log = S.contactLog[g.supplier] || [];
    const st = Escalate.status(log, base, true);
    const chips = el("div", { class: "sumchips" },
      ...[["지연", "c-changed"], ["임박", "c-noreply"], ["확인필요", "c-vague"], ["미회신", "c-vague"]].filter(([k]) => g.counts[k]).map(([k, c]) => el("span", { class: "chip " + c }, (k === "확인필요" ? "확인 필요" : k) + " " + g.counts[k])),
      ...(st.level ? [el("span", { class: "chip c-changed" }, "무응답 단계: " + LEVEL[st.level])] : []));
    const table = atableOf(["상태", "주문번호", "품목", "납기", "경과·남음", "원인·회신"], g.orders.map(o => el("tr", {},
      el("td", {}, el("span", { class: "badge " + (o.status === "지연" ? "late" : o.status === "임박" ? "soon" : "warn") }, o.status === "확인필요" ? "확인 필요" : o.status)),
      el("td", {}, o.orderNo), el("td", {}, o.item), el("td", {}, o.due || "(비어 있음)"),
      el("td", { class: "num" }, o.status === "지연" ? "D+" + o.days : o.status === "임박" ? (o.days === 0 ? "D-day" : "D-" + o.days) : "-"),
      el("td", {}, [o.cause && o.cause !== "기타·미확인" ? o.cause : "", o.noReply ? (o.reply ? "회신: " + o.reply : "회신 미확인") : "", substOpen(o.orderNo) ? SUBST_SHORT[S.subst[o.orderNo].state] : ""].filter(Boolean).join(" · ")))));

    const status = el("div", { class: "sub" }, el("b", {}, st.headline),
      ...(!isDone ? [el("ul", {}, ...st.suggestions.map(s => el("li", {}, s.text)))] : []));

    // 문구 만들기 (연락 단계에 맞는 것은 강조)
    const msgBox = el("div", {}); msgBox.hidden = true;
    const block = (label, text) => {
      const ta = el("textarea", { rows: "11", "aria-label": "메시지 문구" }); ta.value = text;
      const cp = el("button", {}, "복사"); cp.addEventListener("click", () => copyText(ta.value, cp));
      return el("div", { class: "nblock" }, el("b", {}, label), ta, el("div", { class: "row" }, cp));
    };
    const headsUp = () => {
      const by = new Map();
      g.orders.filter(o => o.status === "지연" || o.status === "임박").forEach(o => { const k = o.requester || ""; if (!by.has(k)) by.set(k, []); by.get(k).push(o); });
      if (!by.size) return [el("p", { class: "sub" }, "지연·임박 주문이 없어 연구원에게 알릴 내용이 없어요.")];
      return [...by.entries()].map(([req, list]) => block((req || "담당 연구원") + "님께", Reask.renderHeadsUp(req, g.supplier, list, st, sig)));
    };
    const MSGS = [
      ["mail", "메일 문의 문구", () => [block("공급사에 보내는 메일", Reask.renderFollowUp(g.supplier, g.orders, sig))]],
      ["chat", "카톡·문자 짧은 문구", () => [block("카톡·문자", Reask.renderChat(g.supplier, g.orders, sig))]],
      ["headsup", "연구원 사전 안내", headsUp],
      ["boss", "상급자 보고·대체 검토", () => [block("상급자 보고", Reask.renderEscalation(g.supplier, g.orders, st, sig))]],
    ];
    const suggested = new Set(st.suggestions.map(s => s.key));
    let open = null;
    const msgRow = el("div", { class: "row" }, ...MSGS.map(([key, label, make]) => {
      const b = el("button", { class: suggested.has(key) ? "primary" : "quiet" }, label);
      b.addEventListener("click", () => {
        if (open === key) { open = null; msgBox.hidden = true; msgBox.replaceChildren(); return; }
        open = key; msgBox.replaceChildren(...make()); msgBox.hidden = false;
      });
      return b;
    }));

    // 연락 기록
    const chSel = el("select", { "aria-label": "연락 채널" }); Escalate.CHANNELS.forEach(c => chSel.append(el("option", { value: c }, c)));
    const dateIn = el("input", { type: "date", "aria-label": "연락한 날짜" }); dateIn.value = base;
    const saveProm = el("button", {}, "저장");
    saveProm.addEventListener("click", () => { if (dateIn.value) addLog(g.supplier, { date: base, kind: "reply", channel: chSel.value, promised: dateIn.value, note: "" }); });
    const promRow = el("div", { class: "row" }, el("span", { class: "sub" }, "들은 날짜"), dateIn, saveProm);
    promRow.hidden = true;
    const tryBtn = el("button", {}, "연락함");
    tryBtn.addEventListener("click", () => addLog(g.supplier, { date: base, kind: "attempt", channel: chSel.value, promised: "", note: "" }));
    const replyBtn = el("button", { class: "quiet" }, "답변 받음");
    replyBtn.addEventListener("click", () => addLog(g.supplier, { date: base, kind: "reply", channel: chSel.value, promised: "", note: "" }));
    const promBtn = el("button", { class: "quiet" }, "구두로 날짜 들음");
    promBtn.addEventListener("click", () => { promRow.hidden = !promRow.hidden; });
    const recRow = el("div", { class: "row" }, el("span", { class: "sub" }, "방금 한 일 기록:"), chSel, tryBtn, replyBtn, promBtn);

    // 기록 목록
    let histBox = null;
    if (log.length) {
      const u = el("button", { class: "quiet" }, isDone ? "오늘 기록 취소" : "마지막 기록 취소");
      u.addEventListener("click", () => undo(g.supplier, isDone));
      histBox = el("details", { class: "sentbox" }, el("summary", {}, "연락 기록 " + log.length + "건"),
        ...log.slice().reverse().map(e => el("p", { class: "sub" }, e.date + " · " + e.channel + " · " + (e.kind === "attempt" ? "연락함" : e.promised ? "날짜 들음: " + e.promised : "답변 받음"))), u);
    }

    return el("div", { class: "apanel" + (isDone ? " muted" : "") },
      el("div", { class: "secthead" }, el("h3", {}, g.supplier), chips), status, table,
      ...(isDone ? [] : [msgRow, msgBox, recRow, promRow]), ...(histBox ? [histBox] : []));
  };
  pending.forEach(g => parts.push(card(g, false)));
  if (finished.length) {
    parts.push(el("div", { class: "secthead" }, el("h3", {}, "오늘 연락한 곳 " + finished.length + "곳")));
    finished.forEach(g => parts.push(card(g, true)));
  }
  box.replaceChildren(...parts);
}

// ---- 보고서·내보내기 ----
function renderReport() {
  const box = $("reportView");
  const base = $("today").value || localToday();
  const delay = Analyze.summarize(delayedList(), causeOf);
  const groups = Contact.plan({ exceptions: S.result.exceptions, needCheck: S.result.needCheck, noReply: S.supRes ? S.supRes.noReply : [], causeOf });
  const contacted = groups.filter(g => S.contacted[g.supplier] === base).length;
  const text = Report.buildReport({ base, fileName: S.name, total: S.rows.length, counts: S.result.counts, delay, groups, contacted, editedCount: Object.keys(S.edited).length, informed: informedSummary(listed()) });
  const status = el("p", { class: "sub" });

  async function save(name, body, ext) {
    status.className = "sub"; status.textContent = "저장 위치를 고르세요…";
    const r = await window.app.saveFile({ name, text: body, ext });
    if (!r) { status.textContent = "저장을 취소했어요."; return; }
    status.className = "sub " + (r.ok ? "msg-ok" : "msg-err");
    status.textContent = r.ok ? "저장했어요: " + r.path : r.error;
  }
  const ta = el("textarea", { rows: "22", "aria-label": "보고 문구" }); ta.value = text;
  const copy = el("button", { class: "primary" }, "보고 문구 복사"); copy.addEventListener("click", () => copyText(ta.value, copy));
  const saveTxt = el("button", {}, "보고 문구 저장 (.txt)"); saveTxt.addEventListener("click", () => save("납기보고_" + base, ta.value, "txt"));
  const saveExc = el("button", {}, "예외 목록 CSV 저장");
  saveExc.addEventListener("click", () => save("예외목록_" + base, Report.toCsv(Report.EXC_HEAD, Report.exceptionRows(S.result.exceptions, S.result.needCheck, causeOf, reasonOf, S.contacted, informedLabel)), "csv"));
  const saveCon = el("button", {}, "연락할 곳 CSV 저장");
  saveCon.addEventListener("click", () => save("연락할곳_" + base, Report.toCsv(Report.CONTACT_HEAD, Report.contactRows(groups, S.contacted)), "csv"));

  box.replaceChildren(
    el("div", { class: "apanel", "data-screen-id": "RP-21-A" }, el("h3", {}, "보고 문구 (고쳐 쓴 뒤 복사하세요)"), ta,
      el("div", { class: "row" }, copy, saveTxt),
      el("p", { class: "sub" }, "숫자는 지금 화면의 데이터에서 자동으로 만들었어요. 보내기 전에 내용을 확인하세요. 이 앱은 메시지를 보내지 않아요.")),
    el("div", { class: "apanel", "data-screen-id": "RP-22-A" }, el("h3", {}, "파일로 저장 (엑셀에서 바로 열려요)"),
      el("div", { class: "row" }, saveExc, saveCon), status,
      el("p", { class: "sub" }, "예외 목록: 지연·임박·확인 필요 주문 전체(남은 일수, 공급사, 요청자, 지연 원인, 사유, 연락일). 연락할 곳: 공급사 순위별 주문. 공급사가 보낸 글에 =, +, -, @로 시작하는 칸이 있으면 엑셀이 수식으로 실행하지 않도록 앞에 '를 붙여 저장해요.")));
}

function renderAnalysis() {
  const box = $("analysis");
  const d = delayedList();
  if (!d.length) { box.replaceChildren(el("div", { class: "apanel" }, el("p", { class: "sub" }, "지금 기준으로 지연된 주문이 없어서 분석할 내용이 없어요."))); return; }
  const s = Analyze.summarize(d, causeOf);
  const panels = [];
  panels.push(el("div", { class: "apanel", "data-screen-id": "AN-21-A" }, el("div", { class: "sumline" },
    el("div", {}, el("b", {}, s.total + "건"), el("span", {}, "지연")), el("div", {}, el("b", {}, s.avgDays + "일"), el("span", {}, "평균 지연")), el("div", {}, el("b", {}, s.maxDays + "일"), el("span", {}, "가장 오래 지연")))));

  const max = Math.max(...s.byCause.map(c => c.count));
  const misc = (s.byCause.find(c => c.name === Cause.FALLBACK) || { count: 0 }).count;
  const cp = el("div", { class: "apanel", "data-screen-id": "AN-21-A" }, el("h3", {}, "원인별 건수 (막대를 누르면 해당 주문만 목록에 보여요)"));
  s.byCause.forEach(c => {
    const row = el("div", { class: "barrow" }, el("span", {}, c.name), el("div", { class: "track" }, el("div", { class: "fill" + (c.name === Cause.FALLBACK ? " misc" : ""), style: "width:" + Math.round((c.count / max) * 100) + "%" })), el("span", { class: "cnt" }, c.count + "건"));
    row.addEventListener("click", () => { S.filter = { cause: c.name }; S.view = "list"; render(); });
    cp.append(row);
  });
  if (misc / s.total >= 0.5) cp.append(el("p", { class: "warnline2" }, "기타·미확인이 " + Math.round((misc / s.total) * 100) + "%예요. 사유 글이 없거나 규칙이 못 알아보는 표현이 많다는 뜻이라, 원인 비중으로 믿기 어려워요. 주문 상세에서 원인을 직접 지정하거나 사유를 채워 주세요."));
  panels.push(cp);

  const sp = el("div", { class: "apanel", "data-screen-id": "AN-21-A" }, el("h3", {}, "공급사별 지연"));
  if (!S.mapping["공급사"]) sp.append(el("p", { class: "sub" }, "공급사 열이 연결되어 있지 않아 표시하지 않아요."));
  else sp.append(atable([{ t: "공급사" }, { t: "지연 건수", n: 1 }, { t: "평균 지연(일)", n: 1 }, { t: "최장(일)", n: 1 }],
    s.bySupplier.map(g => pickRow("supplier", g.name, el("tr", { class: "pickrow", title: "누르면 이 공급사 주문만 목록에 보여요" }, el("td", {}, g.name), el("td", { class: "n" }, g.count), el("td", { class: "n" }, g.avg), el("td", { class: "n" }, g.max))))));
  panels.push(sp);

  const rp = el("div", { class: "apanel", "data-screen-id": "AN-21-A" }, el("h3", {}, "연구원별 영향"));
  if (!S.mapping["요청자"]) rp.append(el("p", { class: "sub" }, "요청자 열이 연결되어 있지 않아 표시하지 않아요."));
  else rp.append(atable([{ t: "연구원" }, { t: "지연 건수", n: 1 }, { t: "가장 오래(일)", n: 1 }, { t: "" }],
    s.byRequester.map(g => {
      const b = el("button", { class: "quiet" }, "안내문 만들기");
      b.addEventListener("click", e => { e.stopPropagation(); S.bulk = g.name; renderAnalysis(); });
      return pickRow("requester", g.name, el("tr", { class: "pickrow", title: "누르면 이 연구원 주문만 목록에 보여요" }, el("td", {}, g.name), el("td", { class: "n" }, g.count), el("td", { class: "n" }, g.max), el("td", {}, b)));
    })));
  panels.push(rp);
  if (S.bulk) panels.push(bulkBox(d));
  box.replaceChildren(...panels);
}

function render() {
  const r = S.result;
  $("empty").hidden = true; $("result").hidden = false; $("mapBtn").hidden = false; $("mainTabs").hidden = false;
  $("fileName").textContent = S.name + " · 전체 " + S.rows.length + "건";
  $("nLate").textContent = r.counts.지연; $("nSoon").textContent = r.counts.임박; $("nOk").textContent = r.counts.정상;
  $("nDone").textContent = r.counts.입고완료; $("nCheck").textContent = r.counts.확인필요;

  const notice = $("notice");
  const msgs = [];
  if (!S.mapping["입고여부"] && !(S.mapping["주문수량"] && S.mapping["입고수량"])) msgs.push("입고 상태(또는 주문·입고 수량) 열이 없어서 모든 주문을 미입고로 봤어요.");
  const substN = Object.keys(S.subst).filter(no => substOpen(no) && S.rows.some(row => row[S.mapping["주문번호"]] === no)).length;
  if (substN) msgs.push("대체품 확인이 끝나지 않은 주문이 " + substN + "건 있어요 (승인 전에는 받아들이지 마세요).");
  if (r.counts.부분입고) msgs.push("부분 입고 중인 주문이 " + r.counts.부분입고 + "건 있어요. 입고 완료로 빼지 않고 남은 수량 기준으로 판정했어요.");
  if (S.savedNote) msgs.push(S.savedNote);
  if (r.needCheck.length) msgs.push("납기일을 읽을 수 없는 주문이 " + r.needCheck.length + "건 있어요: " + r.needCheck.slice(0, 5).map(o => o["주문번호"]).join(", ") + (r.needCheck.length > 5 ? " 외" : "") + ". 표 맨 아래에 '확인 필요'로 보여요.");
  notice.textContent = msgs.join(" "); notice.hidden = !msgs.length;

  const cols = TABLE_COLS.filter(c => S.mapping[c]);
  const allBox = el("input", { type: "checkbox", title: "지금 보이는 주문 모두 선택", "aria-label": "지금 보이는 주문 모두 선택" });
  const head = el("tr", {}, el("th", { class: "chk" }, allBox), sortHead("상태"), sortHead("남은 일수"), sortHead("안내"));
  cols.forEach(c => head.append(sortHead(c)));
  $("thead").replaceChildren(head);

  const body = $("tbody");
  body.replaceChildren();
  const shown = visible();
  shown.forEach(o => {
    const cb = el("input", { type: "checkbox", "aria-label": NO(o) + " 선택", "data-rowctl": "1", tabindex: "-1" });
    cb.checked = S.picked.has(NO(o));
    cb.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", () => { if (cb.checked) S.picked.add(NO(o)); else S.picked.delete(NO(o)); renderPickBar(); syncAll(); });
    const tr = el("tr", { class: S.selected === o["주문번호"] ? "sel" : "", tabindex: "-1", "data-no": o["주문번호"], ...(S.selected === o["주문번호"] ? { "aria-current": "true" } : {}) }, el("td", { class: "chk" }, cb), el("td", {}, badge(o.status), ...(o.partial ? [" ", partialBadge(o)] : []), ...(substOpen(o["주문번호"]) ? [" ", substBadge(o["주문번호"])] : [])), el("td", { class: "num" }, daysText(o)), el("td", {}, informedBadge(o), ...(QuickNote.count(S.quickNotes, NO(o)) ? [" ", memoBadge(o)] : [])));
    cols.forEach(c => tr.append(c === "요청자" ? filterCell("requester", o[c]) : c === "공급사" ? filterCell("supplier", o[c]) : el("td", {}, o[c] || "")));
    tr.addEventListener("click", () => { S.selected = o["주문번호"]; S.scrollDetail = true; render(); });
    tr.addEventListener("keydown", e => rowKey(e, tr, o, cb));
    body.append(tr);
  });
  const act = body.querySelector("tr.sel") || body.firstElementChild;                  // 키보드로는 한 줄만 탭 정지 지점으로 둔다 (38줄을 일일이 탭하지 않게)
  if (act) activateRow(act);
  const syncAll = () => { const n = shown.filter(o => S.picked.has(NO(o))).length; allBox.checked = shown.length > 0 && n === shown.length; allBox.indeterminate = n > 0 && n < shown.length; };
  allBox.addEventListener("change", () => { shown.forEach(o => { if (allBox.checked) S.picked.add(NO(o)); else S.picked.delete(NO(o)); }); render(); });
  syncAll(); renderPickBar();
  $("noExc").hidden = shown.length > 0;
  $("noExc").textContent = S.onlyNeed ? "안내가 필요한 주문이 없어요." : hasFilter() || S.q.trim() ? "이 조건에 맞는 지연·임박 주문이 없어요." : "지금 기준으로 임박·지연된 주문이 없어요.";
  $("listTools").hidden = S.view !== "list";
  $("qInfo").textContent = S.q.trim() ? "검색 결과 " + shown.length + "건 (지연·임박 주문 안에서 찾아요)" : "";
  const chip = $("filterChip");
  if (hasFilter()) {
    const x = el("button", { class: "quiet" }, "필터 해제");
    x.addEventListener("click", () => { S.filter = {}; S.digestOpen = false; render(); });
    const nLate = shown.filter(o => o.status === "지연").length, nSoon = shown.filter(o => o.status === "임박").length, nCheck = shown.filter(o => o.status === "확인필요").length;
    const who = [S.filter.requester && "연구원 " + S.filter.requester, S.filter.supplier && "공급사 " + S.filter.supplier, S.filter.cause && "원인 " + S.filter.cause].filter(Boolean).join(" · ");
    const parts = [el("span", { class: "chip" }, who + " · 지연 " + nLate + "건" + (S.filter.cause ? "" : ", 임박 " + nSoon + "건" + (nCheck ? ", 확인 필요 " + nCheck + "건" : ""))), x];
    if (S.filter.requester && !S.filter.cause && !S.filter.supplier && shown.length) {
      const dg = el("button", { class: "primary" }, S.digestOpen ? "안내문 닫기" : "이 연구원에게 한 통 안내문");
      dg.addEventListener("click", () => { S.digestOpen = !S.digestOpen; render(); });
      parts.push(dg);
    }
    chip.replaceChildren(...parts);
  }
  chip.hidden = !hasFilter() || S.view !== "list";
  renderInformBar(); renderDigestBox(); renderAsk();
  $("homeView").hidden = S.view !== "home"; $("listView").hidden = S.view !== "list"; $("analysis").hidden = S.view !== "ana"; $("contactView").hidden = S.view !== "contact"; $("reportView").hidden = S.view !== "report";
  $("tabHome").classList.toggle("on", S.view === "home"); $("tabList").classList.toggle("on", S.view === "list"); $("tabAna").classList.toggle("on", S.view === "ana"); $("tabContact").classList.toggle("on", S.view === "contact"); $("tabReport").classList.toggle("on", S.view === "report");
  ["tabHome", "tabList", "tabAna", "tabContact", "tabReport"].forEach(id => $(id).setAttribute("aria-selected", String($(id).classList.contains("on"))));   // 스크린리더가 지금 어느 탭인지 알게
  if (S.view === "home") renderHome();
  if (S.view === "ana") renderAnalysis();
  if (S.view === "contact") renderContact();
  if (S.view === "report") renderReport();
  renderDetail();
}

// ---- 홈: 오늘 할 일 (HM-11-T, FR-20·26, CUJ-6) ----
// 안내할 것 · 회신 늦음 · 오늘 연락할 곳 세 묶음의 건수와 상위 3건. 항목을 누르면 그 주문(또는 연락 탭)으로 간다. 계산은 src/home.js·replies.js·contact.js.
// 회신을 주문 목록 끝에 붙이고 주문당 상한을 넘으면 오래된 것부터 버린다 (저장소의 상한과 같은 값)
function addReply(no, reply) {
  S.replies[no] = [...(S.replies[no] || []), reply].slice(-Persist.REPLIES_MAX);
}
function replyItems(orders = S.result.all) {
  return orders.map(o => ({ no: NO(o), supplier: supplierOf(o), replies: repliesOf(o), received: o.status === "입고완료", contactedOn: S.contacted[supplierOf(o)] || "" }));
}
function goOrder(no) { S.filter = {}; S.q = ""; $("q").value = ""; S.view = "list"; S.selected = no; S.focusDetail = true; render(); }
function homeCard(id, title, big, sub, items, more) {
  return el("div", { class: "homecard", "data-screen-id": id }, el("h3", {}, title), el("p", { class: "homebig" }, big), el("p", { class: "sub" }, sub),
    ...(items.length ? [el("ul", { class: "homelist" }, ...items)] : []), ...(more ? [more] : []));
}
function orderLink(no, text) { const b = el("button", { type: "button", class: "link" }, text); b.addEventListener("click", () => goOrder(no)); return el("li", {}, b); }
function renderHome() {
  const box = $("homeView"), base = baseDay();
  const inform = Home.informList(S.result.all, informedOf);
  const late = Replies.lateOrders(replyItems(), base);
  const contact = contactPlanNow(base).pending;
  const sm = Home.summarize({ inform, late, contact });
  const records = Object.keys(S.informed).length + Object.keys(S.quickNotes).length + Object.keys(S.replies).length;
  const guide = Home.startSteps({ hasFile: true, opened: !!S.opened, records });
  const parts = [el("h2", {}, "오늘 할 일"), el("p", { class: "sub" }, "기준일 " + base + ". 안내할 것, 공급사 회신이 늦은 것, 오늘 연락할 곳을 모았어요.")];

  if (guide.show) {                                                           // 처음 시작 안내 (HM-24-A): 끝낸 단계는 흐리게 접는다
    parts.push(el("div", { class: "startguide", "data-screen-id": "HM-24-A" }, el("h3", {}, "처음이라면 이 순서로 해 보세요"),
      el("ol", {}, ...guide.steps.map(st => el("li", { class: st.done ? "done" : st.n === guide.current ? "now" : "" }, (st.done ? "✓ " : "") + st.n + ". " + st.title + (st.n === guide.current ? " ← 지금 할 차례" : ""))))));
  }
  if (sm.empty) parts.push(el("p", { class: "homeempty" }, "지금 할 일이 없어요. 새 주문 파일을 열거나 내일 다시 확인하세요."));

  const toList = el("button", { type: "button", class: "link" }, "예외 목록에서 보기"); toList.addEventListener("click", () => { S.filter = {}; S.view = "list"; render(); });
  const toContact = el("button", { type: "button", class: "link" }, "오늘 연락할 곳 탭 열기"); toContact.addEventListener("click", () => { S.view = "contact"; render(); });
  const lateSub = sm.late.total ? "약속일이 지났는데 새 회신이 없어요." + (sm.late.quiet ? " (오늘 공급사에 연락한 " + sm.late.quiet + "건은 조용히 둬요)" : "") : sm.late.quiet ? "오늘 공급사에 연락한 " + sm.late.quiet + "건은 조용히 둬요." : "약속일이 지난 채 회신이 없는 주문이 없어요.";
  parts.push(el("div", { class: "homegrid" },
    homeCard("HM-21-A", "안내할 것", sm.inform.total + "건", "미안내 " + sm.inform.fresh + " · 다시 안내 " + sm.inform.again,
      sm.inform.top.map(x => orderLink(x.no, x.no + " · " + x.product + " · " + Labels.status(x.status) + (x.again ? " (다시 안내)" : ""))), sm.inform.total ? toList : null),
    homeCard("HM-22-A", "회신 늦음", sm.late.total + "건", lateSub,
      sm.late.top.map(x => orderLink(x.no, x.no + " · " + (x.supplier || "공급사 미상") + " · " + x.daysLate + "일째")), null),
    homeCard("HM-23-A", "오늘 연락할 곳", sm.contact.total + "곳", "관련 주문 " + sm.contact.orders + "건",
      sm.contact.top.map(g => el("li", {}, g.supplier + " · " + g.orders + "건")), sm.contact.total ? toContact : null)));
  box.replaceChildren(...parts);
}

// ---- 대체품 확인·분납 일정 ----
const SUBST_LABEL = { 의심: "대체품 의심", 확인요청중: "연구원 확인 요청 중", 승인: "승인됨", 거절: "거절됨" };
const SUBST_SHORT = { 의심: "대체품 의심", 확인요청중: "대체품 확인 중", 승인: "", 거절: "대체품 거절" };
const substOf = no => S.subst[no] || null;
const substOpen = no => !!S.subst[no] && S.subst[no].state !== "승인";
function substBadge(no) { return el("span", { class: "badge late" }, SUBST_SHORT[S.subst[no].state]); }
function setSubst(no, patch) {
  const prev = S.subst[no] || {};
  S.subst[no] = { state: "의심", note: "", supItem: "", supSpec: "", supQty: "", source: "직접", date: $("today").value || localToday(), ...prev, ...patch };
}
// 항목별 비교 줄: 주문(목록)의 값과 공급사 회신의 값
function substRows(o) {
  const no = NO(o), s = S.subst[no] || {};
  const row = S.rows.find(r => r[S.mapping["주문번호"]] === no) || {};
  const get = f => (S.mapping[f] ? String(row[S.mapping[f]] || "") : "");
  const num = v => Number(String(v).replace(/,/g, ""));
  const rows = [{ label: "품목명", list: get("품목명"), sup: s.supItem || "" }, { label: "규격", list: get("규격"), sup: s.supSpec || "" }, { label: "수량", list: get("주문수량"), sup: s.supQty || "" }];
  rows.forEach(r => { r.differs = r.label === "수량" ? !!(r.list && r.sup && num(r.list) !== num(r.sup)) : Supplier.differs(r.list, r.sup); });
  return rows;
}
function schedBlock(o) {
  return el("div", { class: "causebox", "data-screen-id": "LS-36-A" }, el("h3", {}, "분납 일정"),
    el("ul", {}, ...S.schedule[NO(o)].map((e, i) => el("li", {}, (i + 1) + "차 " + e.date + (e.qty ? " · 수량 " + e.qty : "")))));
}
function substBox(o) {
  const no = NO(o), s = substOf(no);
  const sel = el("select", {});
  [["", "해당 없음"], ["의심", "대체품 의심"], ["확인요청중", "연구원 확인 요청 중"], ["승인", "승인됨"], ["거절", "거절됨"]].forEach(([v, t]) => sel.append(el("option", { value: v }, t)));
  sel.value = s ? s.state : "";
  sel.addEventListener("change", () => { if (!sel.value) delete S.subst[no]; else setSubst(no, { state: sel.value }); persist(); render(); });
  const cmpBox = el("div", {});
  const drawCmp = () => {
    const rows = substRows(o);
    cmpBox.replaceChildren(atableOf(["항목", "주문", "공급사 회신"], rows.map(r => el("tr", {}, el("td", {}, r.label), el("td", {}, r.list || "-"), el("td", { class: r.differs ? "chg" : "" }, (r.sup || "-") + (r.differs ? " (다름)" : ""))))));
  };
  const field = (key, ph) => {
    const i = el("input", { type: "text", placeholder: ph }); i.value = s ? s[key] || "" : "";
    i.addEventListener("change", () => { setSubst(no, { [key]: i.value.trim() }); persist(); drawCmp(); });
    return i;
  };
  drawCmp();
  const msgBox = el("div", {}); msgBox.hidden = true;
  const show = (label, text) => {
    const ta = el("textarea", { rows: "11", "aria-label": "메시지 문구" }); ta.value = text;
    const cp = el("button", {}, "복사"); cp.addEventListener("click", () => copyText(ta.value, cp));
    msgBox.replaceChildren(el("div", { class: "nblock" }, el("b", {}, label), ta, el("div", { class: "row" }, cp))); msgBox.hidden = false;
  };
  const info = () => ({ rows: substRows(o), reasons: (S.subst[no] && S.subst[no].note ? [S.subst[no].note] : []), supplier: (o["공급사"] || "").trim() });
  const b1 = el("button", { class: "quiet" }, "연구원 승인 요청 문구");
  b1.addEventListener("click", () => { const i = info(); show("연구원에게", Reask.renderSubstApprove(o["요청자"], { orderNo: no, item: o["품목명"] }, i.rows, i.reasons, S.notice.signature)); });
  const b2 = el("button", { class: "quiet" }, "공급사에 사전 승인 요구");
  b2.addEventListener("click", () => { const i = info(); show("공급사에 (발송 보류 요청)", Reask.renderSubstSupplier(i.supplier, { orderNo: no, item: o["품목명"] }, i.rows, "hold", S.notice.signature)); });
  const b3 = el("button", { class: "quiet" }, "공급사에 반려");
  b3.addEventListener("click", () => { const i = info(); show("공급사에 (반려)", Reask.renderSubstSupplier(i.supplier, { orderNo: no, item: o["품목명"] }, i.rows, "reject", S.notice.signature)); });
  return el("div", { class: "causebox", "data-screen-id": "LS-35-A" }, el("h3", {}, "대체품 확인"),
    el("label", {}, "상태", sel),
    el("label", {}, "공급사가 보낸 품목명", field("supItem", "예: 에어 필터 (FA-130)")),
    el("label", {}, "공급사가 보낸 규격", field("supSpec", "예: FA-130")),
    el("label", {}, "공급사가 보낸 수량", field("supQty", "예: 10")),
    cmpBox, ...(s && s.note ? [el("p", { class: "sub" }, "확인 근거: " + s.note)] : []),
    el("div", { class: "row" }, b1, b2, b3), msgBox,
    el("p", { class: "sub" }, "대체품은 연구원 승인을 받기 전에는 받아들이지 않는 것이 안전해요. 앱은 메시지를 보내지 않아요."));
}

// 연구원 안내 현황 막대: 안내가 안 된 것·다시 알려야 할 것을 한눈에 보고, 그것만 골라 볼 수 있다
// 연구원 문의 요약 (LS-27-A, FR-23, CUJ-5): 연구원으로 필터하면 그 사람의 주문을 한 줄로 요약한다. 입고 완료는 뺀다.
function renderAsk() {
  const box = $("askBox"), who = S.view === "list" ? S.filter.requester : "";
  if (!who) { box.hidden = true; box.replaceChildren(); return; }
  const base = baseDay(), mine = S.result.all.filter(o => norm(o["요청자"], "(요청자 없음)") === who);
  const inform = Home.informList(mine, informedOf).length;
  const late = Replies.lateOrders(replyItems(mine), base);
  const s = Home.requesterSummary(mine, { informCount: inform, lateCount: late.late.length, quietCount: late.quiet.length });
  const parts = ["지연 " + s.late, "임박 " + s.soon, "확인 필요 " + s.check];
  box.replaceChildren(el("b", {}, "연구원 문의 요약 · " + who + " "), "열린 주문 " + s.total + "건 (", parts.join(" · "), ") · 안내할 것 " + s.inform + "건"
    + (s.replyLate ? " · " : ""), ...(s.replyLate ? [el("span", { class: "badge warn" }, "회신 늦음 " + s.replyLate + "건")] : []),
    s.replyQuiet ? " (오늘 연락한 " + s.replyQuiet + "건은 조용히 둬요)" : "");
  box.hidden = false;
}

function renderInformBar() {
  const bar = $("informBar");
  if (S.view !== "list" || !S.result || !listed().length) { bar.hidden = true; return; }
  const s = informedSummary(listed());
  const cb = el("input", { type: "checkbox" }); cb.checked = S.onlyNeed;
  cb.addEventListener("change", () => { S.onlyNeed = cb.checked; render(); });
  const parts = [el("b", {}, "연구원 안내"), el("span", { class: "badge late" }, "미안내 " + s.미안내), el("span", { class: "badge soon" }, "다시 안내 " + s.재안내필요), el("span", { class: "badge ok" }, "완료 " + s.안내완료)];
  if (s.지연) parts.push(el("span", { class: "sub" }, "지연 " + s.지연 + "건 중 지연 전에 미리 안내 " + s.preempt + "건 · 지연인데 아직 미안내 " + s.lateNone + "건"));
  parts.push(el("label", {}, cb, "안내가 필요한 것만 보기"));
  bar.replaceChildren(...parts); bar.hidden = false;
}

function informedBox(o) {
  const no = NO(o), st = informedOf(o), log = S.informed[no] || [];
  const line = st.state === "미안내" ? "아직 연구원에게 안내한 기록이 없어요."
    : st.state === "재안내필요" ? "다시 알려야 해요: " + st.reason + "."
    : "마지막 안내: " + st.last.date + " (" + st.ago + "일 전, " + st.last.channel + ")";
  const sel = channelSelect();
  const note = el("input", { type: "text", placeholder: "메모 (예: 전화로 새 일정 확인 중이라고 설명)", maxlength: "200", "aria-label": "안내 메모" });
  const rec = el("button", { class: "primary" }, "안내함으로 기록");
  rec.addEventListener("click", () => { recordInformed([o], sel.value, note.value.trim()); render(); });
  const undo = el("button", { class: "quiet" }, "마지막 기록 취소");
  undo.disabled = !log.length;
  undo.addEventListener("click", () => { Informed.undo(S.informed, no); persist(); render(); });
  // 기록 버튼을 상태 줄 바로 아래에 둔다 (FR-17): 좁은 상세 칸에서도 스크롤 없이 닿고, 기록이 쌓여도 위치가 변하지 않는다.
  return el("div", { class: "causebox informbox", "data-screen-id": "LS-31-A" }, el("h3", {}, "연구원 안내 기록"), el("p", {}, informedBadge(o), " ", line),
    el("div", { class: "row" }, sel, rec), note,
    ...(log.length ? [el("ul", { class: "hist" }, ...log.slice().reverse().map(e => el("li", {}, e.date + " · " + e.channel + " · " + e.status + " 때 안내" + (e.note ? " · " + e.note : ""))))] : []),
    el("div", { class: "row" }, undo),
    el("p", { class: "sub" }, "안내문을 보낸 뒤에 눌러 두세요. 납기가 바뀌거나 지연이 되면 '다시 안내'로 알려 줘요. 이 앱은 메시지를 보내지 않아요."));
}

// ---- 빠른 메모: 전화·메신저로 받은 지연 소식을 잊기 전에 주문에 남긴다 (FR-12, CUJ-3) ----
// 입력은 글 하나뿐이다 (채널·분류 같은 필수 항목이 없다). Ctrl+Enter로 바로 남긴다. 메모는 안내 상태·판정에 영향을 주지 않는다.
function quickNoteBox(o) {
  const no = NO(o);
  const ta = el("textarea", { rows: "2", maxlength: "300", placeholder: "예: 전화로 들음. 통관 서류 보완 중이라 10월 말 예상 (Ctrl+Enter로 남기기)", "aria-label": "빠른 메모" });
  const msg = el("p", { class: "sub " + (S.noteMsg ? "msg-ok" : "") }, S.noteMsg || ""); S.noteMsg = "";   // 한 번만 보여 준다
  const submit = () => {
    const r = QuickNote.add(S.quickNotes, no, ta.value, new Date().toISOString());
    if (!r.ok) { msg.className = "sub msg-err"; msg.textContent = "메모를 적어 주세요."; ta.focus(); return; }
    S.noteMsg = r.clipped ? "300자까지만 저장했어요." : r.dropped ? "주문당 최근 " + QuickNote.MAX_LIVE + "건까지만 보관해서 가장 오래된 메모 " + r.dropped + "건이 빠졌어요." : "";
    S.focusNote = true;                                      // 이어서 바로 또 적을 수 있게 입력 칸으로 돌아온다
    persist(); render();
  };
  const save = el("button", { class: "primary" }, "메모 남기기");
  save.addEventListener("click", submit);
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
  if (S.focusNote) { S.focusNote = false; setTimeout(() => ta.focus(), 0); }

  const notes = QuickNote.list(S.quickNotes, no);            // 최신순
  const items = notes.map(n => {
    const del = el("button", { class: "quiet", title: "이 메모를 지워요" }, "삭제");
    let armed = false;                                       // 실수로 지우지 않게 두 번 눌러야 지워진다
    del.addEventListener("click", () => {
      if (!armed) { armed = true; del.textContent = "정말 삭제?"; return; }
      QuickNote.remove(S.quickNotes, no, n); persist(); render();
    });
    return el("li", {}, el("span", { class: "nt" }, QuickNote.stamp(n.createdAt)), el("span", { class: "ntext" }, n.text), del);
  });
  return el("div", { class: "causebox notebox", "data-screen-id": "LS-33-A" }, el("h3", {}, "빠른 메모" + (notes.length ? " (" + notes.length + ")" : "")),
    ta, el("div", { class: "row" }, save), msg,
    ...(notes.length ? [el("ul", { class: "hist" }, ...items)] : [el("p", { class: "sub" }, "전화·메신저로 받은 소식을 여기에 남겨 두세요. 안내 상태에는 영향이 없어요.")]));
}

// ---- 공급사 회신·약속일, 한눈에, 답변 초안 (FR-21·23·24, CUJ-5·6, ADR-0007·0008) ----
// 회신은 주문 단위로 쌓고(고치지 않고, 마지막 기록 취소만), "회신 늦음"은 저장하지 않고 src/replies.js가 매번 계산한다.
const supplierOf = o => (o["공급사"] || "").trim();
const repliesOf = o => S.replies[NO(o)] || [];
const replyCtx = o => ({ today: baseDay(), received: o.status === "입고완료", contactedOn: S.contacted[supplierOf(o)] || "", due: o["납기일"] || "" });

// 한눈에: 연구원이 물으면 이것만 보고 답한다 (LS-38-A). 상세 맨 위라서 한 줄씩 짧게 둔다.
function glanceBox(o) {
  const g = Replies.glance(repliesOf(o), replyCtx(o)), last = g.last;
  const flag = g.state === "late" ? el("span", { class: "badge warn" }, "회신 늦음 " + g.daysLate + "일째" + (g.quiet ? " (오늘 연락함)" : ""))
    : g.state === "due-today" ? el("span", { class: "badge" }, "약속일 오늘") : null;
  // 두 줄로 줄인 이유: 상세 맨 위에 두면서도 '안내함으로 기록' 버튼이 스크롤 없이 보여야 한다 (FR-17, 1280x820)
  return el("div", { class: "glance", "data-screen-id": "LS-38-A" },
    el("p", {}, el("b", {}, "한눈에 "), "납기 " + (o["납기일"] || "-") + " → 약속일 " + (g.promised || "없음") + (g.differs ? " (파일과 달라요)" : "")),
    el("p", {}, (last ? "회신 " + last.date + " · " + last.channel + (last.note ? " · " + last.note : "") : "공급사 회신 없음 (아래에서 기록)"), " ", ...(flag ? [flag] : [])));
}

// 공급사 회신 기록 (LS-37-A): 회신 받은 날, 약속일(선택), 방법, 메모. 잘못 넣으면 마지막 기록을 취소하고 다시 넣는다.
function replyBox(o) {
  const no = NO(o), list = Replies.history(repliesOf(o));
  const date = el("input", { type: "date", value: baseDay(), "aria-label": "회신 받은 날" });
  const promised = el("input", { type: "date", "aria-label": "약속일 (선택)" });
  const sel = channelSelect();
  const note = el("input", { type: "text", placeholder: "메모 (예: 통관 서류 보완 후 출고 예정)", maxlength: String(Replies.NOTE_MAX), "aria-label": "회신 메모" });
  const msg = el("p", { class: "sub " + (S.replyMsg ? "msg-ok" : ""), role: "status" }, S.replyMsg || ""); S.replyMsg = "";
  const rec = el("button", { class: "primary" }, "회신 기록");
  rec.addEventListener("click", () => {
    const v = Replies.validate({ date: date.value, promised: promised.value, channel: sel.value, note: note.value.trim(), supplier: supplierOf(o) });
    if (!v.ok) { msg.className = "sub msg-err"; msg.textContent = v.error; return; }
    addReply(no, v.reply);
    S.replyMsg = "회신을 기록했어요."; persist(); render();
  });
  const undo = el("button", { class: "quiet" }, "마지막 기록 취소");
  undo.disabled = !list.length;
  undo.addEventListener("click", () => {
    const last = list[list.length - 1]; if (!last) return;
    S.replies[no] = S.replies[no].filter(e => e !== last && !(e.id && e.id === last.id));
    if (!S.replies[no].length) delete S.replies[no];
    S.replyMsg = "마지막 기록을 취소했어요."; persist(); render();
  });
  return el("div", { class: "causebox replybox", "data-screen-id": "LS-37-A" }, el("h3", {}, "공급사 회신·약속일"),
    el("div", { class: "row" }, el("label", {}, "회신 받은 날 ", date), el("label", {}, "약속일 ", promised)),
    el("div", { class: "row" }, sel, rec), note, msg,
    ...(list.length ? [el("ul", { class: "hist" }, ...list.slice().reverse().map(e => el("li", {}, e.date + " · " + e.channel + (e.promised ? " · 약속일 " + e.promised : " · 약속일 없음") + (e.note ? " · " + e.note : ""))))] : []),
    el("div", { class: "row" }, undo),
    el("p", { class: "sub" }, "공급사가 알려 준 약속일을 남겨 두면, 그 날이 지나도 회신이 없을 때 홈에서 알려 줘요. 기록은 고치지 않고 쌓여요."));
}

// 답변 초안 (LS-39-A): 연구원 문의에 답할 이메일 글과 전화 요점. 복사만 한다 (이 앱은 보내지 않는다).
function draftBox(o) {
  const d = { no: NO(o), product: o["품목명"] || "", researcher: (o["요청자"] || "").trim(), statusText: Labels.status(o.status) + " (" + daysText(o) + ")", due: o["납기일"] || "", replies: repliesOf(o), ...replyCtx(o), signature: S.notice.signature || "" };
  const mail = el("textarea", { rows: "9", readonly: "", "aria-label": "이메일 답변 초안" }); mail.value = Replies.draftEmail(d);
  const call = el("textarea", { rows: "3", readonly: "", "aria-label": "전화 요점" }); call.value = Replies.draftCall(d);
  const copyMail = el("button", {}, "이메일 답변 복사"), copyCall = el("button", {}, "전화 요점 복사");
  copyMail.addEventListener("click", () => copyText(mail.value, copyMail));
  copyCall.addEventListener("click", () => copyText(call.value, copyCall));
  return el("details", { class: "causebox draftbox", "data-screen-id": "LS-39-A" }, el("summary", {}, "답변 초안 (이메일·전화 요점)"),
    el("p", { class: "sub" }, "상태, 공급사 마지막 회신, 약속일로 채웠어요. 모르는 값은 '확인 중'으로 써요. 복사해서 직접 보내세요."),
    mail, el("div", { class: "row" }, copyMail), call, el("div", { class: "row" }, copyCall));
}

const isNarrow = () => window.matchMedia("(max-width: 1000px)").matches;
// 위에 붙어 있는 머리(제목·탭·기준일)의 아래쪽 끝. 요소로 스크롤할 때 머리에 가려지지 않게 그만큼 비워 둔다.
function stickyBottom() { let b = 0; document.querySelectorAll("header, .top, .subbar").forEach(h => { if (getComputedStyle(h).position === "sticky") b = Math.max(b, h.getBoundingClientRect().bottom); }); return b; }
function scrollBelowHeader(node, block) {
  const r = node.getBoundingClientRect(), room = stickyBottom() + 8;
  window.scrollBy(0, block === "center" ? r.top + r.height / 2 - (room + (window.innerHeight - room) / 2) : r.top - room);
}
// 상세 창을 닫고, 보던 주문 줄로 포커스를 돌려준다
function closeDetail() {
  const no = S.selected; if (!no) return;
  S.selected = null; render();
  const tr = [...$("tbody").querySelectorAll("tr")].find(r => r.dataset.no === no);
  if (tr) { tr.focus({ preventScroll: true }); scrollBelowHeader(tr, "center"); }
}
function renderDetail() {
  const box = $("detail");
  const goFocus = S.focusDetail, goScroll = S.scrollDetail; S.focusDetail = false; S.scrollDetail = false;
  const o = listed().find(x => x["주문번호"] === S.selected);
  $("listView").classList.toggle("has-detail", !!o);                // 주문을 고르면 상세가 넓은 창으로 열린다 (좁은 오른쪽 칸에서는 입력이 불편했다)
  if (!o) { box.replaceChildren(el("p", { class: "sub" }, "표에서 주문을 누르면 상세가 여기에 보여요.")); return; }
  S.opened = true;                                                  // 처음 시작 안내(HM-24-A) 2단계: 주문을 눌러 본 적이 있다
  // 좁은 창에서는 상세가 표 아래로 내려가므로, 주문을 고르면 상세로 내려간다 (T6.6). 키보드로 열면 포커스도 옮긴다.
  setTimeout(() => { if (goFocus) box.focus({ preventScroll: true }); }, 0);
  const back = el("button", { type: "button", class: "quiet backtolist" }, "닫기 (Esc)");
  back.addEventListener("click", closeDetail);
  const dl = el("dl", {});
  Object.entries(o._raw).forEach(([k, v]) => { dl.append(el("dt", {}, k), el("dd", {}, v || "(비어 있음)")); });
  box.replaceChildren(
    el("h2", {}, o["주문번호"]),
    el("p", {}, badge(o.status), " ", o.reason),
    S.edited[o["주문번호"]] ? el("p", { class: "edited" }, "이메일 기준으로 납기를 바꿨어요 (원래 값: " + S.edited[o["주문번호"]].from + ")") : el("span", {}),
    glanceBox(o),
    // 두 칸으로 나눈다: 왼쪽은 지금 할 일(안내·회신·안내문·초안), 오른쪽은 기록과 참고(메모·원래 값·원인·대체품). 칸 안에서는 위에서 아래로 쌓여 빈 구멍이 생기지 않는다.
    el("div", { class: "detailcols" },
      el("div", { class: "dcol" }, informedBox(o), replyBox(o), noticeBox(o), draftBox(o)),
      el("div", { class: "dcol" }, quickNoteBox(o),
        el("p", { class: "sub" }, "아래는 파일에 있던 원래 값이에요."), dl,
        o.status === "지연" ? causeBox(o) : el("span", {}),
        ...(S.schedule[NO(o)] ? [schedBlock(o)] : []), substBox(o))),
    back);                                                          // 닫기는 글 순서 맨 끝(Tab 순서가 안내 기록보다 뒤), 화면에서는 오른쪽 위에 둔다
}

// 파일을 읽으면서 알려 줄 것(건너뛴 줄, 잘림, 시트 선택)을 머리 아래에 보여 준다. 잘렸다는 사실은 눈에 띄게(경고색).
function showFileNote(file) {
  const box = $("fileNote");
  const notes = file.notes || [];
  if (!notes.length && !(file.choices && file.choices.length > 1)) { box.hidden = true; box.replaceChildren(); return; }
  const kids = notes.map(n => el("p", { class: /까지만/.test(n) ? "warnline" : "sub" }, n));
  if (file.choices && file.choices.length > 1) {
    const sel = el("select", { "aria-label": "읽을 시트" }, ...file.choices.map((c, i) => el("option", { value: String(i) }, c.sheetName + " (" + c.rows.length + "건)")));
    sel.value = String(Math.max(0, file.choices.findIndex(c => c.sheetName === file.sheetName)));
    sel.addEventListener("change", () => { const c = file.choices[+sel.value]; load({ name: file.name, ...c, choices: file.choices }, false); });
    kids.push(el("label", { class: "sheetpick" }, "다른 시트에도 표가 있어요: ", sel));
  }
  box.replaceChildren(...kids); box.hidden = false;
}

// 같은 주문번호가 여러 줄이면 알린다: 기록(안내·메모·사유)은 주문번호 하나에 붙으므로 그 줄들에 함께 보인다.
function addDuplicateNote() {
  const d = Duplicates.findDuplicates(S.rows, S.mapping["주문번호"]);
  if (!d.count) return;
  const box = $("fileNote");
  box.append(el("p", { class: "warnline" }, "같은 주문번호가 여러 줄에 있어요: " + d.count + "개 번호, " + d.rows + "줄 (예: " + d.sample.map(x => x.no + " " + x.n + "줄").join(", ") + "). 안내 기록·메모·사유는 주문번호 하나에 붙어서, 같은 번호의 줄에는 함께 보여요."));
  box.hidden = false;
}

function load(file, isSample) {
  if (file.error) { $("fileName").textContent = file.name + " · " + file.error; showFileNote({}); return; }
  const parsed = file.columns ? { columns: file.columns, rows: file.rows } : Csv.csvToObjects(file.text);   // 엑셀은 읽어서 표로 오고, CSV는 글자로 온다
  if (!parsed.columns.length || !parsed.rows.length) { $("fileName").textContent = "읽을 수 있는 행이 없어요. 주문 목록 파일이 맞는지 확인해 주세요."; showFileNote({}); return; }
  showFileNote(file);
  S.name = file.name; S.columns = parsed.columns; S.rows = parsed.rows; S.selected = null;
  S.mapping = guessMapping(S.columns); S.ai = {}; S.edited = {};
  S.reasons = {}; S.causeOverride = {}; S.filter = {}; S.view = "home"; S.bulk = null; S.picked = new Set(); S.q = ""; $("q").value = ""; S.sort = null;
  if (isSample && file.sampleDate) $("today").value = file.sampleDate;
  if (isSample && S.soonRules == null) { S.soonRules = SAMPLE_RULES; $("rulesText").value = SAMPLE_RULES; persist(); } // 샘플을 처음 열면 샘플용 품목별 기준을 넣어 둔다
  if (missingRequired().length) {
    $("empty").hidden = true; $("result").hidden = true; $("mainTabs").hidden = true;
    $("fileName").textContent = file.name + " · 필수 열을 찾지 못했어요. 아래에서 직접 연결해 주세요.";
    showMapping();
  } else { $("mapPanel").hidden = true; addDuplicateNote(); applySaved(); compute(); }
}

$("openBtn").addEventListener("click", async () => { const f = await window.app.openOrders(); if (f) load(f, false); });
$("sampleBtn").addEventListener("click", async () => load(await window.app.loadSample(), true));
$("today").addEventListener("change", () => S.rows.length && !missingRequired().length && compute());
$("soon").addEventListener("change", () => S.rows.length && !missingRequired().length && compute());
$("mapBtn").addEventListener("click", () => ($("mapPanel").hidden ? showMapping() : ($("mapPanel").hidden = true)));
$("applyMap").addEventListener("click", () => {
  STD.forEach(std => (S.mapping[std] = $("map-" + std).value));
  if (missingRequired().length) { $("fileName").textContent = "주문번호와 납기일은 꼭 연결해야 해요."; return; }
  $("mapPanel").hidden = true; S.selected = null; applySaved(); compute();
});

const SAMPLE_EMAIL = "안녕하세요, 가온산업 영업팀입니다.\n\n문의하신 주문 건 회신드립니다.\n\n1. PO-2026-1001 (산업용 베어링)\n통관 서류 보완으로 10월 23일 입고 예정입니다. 불편을 드려 죄송합니다.\n\n2. PO-2026-1002 (유압 호스)\n현재 선적 준비 중이며, 빠르면 이번 주 중, 늦으면 다음 주 초 도착합니다.\n\n3. PO-2026-1010 (온도 센서)\n예정대로 10월 14일 도착합니다.\n\n감사합니다.";
S.edited = {};

function currentDue(orderNo) {
  const col = S.mapping["납기일"], idc = S.mapping["주문번호"];
  if (!S.rows.length || !col || !idc) return { found: false };
  const row = S.rows.find(r => r[idc] === orderNo);
  return row ? { found: true, row, value: row[col] } : { found: false };
}

function renderEmailItems(items) {
  const box = $("emailResult");
  if (!items.length) { box.replaceChildren(el("p", { class: "sub" }, "이메일에서 주문번호가 있는 납기 정보를 찾지 못했어요.")); return; }
  const wrap = el("div", { class: "emailres" });
  items.forEach(it => {
    const cur = currentDue(it.orderNo);
    const changed = cur.found && it.dueDate && cur.value !== it.dueDate;
    const card = el("div", { class: "ecard" });
    const head = el("div", { class: "head" }, el("b", {}, it.orderNo), el("span", { class: "mapnote " + (it.confidence === "높음" ? "high" : it.confidence === "보통" ? "mid" : "low") }, "신뢰도 " + it.confidence), el("span", { class: "src" }, (it.source || "") + " 모드"));
    card.append(head);
    if (it.mail) card.append(el("div", { class: "sub" }, "메일: " + (it.mail.subject || "(제목 없음)") + " · " + (it.mail.from || "보낸 사람 모름") + " · " + fmtMailDate(it.mail.date)));
    const dates = el("div", { class: "dates" }, el("span", {}, "목록의 납기: " + (cur.found ? cur.value || "(비어 있음)" : "목록에 없음")),
      el("span", {}, "이메일의 납기: ", it.dueDate ? el("b", { class: changed ? "chg" : "" }, it.dueDate + (changed ? " (변경)" : "")) : el("b", {}, "확인 필요 (날짜를 확정할 수 없음)")));
    card.append(dates);
    if (it.reason) card.append(el("div", {}, "사유: " + it.reason));
    if (it.evidence) card.append(el("blockquote", {}, "“" + it.evidence + "”"));
    if (it.note) card.append(el("div", { class: "warnline" }, it.note));
    if (it.substitute && cur.found) {
      const key = cur.row[S.mapping["주문번호"]];
      const mark = el("button", { class: "quiet" }, substOf(key) ? "대체품 표시됨 (" + SUBST_LABEL[substOf(key).state] + ")" : "대체품 의심으로 표시");
      mark.addEventListener("click", () => { if (!substOf(key)) setSubst(key, { state: "의심", note: "회신에 '" + it.subWord + "'(이)라는 말이 있어요", source: "이메일" }); persist(); render(); renderEmailItems(items); });
      card.append(el("div", { class: "row" }, mark));
    }
    if (cur.found && it.dueDate && changed && !it.evidenceOk) {
      card.append(el("div", { class: "sub" }, "근거 문장이 확인되지 않아 자동 반영은 막아 뒀어요. 이메일을 직접 확인해 주세요."));
    } else if (cur.found && it.dueDate && changed) {
      const b = el("button", {}, "목록의 납기를 이 날짜로 바꾸기");
      b.addEventListener("click", () => {
        S.edited[it.orderNo] = { from: cur.value, to: it.dueDate };
        if (it.reason) S.reasons[it.orderNo] = it.reason;
        persist();
        cur.row[S.mapping["납기일"]] = it.dueDate;
        compute(); renderEmailItems(items); // 카드를 다시 그리므로 열려 있던 안내문 칸은 닫힌다
      });
      card.append(el("div", { class: "row" }, b));
    } else if (S.edited[it.orderNo] && cur.value === it.dueDate) card.append(el("div", { class: "edited" }, "반영했어요 (원래 값: " + S.edited[it.orderNo].from + ")"));
    // 회신으로 기록 제안 (FR-25): 제안만 하고, 사람이 누를 때만 기록한다. 근거 문장이 확인된 메일만, 신뢰도가 낮으면 약속일을 비운다.
    if (cur.found) {
      const sug = Replies.suggestFromMail(it, { today: baseDay(), supplier: (cur.row[S.mapping["공급사"]] || "").trim(), existing: S.replies[it.orderNo] || [] });
      if (sug.ok) {
        const b = el("button", {}, "공급사 회신으로 기록");
        b.addEventListener("click", () => {
          const v = Replies.validate(sug.reply);
          if (!v.ok) return;
          addReply(it.orderNo, v.reply);
          persist(); render(); renderEmailItems(items);
        });
        card.append(el("div", { class: "row replysuggest" }, b, el("span", { class: "sub" }, "이 메일을 회신으로 기록할까요? 회신 받은 날 " + sug.reply.date + (sug.reply.promised ? " · 약속일 " + sug.reply.promised : " · 약속일 없음" + (sug.dateDropped ? " (신뢰도가 낮아 날짜는 비웠어요)" : "")))));
      } else if (sug.duplicate) card.append(el("div", { class: "sub" }, sug.reason));
    }
    if (it.older && it.older.length) {
      const d = el("details", { class: "sentbox" }, el("summary", {}, "같은 주문을 다룬 이전 메일 " + it.older.length + "통 (이 카드는 가장 최근 메일 기준이에요)"));
      it.older.forEach(o => d.append(el("p", { class: "sub" }, fmtMailDate(o.mail.date) + " · " + (o.mail.subject || "(제목 없음)") + " → " + (o.dueDate || "확인 필요"))));
      card.append(d);
    }
    // 납기가 바뀐 주문은 예외 목록에서 사라질 수 있으니, 연구원 안내문은 이 카드에서도 만들 수 있게 한다.
    if (cur.found) {
      const host = el("div", {});
      const nb = el("button", { class: "quiet" }, "연구원 안내문 만들기");
      nb.addEventListener("click", () => {
        if (host.childNodes.length) { host.replaceChildren(); return; }
        const applied = S.edited[it.orderNo];
        // 반영 전이면 이메일의 새 납기로 미리 써 준다 (근거 문장이 확인된 경우만)
        const info = applied ? null : { oldDue: cur.value, newDue: it.evidenceOk && changed ? it.dueDate : "", reason: it.reason || "" };
        host.append(noticeBox(toStd(cur.row), info));
      });
      card.append(el("div", { class: "row" }, nb), host);
    }
    wrap.append(card);
  });
  box.replaceChildren(wrap);
}


// ---- 메일 폴더(.eml)에서 읽기 ----
S.mails = [];
let folderConfirm = false;
const FOLDER_CLAUDE_CAP = 20; // Claude 모드는 메일마다 한 번씩 호출하므로 한 번에 최대 20통
const fmtMailDate = iso => { const d = new Date(iso); return isNaN(d) ? "날짜 모름" : (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const knownIdsForMail = () => (S.mapping["주문번호"] ? S.rows.map(r => r[S.mapping["주문번호"]]) : []);

function mailSelection() {
  const s = $("mailStart").value, e = $("mailEnd").value;
  const inRange = S.mails.filter(m => MailFilter.inRange(m.date, s, e));
  const only = $("onlyDue").checked;
  const ids = knownIdsForMail();
  return { inRange, selected: only ? inRange.filter(m => MailFilter.isDueMail(m, ids)) : inRange, only };
}
function updateMailSummary() {
  folderConfirm = false; $("folderRunStatus").textContent = "";
  const { inRange, selected, only } = mailSelection();
  const noDate = S.mails.filter(m => !m.date).length;
  $("mailSummary").textContent = "기간 안의 메일 " + inRange.length + "통 중 " + (only ? "납기 관련 " : "") + selected.length + "통에서 납기를 찾아요." +
    (noDate ? " (날짜를 읽을 수 없는 메일 " + noDate + "통은 기간 계산에서 빠져요.)" : "");
}
function setPreset(kind) {
  const r = MailFilter.presetRange(kind, $("today").value || localToday());
  if (!r) return;
  $("mailStart").value = r.start; $("mailEnd").value = r.end; updateMailSummary();
}
function loadMails(r, isSample) {
  if (!r) return;
  if (!r.ok) { $("folderStatus").textContent = r.error; return; }
  S.mails = r.mails;
  $("folderStatus").textContent = r.mails.length ? r.mails.length + "통을 읽었어요" + (r.skipped ? " (읽지 못한 파일 " + r.skipped + "개)" : "") + (r.truncated ? " (2,000통까지만 읽었어요)" : "") + " · " + r.folder : "이 폴더에는 .eml 파일이 없어요.";
  $("folderControls").hidden = !r.mails.length;
  if (r.mails.length) { if (isSample) $("today").value = "2026-10-12"; setPreset("lastFriNoon"); }
  // 엑셀·CSV 첨부가 있는 메일은 바로 「공급사 엑셀 읽기」로 열 수 있게 목록으로 보여 준다
  const att = [];
  r.mails.forEach(m => (m.attachments || []).forEach(a => att.push({ m, a })));
  $("attachBox").hidden = !att.length;
  $("attachList").replaceChildren(...att.map(({ m, a }) => {
    const b = el("button", { class: "quiet" }, fmtMailDate(m.date) + " · " + (m.subject || m.file) + " — " + a);
    b.addEventListener("click", async () => loadSupplier(await window.app.openMailAttachment({ file: m.file, name: a })));
    return b;
  }));
}
async function runFolder() {
  const { selected } = mailSelection();
  const st = $("folderRunStatus");
  if (!selected.length) { st.textContent = "조건에 맞는 메일이 없어요. 기간이나 필터를 바꿔 보세요."; return; }
  const claude = false; // 규칙 방식만 쓴다
  const targets = claude ? selected.slice(0, FOLDER_CLAUDE_CAP) : selected; // 이미 최근 순으로 정렬돼 있다
  if (claude && !folderConfirm) {
    folderConfirm = true;
    st.textContent = targets.length + "통의 제목·본문이 Claude로 전송돼요" + (selected.length > targets.length ? " (최근 " + FOLDER_CLAUDE_CAP + "통만)" : "") + ". 괜찮으면 한 번 더 눌러 주세요.";
    return;
  }
  folderConfirm = false;
  const items = [];
  $("folderRun").disabled = true;
  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    st.textContent = (claude ? "Claude가 읽는 중 " : "읽는 중 ") + (i + 1) + "/" + targets.length;
    const mailDay = m.date ? MailFilter.localStr(new Date(m.date)).slice(0, 10) : ($("today").value || localToday()); // '내일' 같은 말은 메일을 보낸 날 기준
    const text = (m.subject || "") + "\n" + m.body;
    const meta = { subject: m.subject, from: m.from, date: m.date, file: m.file };
    if (claude) {
      const r = await window.app.extractEmail({ text, today: mailDay });
      if (!r.ok) { st.textContent = r.error; $("folderRun").disabled = false; return; }
      r.items.forEach(x => items.push({ ...x, source: "Claude", mail: meta }));
    } else EmailRules.extract(text, mailDay, knownIdsForMail()).forEach(x => items.push({ ...x, source: "규칙", mail: meta }));
  }
  $("folderRun").disabled = false;
  const picked = MailFilter.pickLatestPerOrder(items);
  st.textContent = targets.length + "통에서 주문 " + picked.length + "건을 찾았어요." + (S.rows.length ? "" : " 목록을 먼저 불러오면 비교와 반영도 할 수 있어요.");
  renderEmailItems(picked);
}
function showSource(which) {
  $("pasteBlock").hidden = which !== "paste"; $("folderBlock").hidden = which !== "folder"; $("supplierBlock").hidden = which !== "supplier";
  $("srcPaste").classList.toggle("on", which === "paste"); $("srcFolder").classList.toggle("on", which === "folder"); $("srcSupplier").classList.toggle("on", which === "supplier");
  $("emailHint").hidden = which === "supplier"; // 공급사 엑셀은 규칙으로만 읽는다
  $("emailResult").replaceChildren();
}
$("srcPaste").addEventListener("click", () => showSource("paste"));
$("srcFolder").addEventListener("click", () => showSource("folder"));
$("srcSupplier").addEventListener("click", () => showSource("supplier"));

// ---- 공급사 엑셀(.xlsx/.csv) 읽기 ----
S.sup = null; S.supRes = null; S.supSel = new Set(); S.supSkipped = [];
const SUP_FIELDS = [["주문번호", "주문번호 *"], ["납기일", "납기일 *"], ["공급사", "공급사"], ["품목명", "품목명"], ["비고", "비고·메모"]];
const colLetter = i => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function loadSupplier(r) {
  if (!r) return;
  if (!r.ok) { $("supStatus").textContent = r.error; return; }
  S.sup = { name: r.name, sheets: r.sheets, sheetIdx: 0, headerIdx: 0, cols: {} };
  let best = -1, bs = 0; // 머리글이 가장 뚜렷한 시트를 먼저 연다 (첫 시트가 안내문인 경우)
  r.sheets.forEach((sh, i) => { const h = Supplier.findHeader(sh.rows); if (h && h.score > bs) { bs = h.score; best = i; } });
  S.sup.sheetIdx = best >= 0 ? best : 0;
  $("supStatus").textContent = r.name + " · 시트 " + r.sheets.length + "개";
  showSource("supplier");
  showSupplierSheet(true);
}
function showSupplierSheet(guess) {
  const sh = S.sup.sheets[S.sup.sheetIdx];
  if (guess) {
    const h = Supplier.findHeader(sh.rows);
    S.sup.headerIdx = h ? h.index : 0; S.sup.cols = h ? { ...h.columns } : {};
    $("supHeaderNote").textContent = h ? "머리글 줄을 " + (h.index + 1) + "번째 줄에서 찾았어요. 아래 열 연결이 맞는지 확인하세요." : "머리글 줄을 찾지 못했어요. 머리글 줄 번호를 넣고 열을 직접 골라 주세요.";
  }
  const sel = $("supSheet");
  sel.replaceChildren(...S.sup.sheets.map((s, i) => { const o = el("option", { value: String(i) }, s.name + " (" + s.rows.length + "줄)"); if (i === S.sup.sheetIdx) o.selected = true; return o; }));
  $("supHeaderRow").value = S.sup.headerIdx + 1;
  const header = sh.rows[S.sup.headerIdx] || [];
  const grid = $("supCols"); grid.replaceChildren();
  SUP_FIELDS.forEach(([f, label]) => {
    const s = el("select", { id: "supcol-" + f });
    s.append(el("option", { value: "" }, "(연결 안 함)"));
    header.forEach((c, i) => { if (String(c).trim()) { const o = el("option", { value: String(i) }, colLetter(i) + ": " + c); if (S.sup.cols[f] === i) o.selected = true; s.append(o); } });
    s.addEventListener("change", () => { if (s.value === "") delete S.sup.cols[f]; else S.sup.cols[f] = +s.value; });
    grid.append(el("label", {}, label, s));
  });
  renderSupPreview();
  $("supSetup").hidden = false; $("supplierResult").replaceChildren(); $("supRunStatus").textContent = "";
}
function renderSupPreview() {
  const rows = S.sup.sheets[S.sup.sheetIdx].rows, h = S.sup.headerIdx;
  const from = Math.max(0, h - 2), to = Math.min(rows.length, h + 7);
  const width = Math.min(8, Math.max(...rows.slice(from, to).map(r => r.length), 1));
  const t = el("table", { class: "atable" });
  for (let i = from; i < to; i++) {
    const tr = el("tr", { class: i === h ? "hdr" : "" }, el("td", { class: "ln" }, String(i + 1)));
    for (let c = 0; c < width; c++) tr.append(el("td", {}, rows[i][c] || ""));
    t.append(tr);
  }
  $("supPreview").replaceChildren(t);
}
$("supSheet").addEventListener("change", () => { S.sup.sheetIdx = +$("supSheet").value; showSupplierSheet(true); });
$("supHeaderRow").addEventListener("change", () => {
  const n = Math.max(1, parseInt($("supHeaderRow").value, 10) || 1);
  S.sup.headerIdx = n - 1;
  S.sup.cols = Supplier.columnsOfRow(S.sup.sheets[S.sup.sheetIdx].rows[S.sup.headerIdx] || []);
  $("supHeaderNote").textContent = "머리글 줄을 " + n + "번째 줄로 바꿨어요. 열 연결을 확인하세요.";
  showSupplierSheet(false);
});

function runSupCompare() {
  const st = $("supRunStatus");
  if (!S.rows.length || !S.mapping["주문번호"] || !S.mapping["납기일"]) { st.textContent = "비교할 주문 목록(CSV)을 먼저 열어 주세요."; return; }
  if (S.sup.cols.주문번호 == null || S.sup.cols.납기일 == null) { st.textContent = "주문번호와 납기일 열은 꼭 연결해야 해요."; return; }
  const sh = S.sup.sheets[S.sup.sheetIdx];
  const { entries, skipped } = Supplier.buildEntries(sh.rows, S.sup.headerIdx, S.sup.cols);
  const cols = { id: S.mapping["주문번호"], due: S.mapping["납기일"], supplier: S.mapping["공급사"] || null, item: S.mapping["품목명"] || null, qty: S.mapping["주문수량"] || null, spec: S.mapping["규격"] || null };
  S.supRes = Supplier.compare(S.rows, cols, entries, $("today").value || localToday());
  S.supSkipped = skipped;
  S.supSel = new Set(S.supRes.changed.filter(x => !x.careful).map(x => x.orderNo)); // 날짜 표기가 애매했던 것은 기본으로 선택하지 않는다
  st.textContent = entries.length + "줄을 읽었어요.";
  renderSupResult();
}
function secHead(title, count, extra) { return el("div", { class: "secthead" }, el("h3", {}, title + " " + count + "건"), ...(extra ? [extra] : [])); }
function atableOf(heads, rows) {
  const t = el("table", { class: "atable wrap" }); // 결과 표는 긴 설명도 잘리지 않고 줄바꿈
  t.append(el("thead", {}, el("tr", {}, ...heads.map(h => el("th", {}, h)))));
  const tb = el("tbody", {}); rows.forEach(r => tb.append(r)); t.append(tb);
  return el("div", { style: "overflow:auto" }, t);
}
function renderSupResult() {
  const r = S.supRes, box = $("supplierResult");
  const parts = [];
  const chip = (t, n, c) => el("span", { class: "chip " + c }, t + " " + n);
  parts.push(el("div", { class: "sumchips" }, chip("변경", r.changed.length, "c-changed"), chip("미회신", r.noReply.length, "c-noreply"), chip("대체품 의심", r.subst.length, "c-changed"), chip("확인 필요", r.vague.length + r.multi.length, "c-vague"), chip("동일", r.same.length, "c-same"), chip("목록에 없음", r.notInList.length, "")));
  if (S.supSkipped.length) parts.push(el("p", { class: "sub" }, "주문번호가 없어 건너뛴 줄 " + S.supSkipped.length + "개: " + S.supSkipped.slice(0, 3).map(s => s.line + "줄 " + s.text).join(" / ")));

  if (r.changed.length) {
    const apply = el("button", { class: "primary" }, "선택한 " + S.supSel.size + "건 목록에 반영");
    apply.disabled = !S.supSel.size;
    apply.addEventListener("click", applySupChanges);
    const toggle = el("button", { class: "quiet" }, S.supSel.size === r.changed.length ? "전체 선택 해제" : "전체 선택");
    toggle.addEventListener("click", () => { S.supSel = S.supSel.size === r.changed.length ? new Set() : new Set(r.changed.map(x => x.orderNo)); renderSupResult(); });
    parts.push(secHead("납기가 달라진 주문", r.changed.length, apply));
    parts.push(el("div", { class: "row" }, toggle));
    parts.push(atableOf(["", "주문번호", "품목", "목록의 납기", "공급사 납기", "메모"], r.changed.map(x => {
      const cb = el("input", { type: "checkbox" }); cb.checked = S.supSel.has(x.orderNo);
      cb.addEventListener("change", () => { cb.checked ? S.supSel.add(x.orderNo) : S.supSel.delete(x.orderNo); renderSupResult(); });
      return el("tr", {}, el("td", {}, cb), el("td", {}, x.orderNo), el("td", {}, x.item), el("td", {}, x.from || "(비어 있음)"), el("td", { class: "chg" }, x.to + (x.careful ? " ⚠" : "")), el("td", {}, x.note));
    })));
    parts.push(el("p", { class: "sub" }, "⚠는 날짜 표기가 애매해서 앱이 해석한 값이에요(기본으로 선택하지 않았어요). 원본 칸의 글을 확인하고 직접 체크하세요."));
  }

  if (r.noReply.length) {
    parts.push(secHead("미회신 (납기 칸이 비었거나 말만 있음)", r.noReply.length));
    parts.push(el("p", { class: "sub" }, "기존 납기는 그대로 두었어요. 공급사별 재문의 문구를 만들어 복사하세요."));
    const bySup = new Map();
    r.noReply.forEach(x => { const k = x.supplier || ""; if (!bySup.has(k)) bySup.set(k, []); bySup.get(k).push(x); });
    bySup.forEach((items, sup) => {
      const ta = el("textarea", { rows: "8", "aria-label": "재문의 문구" }); ta.value = Reask.renderReask(sup, items, S.notice.signature);
      const cp = el("button", {}, "복사"); cp.addEventListener("click", () => copyText(ta.value, cp));
      parts.push(el("div", { class: "nblock" }, el("b", {}, (sup || "(공급사 이름 없음)") + " · " + items.length + "건"), ta, el("div", { class: "row" }, cp)));
    });
  }

  if (r.subst.length) {
    parts.push(secHead("대체품 의심", r.subst.length));
    parts.push(el("p", { class: "sub" }, "품목명·규격이 목록과 다르거나, 회신에 '대체·동급·호환' 같은 말이 있는 주문이에요. 연구원 승인을 받기 전에는 발송을 보류하도록 공급사에 알리세요."));
    parts.push(atableOf(["주문번호", "항목별 비교 (주문 → 회신)", "확인 근거", "상태", ""], r.subst.map(x => {
      const cmp = [["품목명", x.listItem, x.supItem, Supplier.differs(x.listItem, x.supItem)], ["규격", x.listSpec, x.supSpec, Supplier.differs(x.listSpec, x.supSpec)], ["수량", x.listQty, x.supQty, x.qtyDiff]]
        .filter(([, a, b]) => String(a) !== "" || String(b) !== "").map(([l, a, b, d]) => el("div", {}, l + ": " + (a === "" ? "-" : a) + " → " + (b === "" ? "-" : b) + (d ? " (다름)" : "")));
      const marked = substOf(x.orderNo);
      const b = el("button", { class: "quiet" }, marked ? "표시됨" : "대체품 의심으로 표시");
      b.disabled = !!marked;
      b.addEventListener("click", () => { setSubst(x.orderNo, { state: "의심", supItem: x.supItem, supSpec: x.supSpec, supQty: String(x.supQty), note: x.reasons.join(", "), source: "공급사 엑셀" }); persist(); render(); renderSupResult(); });
      return el("tr", {}, el("td", {}, x.orderNo), el("td", {}, ...cmp), el("td", {}, x.reasons.join(", ")), el("td", {}, marked ? SUBST_LABEL[marked.state] : "-"), el("td", {}, b));
    })));
  }

  if (r.vague.length || r.multi.length) {
    parts.push(secHead("확인 필요", r.vague.length + r.multi.length));
    parts.push(atableOf(["주문번호", "품목", "목록의 납기", "공급사가 적은 내용", "왜 확인이 필요한가"], [
      ...r.vague.map(x => el("tr", {}, el("td", {}, x.orderNo), el("td", {}, x.item), el("td", {}, x.from || "(비어 있음)"), el("td", {}, x.dueRaw), el("td", {}, x.why || ""))),
      ...r.multi.map(x => el("tr", {}, el("td", {}, x.orderNo), el("td", {}, x.item), el("td", {}, x.from || "(비어 있음)"), el("td", {}, x.dueRaw), schedCell(x))),
    ]));
  }
  if (r.notInList.length) {
    parts.push(secHead("주문 목록에 없는 주문번호", r.notInList.length));
    parts.push(atableOf(["주문번호", "품목", "공급사가 적은 납기"], r.notInList.map(x => el("tr", {}, el("td", {}, x.orderNo), el("td", {}, x.item), el("td", {}, x.dueRaw)))));
  }
  box.replaceChildren(...parts);
}
// 분납 일정 칸: 날짜순 일정과 수량 합계 확인, 반영 버튼
function schedCell(x) {
  const lines = x.schedule.map((e, i) => el("div", {}, (i + 1) + "차 " + e.date + (e.qty ? " · 수량 " + e.qty : "")));
  const qty = x.qtyMatch === true ? "수량 합계 " + x.qtySum + " = 주문수량 " + x.listQty + " (일치)" : x.qtyMatch === false ? "수량 합계 " + x.qtySum + " ≠ 주문수량 " + x.listQty + " (맞지 않아요)" : "";
  const done = !!S.schedule[x.orderNo];
  const b = el("button", { class: "quiet" }, done ? "반영됨 (다시 반영)" : "분납 일정으로 반영");
  b.addEventListener("click", () => applySchedule(x));
  return el("td", {}, el("div", {}, "분납 일정으로 보여요"), ...lines, ...(qty ? [el("div", { class: x.qtyMatch === false ? "chg" : "sub" }, qty)] : []), b);
}
function applySchedule(x) {
  const dueCol = S.mapping["납기일"], idCol = S.mapping["주문번호"];
  const row = S.rows.find(r => Supplier.idKey(r[idCol]) === Supplier.idKey(x.orderNo));
  if (!row) return;
  const no = row[idCol], last = x.schedule[x.schedule.length - 1].date;
  S.schedule[no] = x.schedule.map(e => ({ date: e.date, qty: e.qty }));
  S.edited[no] = { from: S.edited[no] ? S.edited[no].from : row[dueCol], to: last };
  row[dueCol] = last;
  persist(); compute(); runSupCompare();
  $("supRunStatus").textContent = no + ": 분납 일정을 저장하고 납기를 마지막 입고 예정일(" + last + ")로 바꿨어요. 일정은 주문 상세와 부분 납품 안내문에 들어가요.";
}
function applySupChanges() {
  const dueCol = S.mapping["납기일"], idCol = S.mapping["주문번호"];
  let n = 0;
  S.supRes.changed.filter(x => S.supSel.has(x.orderNo)).forEach(x => {
    const row = S.rows.find(r => Supplier.idKey(r[idCol]) === Supplier.idKey(x.orderNo));
    if (!row) return;
    S.edited[row[idCol]] = { from: row[dueCol], to: x.to };
    row[dueCol] = x.to;
    if (x.note && !S.reasons[row[idCol]]) S.reasons[row[idCol]] = x.note; // 공급사가 적은 메모는 지연 원인 분류에 쓰인다
    n++;
  });
  persist(); compute();
  runSupCompare();
  $("supRunStatus").textContent = n + "건을 목록에 반영했어요. 위의 요약 숫자와 예외 목록이 바뀌었어요.";
}
$("supPick").addEventListener("click", async () => loadSupplier(await window.app.pickSupplierFile()));
$("supSample1").addEventListener("click", async () => { loadSupplier(await window.app.loadSampleSupplier(0)); });
$("supSample2").addEventListener("click", async () => { loadSupplier(await window.app.loadSampleSupplier(1)); });
$("supRun").addEventListener("click", runSupCompare);
$("folderPick").addEventListener("click", async () => loadMails(await window.app.pickMailFolder(), false));
$("folderSample").addEventListener("click", async () => loadMails(await window.app.loadSampleMails(), true));
$("presetFri").addEventListener("click", () => setPreset("lastFriNoon"));
$("preset7").addEventListener("click", () => setPreset("last7"));
$("presetAll").addEventListener("click", () => setPreset("all"));
["mailStart", "mailEnd", "onlyDue"].forEach(id => $(id).addEventListener("change", updateMailSummary));
$("folderRun").addEventListener("click", runFolder);

$("emailBtn").addEventListener("click", () => { $("emailPanel").hidden = !$("emailPanel").hidden; });
const SAMPLE_RULES = "필터=3\n그리스=3\n장갑=3\n고글=3\n볼트=3\n튜브=3"; // 가정: 구하기 쉬운 소모품은 3일, 나머지는 기본 7일
$("q").addEventListener("input", () => { S.q = $("q").value; if (S.result) render(); });
$("q").addEventListener("keydown", e => { if (e.key === "Escape") { $("q").value = ""; S.q = ""; if (S.result) render(); } });
$("rulesBtn").addEventListener("click", () => { $("rulePanel").hidden = !$("rulePanel").hidden; $("rulesMsg").textContent = ""; });
$("rulesClose").addEventListener("click", () => { $("rulePanel").hidden = true; });
$("rulesSample").addEventListener("click", () => { $("rulesText").value = SAMPLE_RULES; });
$("rulesApply").addEventListener("click", () => {
  const text = $("rulesText").value;
  const n = Judge.parseRules(text).length, lines = text.split(/\r?\n/).filter(l => l.trim()).length;
  S.soonRules = text; persist();
  $("rulesMsg").textContent = n + "개 규칙을 적용했어요." + (lines > n ? " (" + (lines - n) + "줄은 '키워드=일수' 형식이 아니라 건너뛰었어요.)" : "");
  if (S.rows.length && !missingRequired().length) compute();
});
// 다시 안내 기준 일수 (FR-18, RU-21-A): 1~30일. 바꾸면 안내 상태와 현황 막대가 바로 다시 계산된다.
function applyReAlert(raw) {
  const msg = $("reAlertMsg");
  const r = Informed.parseDays(raw);
  if (!r.ok) { msg.className = "sub msg-err"; msg.textContent = r.reason; return; }
  S.reAlertDays = r.days; persist();
  $("reAlertDays").value = String(r.days);
  msg.className = "sub msg-ok"; msg.textContent = "마지막 안내 뒤 " + r.days + "일 동안 새 소식이 없으면 '다시 안내'로 표시해요.";
  if (S.result) render();
}
$("reAlertApply").addEventListener("click", () => applyReAlert($("reAlertDays").value));
$("reAlertDays").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyReAlert($("reAlertDays").value); } });
$("reAlertReset").addEventListener("click", () => {
  S.reAlertDays = null; persist(); $("reAlertDays").value = String(Informed.STALE_DAYS);
  $("reAlertMsg").className = "sub msg-ok"; $("reAlertMsg").textContent = "기본값(" + Informed.STALE_DAYS + "일)으로 되돌렸어요.";
  if (S.result) render();
});
$("emailClose").addEventListener("click", () => { $("emailPanel").hidden = true; });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("emailPanel").hidden) $("emailPanel").hidden = true;
  else if (S.selected && S.view === "list" && e.target !== $("q")) closeDetail();
});
$("emailSample").addEventListener("click", () => { $("emailText").value = SAMPLE_EMAIL; });
$("emailRun").addEventListener("click", async () => {
  const text = $("emailText").value, today = $("today").value || localToday();
  if (!text.trim()) { $("emailStatus").textContent = "이메일 내용을 붙여 넣어 주세요."; return; }
  let r;
  {
    const ids = S.mapping["주문번호"] ? S.rows.map(x => x[S.mapping["주문번호"]]) : [];
    r = { ok: true, items: EmailRules.extract(text, today, ids).map(i => ({ ...i, source: "규칙" })) };
  }
  if (!r.ok) { $("emailStatus").textContent = r.error; return; }
  $("emailStatus").textContent = r.items.length + "건을 찾았어요." + (r.truncated ? " (6,000자까지만 읽었어요)" : "") + (S.rows.length ? "" : " 목록을 먼저 불러오면 비교와 반영도 할 수 있어요.");
  renderEmailItems(r.items);
});

$("mainTabs").addEventListener("keydown", e => {                                   // 탭 사이를 좌우 화살표로 (ARIA 탭 패턴)
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const tabs = [...$("mainTabs").querySelectorAll('[role="tab"]')], i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  next.click(); next.focus();
});
$("tabHome").addEventListener("click", () => { S.view = "home"; render(); });
$("tabList").addEventListener("click", () => { S.view = "list"; render(); });
$("tabAna").addEventListener("click", () => { S.view = "ana"; render(); });
$("tabContact").addEventListener("click", () => { S.view = "contact"; render(); });
$("tabReport").addEventListener("click", () => { S.view = "report"; render(); });

let confirmClear = false;
$("clearSaved").addEventListener("click", async () => {
  if (!confirmClear) { confirmClear = true; $("clearSaved").textContent = "정말 지울까요? 한 번 더 누르세요"; return; }
  confirmClear = false; $("clearSaved").textContent = "저장 기록 지우기";
  const cleared = await window.app.clearState();
  if (cleared && cleared.ok === false) { $("savedInfo").textContent = cleared.error; return; }   // 지우지 못했으면 지운 척하지 않는다
  P = Persist.empty(); S.stateNotice = ""; showSaved();
  $("savedInfo").textContent = "저장 기록을 지웠어요. 지금 열려 있는 목록의 변경은 파일을 다시 열면 원래대로 돌아가요.";
});

// ---- 클라우드 저장 (SY-11-M 설정, AU-11-M 로그인, SY-21-A 상태, SY-31-M 옮기기·복원) ----
// 서버와의 통신은 모두 메인 프로세스가 한다. 여기서는 버튼과 안내문만 다룬다. 꺼져 있으면(기본) 아무것도 보내지 않는다.
const CLOUD_NAMES = { informLog: "안내 기록", quickNotes: "빠른 메모", contactLog: "공급사 연락 기록", substChecks: "대체품 확인", scheduleEntries: "분납 일정", orderMeta: "주문 메모", contactMarks: "연락함 표시", settings: "설정" };
let cloudTimer = null, cloud0 = null;                                                    // cloud0 = 가장 최근에 받은 상태 (켜짐 여부를 토글 버튼이 안다)
const cloudWhen = iso => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "아직 없음");
const cloudList = (obj, names) => Object.entries(obj || {}).filter(([, n]) => n > 0).map(([k, n]) => (names[k] || k) + " " + n + "건").join(", ");
async function flushSave() { clearTimeout(saveTimer); return window.app.saveState(snapshot()); }   // 올리기·복원 전에 화면의 최신 기록을 먼저 파일에 쓴다
function cloudBusy(on) { ["cloudUpload", "cloudToggle", "cloudMigrate", "cloudMigrateGo", "cloudRestore", "cloudVerify", "cloudUnlink", "cloudLogout", "cloudLogin", "cloudConfigSave"].forEach(id => { $(id).disabled = on; }); }

// 지금 상태 → 맨 위 큰 문구, 지금 할 일, 단계 표시(끝낸 단계는 접는다). 단계의 상태가 바뀔 때만 열고 닫아서, 사용자가 직접 펼친 것은 그대로 둔다.
const cloudStepState = {};
function cloudStage(st) {
  if (!st.configured) return { step: 1, tone: "neutral", title: "아직 연결하지 않았어요 (이 컴퓨터에만 저장 중)", next: "1단계: 프로젝트 주소와 공개 키를 넣고 저장하세요." };
  if (!st.loggedIn) return { step: 2, tone: "neutral", title: "프로젝트는 연결됐고, 로그인이 필요해요", next: "2단계: 이메일과 비밀번호로 로그인하세요." + (st.ownerBound ? " (이 컴퓨터는 이미 계정 한 개에 묶여 있어요. 그 계정으로 로그인하세요.)" : "") };
  if (!st.enabled) return { step: 3, tone: "warn", title: st.email + " 로 로그인됨 · 클라우드 저장은 꺼져 있어요", next: st.lastSyncedAt ? "'클라우드 저장 켜기'를 누르면 앞으로 기록이 자동으로 올라가요." : "3단계: 아래 '처음 한 번' 에서 '옮길 내용 확인'을 눌러 지금 기록을 옮기세요." };
  if (st.lastError) return { step: 3, tone: "err", title: "서버에 올리지 못했어요 (기록은 이 컴퓨터에 안전해요)", next: st.lastError.indexOf("인터넷") >= 0 ? "인터넷 연결을 확인한 뒤 '지금 올리기'를 누르세요. 연결되면 자동으로도 다시 시도해요." : "'지금 올리기'를 다시 눌러 보세요. 계속 안 되면 이 문구를 알려 주세요: " + st.lastError };
  if (st.pending) return { step: 3, tone: "warn", title: "올릴 기록 " + st.pending + "건을 기다리는 중이에요", next: "잠시 기다리면 자동으로 올라가요. 바로 올리려면 '지금 올리기'를 누르세요." };
  return { step: 4, tone: "ok", title: "모두 올렸어요 · 마지막 " + cloudWhen(st.lastSyncedAt), next: "할 일은 없어요. 기록을 남기면 자동으로 올라가요. 다른 컴퓨터에서 쓰려면 '서버에서 복원'을 누르세요." };
}
function cloudSetStep(id, badgeId, state, label) {                       // state: done | current
  const box = $(id), badge = $(badgeId);
  badge.textContent = state === "done" ? "✓ 완료" : "지금 할 차례"; badge.className = "stepbadge " + state;
  if (cloudStepState[id] !== state) { cloudStepState[id] = state; box.open = state !== "done"; }
}
async function cloudRefresh() {
  const st = await window.app.cloudStatus();
  if (!st || st.ok === false) { $("cloudState").textContent = st && st.error || ""; return; }
  cloud0 = st;
  const info = $("cloudInfo");
  info.hidden = !st.enabled;
  if (st.enabled) {
    info.textContent = st.lastError ? "클라우드: 올리지 못했어요 — " + st.lastError + (st.pending ? " (대기 " + st.pending + "건, 기록은 이 컴퓨터에 안전해요)" : "")
      : st.pending ? "클라우드: 올릴 기록 " + st.pending + "건 대기 중 · 마지막 " + cloudWhen(st.lastSyncedAt) : "클라우드: 모두 올렸어요 · 마지막 " + cloudWhen(st.lastSyncedAt);
  }
  const g = cloudStage(st);
  $("cloudHero").className = "cloudhero tone-" + g.tone; $("cloudHeroTitle").textContent = g.title; $("cloudNext").textContent = g.next;
  const labels = ["① 연결", "② 로그인", "③ 올리기·복원"];
  $("cloudSteps").replaceChildren(...labels.map((t, i) => { const li = document.createElement("li"); li.textContent = (i + 1 < g.step ? "✓ " : "") + t; li.className = i + 1 < g.step ? "done" : i + 1 === g.step ? "current" : ""; return li; }));
  $("cloudLoginBlock").hidden = !st.configured; $("cloudOpsBlock").hidden = !st.loggedIn;
  cloudSetStep("cloudConfigBlock", "cloudBadge1", st.configured ? "done" : "current");
  if (st.configured) cloudSetStep("cloudLoginBlock", "cloudBadge2", st.loggedIn ? "done" : "current");
  if (st.loggedIn) {
    const migrated = st.enabled && !!st.lastSyncedAt;
    cloudSetStep("cloudOpsBlock", "cloudBadge3", "current");
    $("cloudBadge3").textContent = st.enabled ? "켜짐" : "꺼짐";
    const mig = $("cloudMigrateBlock"), mb = $("cloudBadgeMig");
    mb.textContent = migrated ? "✓ 완료" : "지금 할 차례"; mb.className = "stepbadge " + (migrated ? "done" : "current");
    if (cloudStepState.mig !== migrated) { cloudStepState.mig = migrated; mig.open = !migrated; }
  }
  $("cloudConfigMsg").textContent = st.configured ? "저장돼 있어요: " + st.projectUrl : "";
  $("cloudState").textContent = !st.configured ? "상태: 아직 연결 전이에요 (이 컴퓨터에만 저장)" : !st.loggedIn ? "상태: 프로젝트는 연결됐고 로그인이 필요해요" + (st.ownerBound ? " (이 컴퓨터는 이미 계정 한 개에 묶여 있어요)" : "")
    : "상태: " + st.email + " 로 로그인됨 · 클라우드 저장 " + (st.enabled ? "켜짐" : "꺼짐") + " · 올릴 기록 " + st.pending + "건 · 마지막 올림 " + cloudWhen(st.lastSyncedAt) + (st.lastError ? " · 최근 오류: " + st.lastError : "");
  $("cloudToggle").textContent = st.enabled ? "클라우드 저장 끄기" : "클라우드 저장 켜기";
  clearInterval(cloudTimer);
  if (st.enabled) cloudTimer = setInterval(cloudRefresh, 15000);
}
$("cloudBtn").addEventListener("click", () => { $("cloudPanel").hidden = !$("cloudPanel").hidden; if (!$("cloudPanel").hidden) cloudRefresh(); });
$("cloudClose").addEventListener("click", () => { $("cloudPanel").hidden = true; });
$("cloudConfigSave").addEventListener("click", async () => {
  const r = await window.app.cloudConfigure({ url: $("cloudUrl").value, key: $("cloudKey").value });
  $("cloudConfigMsg").textContent = r.ok ? "저장했어요." : r.error;
  if (r.ok) { $("cloudKey").value = ""; await cloudRefresh(); }
});
$("cloudLogin").addEventListener("click", async () => {
  cloudBusy(true); $("cloudLoginMsg").textContent = "로그인하는 중…";
  const r = await window.app.cloudLogin($("cloudEmail").value, $("cloudPassword").value);
  $("cloudPassword").value = ""; cloudBusy(false);
  $("cloudLoginMsg").textContent = r.ok ? "로그인했어요." : r.error;
  await cloudRefresh();
});
$("cloudLogout").addEventListener("click", async () => { await window.app.cloudLogout(); $("cloudLoginMsg").textContent = ""; await cloudRefresh(); });
$("cloudToggle").addEventListener("click", async () => {
  const on = !(cloud0 && cloud0.enabled);
  const r = await window.app.cloudEnable(on);
  $("cloudUnlinkMsg").textContent = r.ok ? "" : r.error;
  if (r.ok && on) { await flushSave(); const u = await window.app.cloudUpload(); if (!u.ok) $("cloudUnlinkMsg").textContent = u.error; }
  await cloudRefresh();
});
$("cloudUpload").addEventListener("click", async () => {
  cloudBusy(true); await flushSave();
  const r = await window.app.cloudUpload();
  cloudBusy(false);
  $("cloudRestoreInfo").textContent = r.ok ? (r.sent ? r.sent + "건을 올렸어요." : "올릴 새 기록이 없어요.") : r.error;
  await cloudRefresh();
});
$("cloudMigrate").addEventListener("click", async () => {
  cloudBusy(true); await flushSave();
  const pv = await window.app.cloudPreview();
  cloudBusy(false);
  if (!pv.ok) { $("cloudMigrateInfo").textContent = pv.error; return; }
  $("cloudMigrateInfo").textContent = pv.total ? "올릴 기록: " + cloudList(pv.counts, Object.fromEntries(Object.entries(pv.labels))) + " (모두 " + pv.total + "건). 이 컴퓨터의 저장 파일을 먼저 백업해요." : "올릴 새 기록이 없어요.";
  $("cloudMigrateGo").hidden = !pv.total; $("cloudMigrateCancel").hidden = !pv.total;
});
$("cloudMigrateCancel").addEventListener("click", () => { $("cloudMigrateGo").hidden = true; $("cloudMigrateCancel").hidden = true; $("cloudMigrateInfo").textContent = "옮기지 않았어요."; });
$("cloudMigrateGo").addEventListener("click", async () => {
  cloudBusy(true); $("cloudMigrateInfo").textContent = "백업하고 옮기는 중…";
  const r = await window.app.cloudMigrate();
  cloudBusy(false); $("cloudMigrateGo").hidden = true; $("cloudMigrateCancel").hidden = true;
  if (!r.ok) { $("cloudMigrateInfo").textContent = (r.backup ? "백업은 " + r.backup + " 에 만들었어요. " : "") + r.error; await cloudRefresh(); return; }
  const diff = Object.entries(r.verify.tables || {}).filter(([, v]) => !v.same).map(([k]) => k);
  $("cloudMigrateInfo").textContent = "백업(" + r.backup + ") 후 " + r.sent + "건을 올렸어요. " + (r.verify.ok ? (r.verify.same ? "컴퓨터와 서버의 건수가 모두 같아요. 클라우드 저장을 켰어요." : "건수가 다른 표가 있어요: " + diff.join(", ")) : "건수 비교는 못 했어요: " + r.verify.error);
  await cloudRefresh();
});
$("cloudRestore").addEventListener("click", async () => {
  cloudBusy(true); await flushSave();
  const r = await window.app.cloudRestore();
  if (r.ok && r.changed) { await initState(); if (S.rows && S.rows.length) { applySaved(); compute(); } }   // 받아 온 기록을 화면에 반영
  cloudBusy(false);
  $("cloudRestoreInfo").textContent = !r.ok ? r.error : r.changed ? "이 컴퓨터에 없던 기록을 가져왔어요: " + cloudList({ ...r.added, ...r.updated }, CLOUD_NAMES) + "." : "가져올 새 기록이 없어요. 이 컴퓨터가 이미 최신이에요.";
  await cloudRefresh();
});
$("cloudVerify").addEventListener("click", async () => {
  cloudBusy(true); await flushSave(); const r = await window.app.cloudVerify(); cloudBusy(false);
  $("cloudRestoreInfo").textContent = !r.ok ? r.error : (r.same ? "컴퓨터의 기록이 모두 서버에 있어요." : "서버에 아직 없는 기록이 있어요. '지금 올리기'를 눌러 주세요.") + " (" + Object.values(r.tables).reduce((a, v) => a + v.local, 0) + "건 / 서버 " + Object.values(r.tables).reduce((a, v) => a + v.remote, 0) + "건)";
});
$("cloudExport").addEventListener("click", async () => {
  await flushSave();
  const r = await window.app.exportState();
  $("cloudExportMsg").textContent = r === null ? "취소했어요." : r.ok ? "저장했어요: " + r.path : r.error;
});
let confirmUnlink = false;
$("cloudUnlink").addEventListener("click", async () => {
  if (!confirmUnlink) { confirmUnlink = true; $("cloudUnlink").textContent = "정말 풀까요? 한 번 더 누르세요"; return; }
  confirmUnlink = false; $("cloudUnlink").textContent = "연결 풀기";
  const r = await window.app.cloudUnlink();
  $("cloudUnlinkMsg").textContent = r.ok ? "풀었어요. 서버와 이 컴퓨터의 기록은 그대로예요." : r.error;
  await cloudRefresh();
});
cloudRefresh();

$("today").value = localToday();
initState();
