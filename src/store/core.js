// 저장 모델 v1과 화면용 뷰(view)의 변환. 디스크·DB와 무관한 순수 함수라서 로컬 파일 저장소와 (나중의) Supabase 저장소가 똑같이 쓴다.
//
// 뷰(view)  = 화면이 쓰는 모양: { edited, reasons, causeOverride, notice, contacted, contactLog, informed, quickNotes, subst, schedule, soonRules }
//             안내 기록(informed)·빠른 메모(quickNotes)에는 저장소가 붙인 id·createdAt이 들어 있고, **삭제된 것은 보이지 않는다.**
// 상태(state) = 저장하는 v1 모양 (docs/DATA_MODEL.md):
//   { schemaVersion: 1, savedAt,
//     informLog:  { 주문번호: [{ id, date, channel, status, due, note, createdAt, deletedAt? }] },   // append-only, 취소는 deletedAt 표시
//     quickNotes: { 주문번호: [{ id, text, createdAt, deletedAt? }] },                               // 빠른 메모 (Phase 3, FR-12). 취소와 같은 방식으로 삭제 표시
//     orderMeta:  { 주문번호: { reason?, causeOverride?, edited?{from,to}, updatedAt } },
//     settings:   { notice, soonRules, updatedAt },
//     legacy:     { contacted, contactLog, subst, schedule } }                                        // 범위 밖 기능: 구조를 바꾸지 않고 보존
//
// 화면은 안내 기록·메모를 취소/삭제할 때 목록에서 빼기만 한다. 그 차이를 fromView가 알아채서 "지운 것"이 아니라 "삭제 표시(deletedAt)"로 남긴다.
// 그래서 화면 코드를 바꾸지 않고도 삭제 흔적이 남고, 나중에 DB로 동기화할 때 삭제를 전달할 수 있다.
const { randomUUID } = require("crypto");
const P = require("../persist");

const SCHEMA_VERSION = 1;
const MAX_LIVE = 50;            // 주문당 살아 있는 안내 기록 (예전과 같은 제한)
const MAX_TOMBSTONES = 100;     // 주문당 삭제 표시 보관 수
const MAX_CHARS = 2000000;      // 저장 글자 수 상한 (예전과 같은 제한)
const CHANNELS = ["메일", "카톡·문자", "전화", "구두", "기타"];
const STATUSES = ["지연", "임박", "확인필요"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const plain = o => !!o && typeof o === "object" && !Array.isArray(o);
const str = (v, max) => (typeof v === "string" ? (max ? v.slice(0, max) : v) : "");

const emptyState = () => ({
  schemaVersion: SCHEMA_VERSION, savedAt: "", informLog: {}, quickNotes: {}, orderMeta: {},
  settings: { notice: null, soonRules: null, updatedAt: "" },
  legacy: { contacted: {}, contactLog: {}, subst: {}, schedule: {} },
});

// 저장 파일의 버전. 0 = 버전 표시가 없는 예전 파일, 1 = 현재, "future" = 이 앱보다 새로운 버전, "invalid" = 파일 모양이 아님
function detectVersion(obj) {
  if (!plain(obj)) return "invalid";
  if (!("schemaVersion" in obj)) return 0;
  const v = obj.schemaVersion;
  if (!Number.isInteger(v) || v < 1) return "invalid";
  return v === SCHEMA_VERSION ? 1 : v > SCHEMA_VERSION ? "future" : "invalid";
}

// 목록의 상한을 지킨다. 살아 있는 기록이 넘치면 오래된 것부터 삭제 표시(now가 없으면 그냥 버린다), 삭제 표시는 최근 것만 남긴다.
function capLog(list, now) {
  let out = list.slice();
  const liveIdx = out.map((e, i) => (e.deletedAt ? -1 : i)).filter(i => i >= 0);
  const excess = liveIdx.length - MAX_LIVE;
  if (excess > 0) {
    const old = new Set(liveIdx.slice(0, excess));
    out = now ? out.map((e, i) => (old.has(i) ? { ...e, deletedAt: now } : e)) : out.filter((e, i) => !old.has(i));
  }
  const tombIdx = out.map((e, i) => (e.deletedAt ? i : -1)).filter(i => i >= 0);
  if (tombIdx.length > MAX_TOMBSTONES) {
    const drop = new Set(tombIdx.slice(0, tombIdx.length - MAX_TOMBSTONES));
    out = out.filter((e, i) => !drop.has(i));
  }
  return out;
}

function normalizeInform(e) {
  if (!plain(e) || !str(e.id, 64) || !ISO_DATE.test(e.date || "") || !STATUSES.includes(e.status)) return null;
  const r = { id: str(e.id, 64), date: e.date, channel: CHANNELS.includes(e.channel) ? e.channel : "기타", status: e.status, due: str(e.due, 40), note: str(e.note, 200), createdAt: str(e.createdAt, 40) };
  if (str(e.deletedAt, 40)) r.deletedAt = str(e.deletedAt, 40);
  return r;
}
function normalizeNote(e) {
  if (!plain(e) || !str(e.id, 64) || !str(e.text)) return null;
  const r = { id: str(e.id, 64), text: str(e.text, 300), createdAt: str(e.createdAt, 40) };
  if (str(e.deletedAt, 40)) r.deletedAt = str(e.deletedAt, 40);
  return r;
}

// v1 상태를 검증한다: 깨진 기록은 버리고, 모르는 필드는 버리고, 상한을 지킨다. 이미 정상인 상태는 그대로 돌려준다 (멱등).
function normalizeState(obj) {
  const s = emptyState();
  if (!plain(obj)) return s;
  s.savedAt = str(obj.savedAt, 40);
  const lists = (src, norm, cap) => {
    const out = {};
    if (plain(src)) Object.entries(src).forEach(([no, arr]) => {
      if (!Array.isArray(arr)) return;
      const ok = cap(arr.map(norm).filter(Boolean));
      if (ok.length) out[no] = ok;
    });
    return out;
  };
  s.informLog = lists(obj.informLog, normalizeInform, l => capLog(l, null));
  s.quickNotes = lists(obj.quickNotes, normalizeNote, l => capLog(l, null));
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
    const c = P.clean({ notice: obj.settings.notice, soonRules: obj.settings.soonRules });
    s.settings = { notice: c.notice, soonRules: c.soonRules, updatedAt: str(obj.settings.updatedAt, 40) };
  }
  const l = P.clean(plain(obj.legacy) ? obj.legacy : {});
  s.legacy = { contacted: l.contacted, contactLog: l.contactLog, subst: l.subst, schedule: l.schedule };
  return s;
}

// 상태 → 화면용 뷰. 삭제된 기록은 빼고, 살아 있는 안내 기록에는 id·createdAt을 붙여 준다.
function toView(state) {
  const st = normalizeState(state);
  const v = P.empty();
  Object.entries(st.informLog).forEach(([no, list]) => {
    const live = list.filter(e => !e.deletedAt).map(e => ({ id: e.id, date: e.date, channel: e.channel, status: e.status, due: e.due, note: e.note, createdAt: e.createdAt }));
    if (live.length) v.informed[no] = live;
  });
  Object.entries(st.quickNotes).forEach(([no, list]) => {
    const live = list.filter(e => !e.deletedAt).map(e => ({ id: e.id, text: e.text, createdAt: e.createdAt }));
    if (live.length) v.quickNotes[no] = live;
  });
  Object.entries(st.orderMeta).forEach(([no, m]) => {
    if (m.reason) v.reasons[no] = m.reason;
    if (m.causeOverride) v.causeOverride[no] = m.causeOverride;
    if (m.edited) v.edited[no] = { from: m.edited.from, to: m.edited.to };
  });
  v.notice = st.settings.notice; v.soonRules = st.settings.soonRules;
  Object.assign(v, st.legacy);
  return P.clean(v);
}

// 이전 상태와 비교해 기록 목록(안내 기록, 빠른 메모)을 합친다: 뷰에서 빠진 살아 있는 기록은 삭제 표시, 새 기록은 build가 만든 모양으로 id를 붙여 추가.
function mergeList(prevList, viewList, now, newId, build) {
  const sig = e => JSON.stringify([build(e), e.createdAt || ""]);
  const prevLive = new Set(prevList.filter(e => !e.deletedAt).map(e => e.id));
  // 화면에서 방금 만든 기록은 아직 id가 없다. 이미 저장된 같은 내용·같은 시각의 기록이 있으면 그 기록으로 본다 (저장할 때마다 새로 만들지 않는다).
  const bySig = new Map();
  prevList.filter(e => !e.deletedAt).forEach(e => { const k = sig(e); (bySig.get(k) || bySig.set(k, []).get(k)).push(e.id); });
  const keep = new Set(), fresh = [];
  viewList.forEach(v => {
    if (v.id && prevLive.has(v.id)) { keep.add(v.id); return; }                // 이미 있는 기록 (기록은 고치지 않는다)
    const ids = !v.id && v.createdAt ? (bySig.get(sig(v)) || []).filter(i => !keep.has(i)) : [];
    if (ids.length) keep.add(ids[0]); else fresh.push(v);
  });
  const out = prevList.map(e => (!e.deletedAt && !keep.has(e.id) ? { ...e, deletedAt: now } : e));
  fresh.forEach(v => out.push({ id: newId(), ...build(v), createdAt: v.createdAt || now }));
  return capLog(out, now);
}
const buildInform = v => ({ date: v.date, channel: v.channel, status: v.status, due: v.due, note: v.note });
const buildNote = v => ({ text: v.text });

const metaKey = m => JSON.stringify([m.reason || "", m.causeOverride || "", m.edited ? [m.edited.from, m.edited.to] : null]);

// 뷰 → 상태. prevState가 있으면 그것과 비교해 id·createdAt·updatedAt·deletedAt을 이어 간다.
function fromView(rawView, prevState, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const newId = opts.newId || randomUUID;
  const view = P.clean(rawView);
  const prev = prevState ? normalizeState(prevState) : emptyState();
  const s = emptyState();
  s.savedAt = now;

  new Set([...Object.keys(prev.informLog), ...Object.keys(view.informed)]).forEach(no => {
    const merged = mergeList(prev.informLog[no] || [], view.informed[no] || [], now, newId, buildInform);
    if (merged.length) s.informLog[no] = merged;
  });
  new Set([...Object.keys(prev.quickNotes), ...Object.keys(view.quickNotes)]).forEach(no => {
    const merged = mergeList(prev.quickNotes[no] || [], view.quickNotes[no] || [], now, newId, buildNote);
    if (merged.length) s.quickNotes[no] = merged;
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

  const st = { notice: view.notice || null, soonRules: typeof view.soonRules === "string" ? view.soonRules : null };
  const sameSettings = JSON.stringify([prev.settings.notice, prev.settings.soonRules]) === JSON.stringify([st.notice, st.soonRules]);
  s.settings = { ...st, updatedAt: sameSettings ? prev.settings.updatedAt : now };

  s.legacy = { contacted: view.contacted, contactLog: view.contactLog, subst: view.subst, schedule: view.schedule };
  return s;
}

// 버전 표시가 없는 예전(v0) 저장본을 v1로 바꾼다. 안내 기록의 createdAt은 기록한 날짜의 정오로 둔다 (실제 시각을 모른다).
function migrateV0toV1(raw, opts = {}) {
  const view = P.clean(raw);
  Object.values(view.informed).forEach(list => list.forEach(e => { e.createdAt = e.date + "T12:00:00.000Z"; }));
  return fromView(view, null, opts);
}

const exceedsLimit = state => JSON.stringify(state).length > MAX_CHARS;

module.exports = { SCHEMA_VERSION, MAX_LIVE, MAX_TOMBSTONES, MAX_CHARS, emptyState, detectVersion, normalizeState, toView, fromView, migrateV0toV1, exceedsLimit };
