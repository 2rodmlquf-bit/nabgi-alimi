// 저장 모델 v2와 화면용 뷰(view)의 변환. 디스크·DB와 무관한 순수 함수라서 로컬 파일 저장소와 (나중의) Supabase 저장소가 똑같이 쓴다.
//
// 뷰(view)  = 화면이 쓰는 모양 (v1과 같다): { edited, reasons, causeOverride, notice, contacted, contactLog, informed, quickNotes, subst, schedule, soonRules, reAlertDays }
//             저장소가 붙인 id·createdAt이 기록(안내 기록, 빠른 메모, 공급사 연락 기록, 분납 일정)에 들어 있고, **삭제된 것은 보이지 않는다.**
// 상태(state) = 저장하는 v2 모양 (docs/DATA_MODEL.md, docs/erd.md):
//   { schemaVersion: 2, savedAt,
//     informLog:    { 주문번호: [{ id, date, channel, status, due, note, createdAt, deletedAt?, deletedReason? }] },   // append-only
//     quickNotes:   { 주문번호: [{ id, text, createdAt, deletedAt?, deletedReason? }] },
//     orderMeta:    { 주문번호: { reason?, causeOverride?, edited?{from,to}, updatedAt } },                              // 현재 값 (최신이 이김)
//     settings:     { notice, soonRules, reAlertDays?, updatedAt },
//     contactLog:   { 공급사: [{ id, date, kind, channel, promised, note, createdAt, deletedAt?, deletedReason? }] },   // v2에서 새로 id·삭제 표시를 얻음
//     contactMarks: { 공급사: { date, updatedAt } },                                                                      // 연락함 표시 (현재 값)
//     substChecks:  { 주문번호: [{ id, state, note, supItem, supSpec, supQty, source, date, createdAt, deletedAt?, deletedReason? }] },  // 상태가 바뀔 때마다 새 행
//     scheduleEntries: { 주문번호: [{ id, date, qty, createdAt, deletedAt?, deletedReason? }] },
//     cloudLink:    { enabled, project, ownerUserId, linkedAt, lastSyncedAt } }                                           // 화면이 모르는 영역 (클라우드 연결 정보)
//
// 삭제 표시(deletedAt)에는 이유(deletedReason)가 붙는다: "user" = 사용자가 취소, "cap" = 주문(공급사)당 한도로 밀림.
// 화면은 기록을 취소할 때 목록에서 빼기만 한다. 그 차이를 fromView가 알아채서 "지운 것"이 아니라 "삭제 표시"로 남긴다.
// 그래서 화면 코드를 바꾸지 않고도 삭제 흔적이 남고, 나중에 DB로 동기화할 때 삭제를 전달할 수 있다.
const { randomUUID } = require("crypto");
const P = require("../persist");

const SCHEMA_VERSION = 2;
const MAX_LIVE = 50;            // 주문당 살아 있는 안내 기록·빠른 메모 (예전과 같은 제한)
const CAPS = { informLog: 50, quickNotes: 50, contactLog: 200, substChecks: 20, scheduleEntries: 20 };   // 목록마다 살아 있는 기록 상한
const MAX_TOMBSTONES = 100;     // 목록마다 삭제 표시 보관 수
const MAX_CHARS = 2000000;      // 저장 글자 수 상한 (예전과 같은 제한)
const CHANNELS = ["메일", "카톡·문자", "전화", "구두", "기타"];
const STATUSES = ["지연", "임박", "확인필요"];
const SUBST_STATES = ["의심", "확인요청중", "승인", "거절"];
const REASONS = ["user", "cap"];
const PROJECTS = ["practice", "work"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const plain = o => !!o && typeof o === "object" && !Array.isArray(o);
const str = (v, max) => (typeof v === "string" ? (max ? v.slice(0, max) : v) : "");
const noon = date => date + "T12:00:00.000Z";           // 기록한 날짜의 정오 (실제 시각을 모를 때)

const emptyLink = () => ({ enabled: false, project: "", ownerUserId: "", linkedAt: "", lastSyncedAt: "" });
const emptyState = () => ({
  schemaVersion: SCHEMA_VERSION, savedAt: "", informLog: {}, quickNotes: {}, orderMeta: {},
  settings: { notice: null, soonRules: null, updatedAt: "" },
  contactLog: {}, contactMarks: {}, substChecks: {}, scheduleEntries: {},
  cloudLink: emptyLink(),
});

// 저장 파일의 버전. 0 = 버전 표시가 없는 예전 파일, 1·2 = 그 버전, "future" = 이 앱보다 새로운 버전, "invalid" = 파일 모양이 아님
function detectVersion(obj) {
  if (!plain(obj)) return "invalid";
  if (!("schemaVersion" in obj)) return 0;
  const v = obj.schemaVersion;
  if (!Number.isInteger(v) || v < 1) return "invalid";
  return v <= SCHEMA_VERSION ? v : "future";
}

// 목록의 상한을 지킨다. 살아 있는 기록이 넘치면 오래된 것부터 삭제 표시("cap", now가 없으면 그냥 버린다), 삭제 표시는 최근 것만 남긴다.
function capLog(list, now, maxLive = MAX_LIVE) {
  let out = list.slice();
  const liveIdx = out.map((e, i) => (e.deletedAt ? -1 : i)).filter(i => i >= 0);
  const excess = liveIdx.length - maxLive;
  if (excess > 0) {
    const old = new Set(liveIdx.slice(0, excess));
    out = now ? out.map((e, i) => (old.has(i) ? { ...e, deletedAt: now, deletedReason: "cap" } : e)) : out.filter((e, i) => !old.has(i));
  }
  const tombIdx = out.map((e, i) => (e.deletedAt ? i : -1)).filter(i => i >= 0);
  if (tombIdx.length > MAX_TOMBSTONES) {
    const drop = new Set(tombIdx.slice(0, tombIdx.length - MAX_TOMBSTONES));
    out = out.filter((e, i) => !drop.has(i));
  }
  return out;
}

// 삭제 표시가 있으면 이유를 붙인다. 이유가 없거나 모르는 값이면 "user" (예전 파일의 삭제 표시는 이유를 몰랐다).
const tomb = (e, r) => {
  const at = str(e.deletedAt, 40);
  if (at) { r.deletedAt = at; r.deletedReason = REASONS.includes(e.deletedReason) ? e.deletedReason : "user"; }
  return r;
};
const idOk = e => plain(e) && !!str(e.id, 64);

function normalizeInform(e) {
  if (!idOk(e) || !ISO_DATE.test(e.date || "") || !STATUSES.includes(e.status)) return null;
  return tomb(e, { id: str(e.id, 64), date: e.date, channel: CHANNELS.includes(e.channel) ? e.channel : "기타", status: e.status, due: str(e.due, 40), note: str(e.note, 200), createdAt: str(e.createdAt, 40) });
}
function normalizeNote(e) {
  if (!idOk(e) || !str(e.text)) return null;
  return tomb(e, { id: str(e.id, 64), text: str(e.text, 300), createdAt: str(e.createdAt, 40) });
}
function normalizeContact(e) {
  if (!idOk(e) || !ISO_DATE.test(e.date || "") || (e.kind !== "attempt" && e.kind !== "reply")) return null;
  return tomb(e, { id: str(e.id, 64), date: e.date, kind: e.kind, channel: str(e.channel, 10) || "기타", promised: ISO_DATE.test(e.promised || "") ? e.promised : "", note: str(e.note, 200), createdAt: str(e.createdAt, 40) });
}
function normalizeSubst(e) {
  if (!idOk(e) || !SUBST_STATES.includes(e.state)) return null;
  return tomb(e, { id: str(e.id, 64), state: e.state, note: str(e.note, 120), supItem: str(e.supItem, 120), supSpec: str(e.supSpec, 120), supQty: str(e.supQty, 120), source: str(e.source, 120), date: ISO_DATE.test(e.date || "") ? e.date : "", createdAt: str(e.createdAt, 40) });
}
function normalizeSched(e) {
  if (!idOk(e) || !ISO_DATE.test(e.date || "")) return null;
  return tomb(e, { id: str(e.id, 64), date: e.date, qty: str(e.qty, 20), createdAt: str(e.createdAt, 40) });
}
function normalizeLink(l) {
  const base = emptyLink();
  if (!plain(l)) return base;
  return { enabled: l.enabled === true, project: PROJECTS.includes(l.project) ? l.project : base.project, ownerUserId: str(l.ownerUserId, 64), linkedAt: str(l.linkedAt, 40), lastSyncedAt: str(l.lastSyncedAt, 40) };
}

// v2 상태를 검증한다: 깨진 기록은 버리고, 모르는 필드는 버리고, 상한을 지킨다. 이미 정상인 상태는 그대로 돌려준다 (멱등).
function normalizeState(obj) {
  const s = emptyState();
  if (!plain(obj)) return s;
  s.savedAt = str(obj.savedAt, 40);
  const lists = (src, norm, maxLive) => {
    const out = {};
    if (plain(src)) Object.entries(src).forEach(([key, arr]) => {
      if (!Array.isArray(arr)) return;
      const ok = capLog(arr.map(norm).filter(Boolean), null, maxLive);
      if (ok.length) out[key] = ok;
    });
    return out;
  };
  s.informLog = lists(obj.informLog, normalizeInform, CAPS.informLog);
  s.quickNotes = lists(obj.quickNotes, normalizeNote, CAPS.quickNotes);
  s.contactLog = lists(obj.contactLog, normalizeContact, CAPS.contactLog);
  s.substChecks = lists(obj.substChecks, normalizeSubst, CAPS.substChecks);
  s.scheduleEntries = lists(obj.scheduleEntries, normalizeSched, CAPS.scheduleEntries);
  if (plain(obj.contactMarks)) Object.entries(obj.contactMarks).forEach(([sup, m]) => {
    if (plain(m) && ISO_DATE.test(m.date || "")) s.contactMarks[sup] = { date: m.date, updatedAt: str(m.updatedAt, 40) };
  });
  if (plain(obj.orderMeta)) Object.entries(obj.orderMeta).forEach(([no, m]) => {
    if (!plain(m)) return;
    const meta = {};
    if (typeof m.reason === "string" && m.reason) meta.reason = m.reason;
    if (typeof m.causeOverride === "string" && m.causeOverride) meta.causeOverride = m.causeOverride;
    if (plain(m.edited) && typeof m.edited.from === "string" && typeof m.edited.to === "string") meta.edited = { from: m.edited.from, to: m.edited.to };
    if (!Object.keys(meta).length) return;
    meta.updatedAt = str(m.updatedAt, 40);
    s.orderMeta[no] = meta;
  });
  if (plain(obj.settings)) {
    const c = P.clean({ notice: obj.settings.notice, soonRules: obj.settings.soonRules, reAlertDays: obj.settings.reAlertDays });
    s.settings = { notice: c.notice, soonRules: c.soonRules, ...(c.reAlertDays ? { reAlertDays: c.reAlertDays } : {}), updatedAt: str(obj.settings.updatedAt, 40) };
  }
  s.cloudLink = normalizeLink(obj.cloudLink);
  return s;
}

const liveOf = list => (list || []).filter(e => !e.deletedAt);
const substView = e => ({ state: e.state, note: e.note, supItem: e.supItem, supSpec: e.supSpec, supQty: e.supQty, source: e.source, date: e.date });

// 상태 → 화면용 뷰. 삭제된 기록은 빼고, 살아 있는 기록에는 id·createdAt을 붙여 준다. 대체품 확인은 가장 최근의 살아 있는 상태 하나만 보인다.
function toView(state) {
  const st = normalizeState(state);
  const v = P.empty();
  Object.entries(st.informLog).forEach(([no, list]) => {
    const live = liveOf(list).map(e => ({ id: e.id, date: e.date, channel: e.channel, status: e.status, due: e.due, note: e.note, createdAt: e.createdAt }));
    if (live.length) v.informed[no] = live;
  });
  Object.entries(st.quickNotes).forEach(([no, list]) => {
    const live = liveOf(list).map(e => ({ id: e.id, text: e.text, createdAt: e.createdAt }));
    if (live.length) v.quickNotes[no] = live;
  });
  Object.entries(st.contactLog).forEach(([sup, list]) => {
    const live = liveOf(list).map(e => ({ id: e.id, date: e.date, kind: e.kind, channel: e.channel, promised: e.promised, note: e.note, createdAt: e.createdAt }));
    if (live.length) v.contactLog[sup] = live;
  });
  Object.entries(st.contactMarks).forEach(([sup, m]) => { v.contacted[sup] = m.date; });
  Object.entries(st.substChecks).forEach(([no, list]) => {
    const live = liveOf(list);
    if (live.length) v.subst[no] = substView(live[live.length - 1]);
  });
  Object.entries(st.scheduleEntries).forEach(([no, list]) => {
    const live = liveOf(list).map(e => ({ date: e.date, qty: e.qty, id: e.id, createdAt: e.createdAt }));
    if (live.length) v.schedule[no] = live;
  });
  Object.entries(st.orderMeta).forEach(([no, m]) => {
    if (m.reason) v.reasons[no] = m.reason;
    if (m.causeOverride) v.causeOverride[no] = m.causeOverride;
    if (m.edited) v.edited[no] = { from: m.edited.from, to: m.edited.to };
  });
  v.notice = st.settings.notice; v.soonRules = st.settings.soonRules;
  if (st.settings.reAlertDays) v.reAlertDays = st.settings.reAlertDays;
  return P.clean(v);
}

// 이전 상태와 비교해 기록 목록을 합친다: 뷰에서 빠진 살아 있는 기록은 삭제 표시("user"), 새 기록은 build가 만든 모양으로 id를 붙여 추가, 넘치면 오래된 것이 "cap".
// 화면에서 방금 만든 기록은 id가 없고, 화면은 id를 모른 채 같은 기록을 거듭 보낸다. 그래서 id가 없으면 내용(과 만든 시각이 있으면 그것)이
// 같은 기존 기록을 찾아 그 기록으로 본다. 저장할 때마다 새 기록이 생기고 이전 기록에 삭제 표시가 붙는 일을 막는다.
function mergeList(prevList, viewList, now, newId, build, maxLive) {
  const sig = e => JSON.stringify(build(e));
  const prevLive = prevList.filter(e => !e.deletedAt);
  const prevIds = new Set(prevLive.map(e => e.id));
  const bySig = new Map();
  prevLive.forEach(e => { const k = sig(e); (bySig.get(k) || bySig.set(k, []).get(k)).push(e); });
  const keep = new Set(), fresh = [];
  viewList.forEach(v => {
    if (v.id && prevIds.has(v.id)) { keep.add(v.id); return; }            // 이미 있는 기록 (기록은 고치지 않는다)
    const found = (bySig.get(sig(v)) || []).find(e => !keep.has(e.id) && (!v.createdAt || e.createdAt === v.createdAt));
    if (found) keep.add(found.id); else fresh.push(v);
  });
  const out = prevList.map(e => (!e.deletedAt && !keep.has(e.id) ? { ...e, deletedAt: now, deletedReason: "user" } : e));
  fresh.forEach(v => out.push({ id: newId(), ...build(v), createdAt: v.createdAt || now }));
  return capLog(out, now, maxLive);
}
const buildInform = v => ({ date: v.date, channel: v.channel, status: v.status, due: v.due, note: v.note });
const buildNote = v => ({ text: v.text });
const buildContact = v => ({ date: v.date, kind: v.kind, channel: v.channel, promised: v.promised, note: v.note });
const buildSched = v => ({ date: v.date, qty: v.qty });
const buildSubst = v => ({ state: v.state, note: v.note, supItem: v.supItem, supSpec: v.supSpec, supQty: v.supQty, source: v.source, date: v.date });

const metaKey = m => JSON.stringify([m.reason || "", m.causeOverride || "", m.edited ? [m.edited.from, m.edited.to] : null]);

// 뷰 → 상태. prevState가 있으면 그것과 비교해 id·createdAt·updatedAt·deletedAt을 이어 간다. cloudLink는 화면이 모르므로 그대로 이어 간다.
function fromView(rawView, prevState, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const newId = opts.newId || randomUUID;
  const view = P.clean(rawView, { cap: false });                           // 상한은 아래에서 직접 적용한다 (넘친 것이 "cap"으로 남도록)
  const prev = prevState ? normalizeState(prevState) : emptyState();
  const s = emptyState();
  s.savedAt = now;
  s.cloudLink = prev.cloudLink;

  const merge = (key, viewMap, build) => {
    new Set([...Object.keys(prev[key]), ...Object.keys(viewMap)]).forEach(k => {
      const merged = mergeList(prev[key][k] || [], viewMap[k] || [], now, newId, build, CAPS[key]);
      if (merged.length) s[key][k] = merged;
    });
  };
  merge("informLog", view.informed, buildInform);
  merge("quickNotes", view.quickNotes, buildNote);
  merge("contactLog", view.contactLog, buildContact);
  merge("scheduleEntries", view.schedule, buildSched);

  // 대체품 확인: 값이 바뀔 때마다 새 행(이력). 뷰에서 빠지면 그 주문의 살아 있는 행을 모두 삭제 표시한다.
  new Set([...Object.keys(prev.substChecks), ...Object.keys(view.subst)]).forEach(no => {
    const prevList = prev.substChecks[no] || [];
    const live = liveOf(prevList), latest = live[live.length - 1], cur = view.subst[no];
    let out = prevList;
    if (!cur) out = prevList.map(e => (e.deletedAt ? e : { ...e, deletedAt: now, deletedReason: "user" }));
    else if (!latest || JSON.stringify(buildSubst(latest)) !== JSON.stringify(buildSubst(cur))) out = capLog(prevList.concat({ id: newId(), ...buildSubst(cur), createdAt: now }), now, CAPS.substChecks);
    if (out.length) s.substChecks[no] = out;
  });

  Object.entries(view.contacted).forEach(([sup, date]) => {
    if (!ISO_DATE.test(date || "")) return;
    const p = prev.contactMarks[sup];
    s.contactMarks[sup] = { date, updatedAt: p && p.date === date ? p.updatedAt : now };
  });

  new Set([...Object.keys(view.reasons), ...Object.keys(view.causeOverride), ...Object.keys(view.edited)]).forEach(no => {
    const m = {};
    if (view.reasons[no]) m.reason = view.reasons[no];
    if (view.causeOverride[no]) m.causeOverride = view.causeOverride[no];
    if (view.edited[no]) m.edited = { from: view.edited[no].from, to: view.edited[no].to };
    if (!Object.keys(m).length) return;
    const p = prev.orderMeta[no];
    m.updatedAt = p && metaKey(p) === metaKey(m) ? p.updatedAt : now;
    s.orderMeta[no] = m;
  });

  const st = { notice: view.notice || null, soonRules: typeof view.soonRules === "string" ? view.soonRules : null, ...(view.reAlertDays ? { reAlertDays: view.reAlertDays } : {}) };
  const sameSettings = JSON.stringify([prev.settings.notice, prev.settings.soonRules, prev.settings.reAlertDays || null]) === JSON.stringify([st.notice, st.soonRules, st.reAlertDays || null]);
  s.settings = { ...st, updatedAt: sameSettings ? prev.settings.updatedAt : now };
  return s;
}

// 버전 표시가 없는 예전(v0) 저장본을 v2로 바꾼다. 기록의 createdAt은 기록한 날짜의 정오로 둔다 (실제 시각을 모른다).
function migrateV0toV2(raw, opts = {}) {
  const view = P.clean(raw);
  Object.values(view.informed).forEach(list => list.forEach(e => { e.createdAt = noon(e.date); }));
  Object.values(view.contactLog).forEach(list => list.forEach(e => { e.createdAt = noon(e.date); }));
  return fromView(view, null, opts);
}

// v1 저장본을 v2로 바꾼다. 안내 기록·빠른 메모·주문 메타·설정은 같은 모양이라 그대로 잇고(id 유지, 예전 삭제 표시는 이유 "user"),
// 공급사 연락 기록·연락함 표시·대체품·분납 일정(v1의 legacy)에는 id와 만든 시각(기록한 날짜의 정오, 모르면 저장 시각)을 붙인다.
function migrateV1toV2(raw, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const newId = opts.newId || randomUUID;
  const r = plain(raw) ? raw : {};
  const s = normalizeState({ ...r, schemaVersion: SCHEMA_VERSION });
  s.savedAt = now;
  const saved = str(r.savedAt, 40) || now;
  const l = P.clean(plain(r.legacy) ? r.legacy : {});
  Object.entries(l.contactLog).forEach(([sup, list]) => { s.contactLog[sup] = list.map(e => ({ id: newId(), ...buildContact(e), createdAt: noon(e.date) })); });
  Object.entries(l.contacted).forEach(([sup, date]) => { if (ISO_DATE.test(date)) s.contactMarks[sup] = { date, updatedAt: noon(date) }; });
  Object.entries(l.subst).forEach(([no, v]) => { s.substChecks[no] = [{ id: newId(), ...buildSubst(v), createdAt: v.date ? noon(v.date) : saved }]; });
  Object.entries(l.schedule).forEach(([no, list]) => { s.scheduleEntries[no] = list.map(e => ({ id: newId(), ...buildSched(e), createdAt: saved })); });
  return s;
}

const exceedsLimit = state => JSON.stringify(state).length > MAX_CHARS;
const WARN_RATIO = 0.8;            // 저장 공간이 이만큼 차면 미리 알린다

module.exports = { SCHEMA_VERSION, MAX_LIVE, CAPS, MAX_TOMBSTONES, MAX_CHARS, WARN_RATIO, emptyState, detectVersion, normalizeState, toView, fromView, migrateV0toV2, migrateV1toV2, exceedsLimit };
