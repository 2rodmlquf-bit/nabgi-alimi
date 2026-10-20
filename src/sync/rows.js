// 로컬 저장 상태(v2) <-> DB 행. 디스크·네트워크와 무관한 순수 함수라서 규칙을 모두 시험으로 고정한다 (docs/erd.md, supabase/README.md의 DB 규칙).
//
//  toRows(state)      -> { 표이름: [{ key, row }] }   올릴 행 전체. user_id는 보내지 않는다(DB가 채운다).
//  plan(tables, ledger) -> 올릴 일 목록(대기열). ledger = 지난번에 올린 행의 지문 { 표: { 키: 지문 } }
//  fromRows(remote)   -> 상태 모양 (복원에 쓴다)
//
// "대기열"은 따로 쌓아 두지 않고 계산한다: 지금 상태의 행 지문과 ledger를 비교하면 아직 못 올린 것이 나온다.
// 그래서 앱이 꺼져도, 올리다 실패해도 어긋나지 않고, 같은 일을 다시 해도 결과가 같다(멱등).
const Core = require("../store/core");

const APPEND = ["inform_logs", "quick_notes", "substitute_checks", "schedule_entries", "supplier_contact_logs", "order_replies"];   // 쌓는 기록: 넣기 + 삭제 표시만
const CURRENT = ["order_meta", "supplier_contact_marks", "user_settings"];                                          // 현재 값: 최신 updated_at이 이긴다
const TABLES = [...APPEND, ...CURRENT];
const CONFLICT = { order_meta: "user_id,order_no", supplier_contact_marks: "user_id,supplier_name", user_settings: "user_id" };
const LABEL = { inform_logs: "안내 기록", quick_notes: "빠른 메모", substitute_checks: "대체품 확인", schedule_entries: "분납 일정", supplier_contact_logs: "공급사 연락 기록", order_replies: "공급사 회신", order_meta: "주문 메모(사유·납기 변경)", supplier_contact_marks: "연락함 표시", user_settings: "설정" };

const noon = d => d + "T12:00:00.000Z";
const iso = v => { const t = new Date(v); return isNaN(t) ? "" : t.toISOString(); };
const nul = v => (v === "" || v == null ? null : v);
const fp = row => JSON.stringify(row);

// 어느 표든 공통인 삭제 표시 열 (모든 행이 같은 키를 가져야 묶음으로 보낼 수 있다)
const del = e => ({ deleted_at: e.deletedAt || null, deleted_reason: e.deletedAt ? e.deletedReason || "user" : null });

const BUILD = {
  inform_logs: (no, e) => ({ id: e.id, order_no: no, logged_on: e.date, channel: e.channel, status: e.status, due: e.due || "", note: e.note || "", created_at: e.createdAt || noon(e.date), ...del(e) }),
  quick_notes: (no, e) => ({ id: e.id, order_no: no, body: e.text, created_at: e.createdAt || new Date(0).toISOString(), ...del(e) }),
  substitute_checks: (no, e) => ({ id: e.id, order_no: no, state: e.state, note: e.note || "", sup_item: e.supItem || "", sup_spec: e.supSpec || "", sup_qty: e.supQty || "", source: e.source || "", checked_on: nul(e.date), created_at: e.createdAt || new Date(0).toISOString(), ...del(e) }),
  schedule_entries: (no, e) => ({ id: e.id, order_no: no, arrives_on: e.date, qty: e.qty || "", created_at: e.createdAt || noon(e.date), ...del(e) }),
  supplier_contact_logs: (sup, e) => ({ id: e.id, supplier_name: sup, logged_on: e.date, kind: e.kind, channel: e.channel || "기타", promised_on: nul(e.promised), note: e.note || "", created_at: e.createdAt || noon(e.date), ...del(e) }),
  order_replies: (no, e) => ({ id: e.id, order_no: no, supplier_name: e.supplier || "(알 수 없음)", replied_on: e.date, promised_on: nul(e.promised), channel: e.channel, source: e.source || "manual", note: e.note || "", created_at: e.createdAt || noon(e.date), ...del(e) }),
};
const SRC = { inform_logs: "informLog", quick_notes: "quickNotes", substitute_checks: "substChecks", schedule_entries: "scheduleEntries", supplier_contact_logs: "contactLog", order_replies: "orderReplies" };

function toRows(state) {
  const s = Core.normalizeState(state);
  const out = Object.fromEntries(TABLES.map(t => [t, []]));
  for (const t of APPEND) for (const [k, list] of Object.entries(s[SRC[t]])) for (const e of list) out[t].push({ key: e.id, row: BUILD[t](k, e) });
  for (const [no, m] of Object.entries(s.orderMeta)) {
    out.order_meta.push({ key: no, row: { order_no: no, reason: nul(m.reason), cause_override: nul(m.causeOverride), edited_from: m.edited ? nul(m.edited.from) : null, edited_to: m.edited ? nul(m.edited.to) : null, updated_at: m.updatedAt || s.savedAt || new Date(0).toISOString() } });
  }
  for (const [sup, m] of Object.entries(s.contactMarks)) out.supplier_contact_marks.push({ key: sup, row: { supplier_name: sup, last_contacted_on: m.date, updated_at: m.updatedAt || s.savedAt || new Date(0).toISOString() } });
  if (s.settings.updatedAt) {                                                         // 한 번도 바꾸지 않은 설정은 올리지 않는다
    const data = {};
    if (s.settings.notice) data.notice = s.settings.notice;
    if (typeof s.settings.soonRules === "string") data.soonRules = s.settings.soonRules;
    if (s.settings.reAlertDays) data.reAlertDays = s.settings.reAlertDays;
    out.user_settings.push({ key: "settings", row: { data, updated_at: s.settings.updatedAt } });
  }
  return out;
}

// 올릴 일: inserts(쌓는 기록 새 행), tombstones(이미 올린 행에 삭제 표시가 생긴 것), upserts(현재 값 표).
function plan(tables, ledger = {}) {
  const p = { inserts: {}, tombstones: {}, upserts: {}, counts: {}, total: 0 };
  for (const t of TABLES) {
    const led = ledger[t] || {};
    p.counts[t] = 0;
    for (const { key, row } of tables[t] || []) {
      const f = fp(row), prev = led[key];
      if (prev === f) continue;
      if (APPEND.includes(t)) {
        if (prev === undefined) (p.inserts[t] = p.inserts[t] || []).push({ key, row, fp: f });
        else if (row.deleted_at) (p.tombstones[t] = p.tombstones[t] || []).push({ key, row: { id: row.id, deleted_at: row.deleted_at, deleted_reason: row.deleted_reason }, fp: f });
        else continue;                                                                // 쌓는 기록은 다른 열이 바뀌지 않는다
      } else (p.upserts[t] = p.upserts[t] || []).push({ key, row, fp: f });
      p.counts[t]++; p.total++;
    }
  }
  return p;
}

// 같은 키를 가진 행끼리 묶는다 (PostgREST 묶음 보내기는 한 묶음 안에서 열이 같아야 한다)
function chunk(list, size) { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; }

// ---- DB -> 상태 (복원) ----
const day = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const group = (rows, by, map) => { const g = {}; for (const r of rows || []) (g[r[by]] = g[r[by]] || []).push(map(r)); return g; };
const tail = r => ({ createdAt: iso(r.created_at), ...(r.deleted_at ? { deletedAt: iso(r.deleted_at), deletedReason: r.deleted_reason || "user" } : {}) });

function fromRows(remote) {
  const s = Core.emptyState();
  s.informLog = group(remote.inform_logs, "order_no", r => ({ id: r.id, date: day(r.logged_on), channel: r.channel, status: r.status, due: r.due || "", note: r.note || "", ...tail(r) }));
  s.quickNotes = group(remote.quick_notes, "order_no", r => ({ id: r.id, text: r.body, ...tail(r) }));
  s.substChecks = group(remote.substitute_checks, "order_no", r => ({ id: r.id, state: r.state, note: r.note || "", supItem: r.sup_item || "", supSpec: r.sup_spec || "", supQty: r.sup_qty || "", source: r.source || "", date: day(r.checked_on), ...tail(r) }));
  s.scheduleEntries = group(remote.schedule_entries, "order_no", r => ({ id: r.id, date: day(r.arrives_on), qty: r.qty || "", ...tail(r) }));
  s.contactLog = group(remote.supplier_contact_logs, "supplier_name", r => ({ id: r.id, date: day(r.logged_on), kind: r.kind, channel: r.channel || "기타", promised: day(r.promised_on), note: r.note || "", ...tail(r) }));
  s.orderReplies = group(remote.order_replies, "order_no", r => ({ id: r.id, date: day(r.replied_on), promised: day(r.promised_on), channel: r.channel, source: r.source || "manual", note: r.note || "", supplier: r.supplier_name === "(알 수 없음)" ? "" : r.supplier_name || "", ...tail(r) }));
  for (const r of remote.order_meta || []) {
    const m = { updatedAt: iso(r.updated_at) };
    if (r.reason) m.reason = r.reason;
    if (r.cause_override) m.causeOverride = r.cause_override;
    if (r.edited_from || r.edited_to) m.edited = { from: r.edited_from || "", to: r.edited_to || "" };
    s.orderMeta[r.order_no] = m;
  }
  for (const r of remote.supplier_contact_marks || []) s.contactMarks[r.supplier_name] = { date: day(r.last_contacted_on), updatedAt: iso(r.updated_at) };
  const st = (remote.user_settings || [])[0];
  if (st && st.data && typeof st.data === "object") s.settings = { notice: st.data.notice || null, soonRules: typeof st.data.soonRules === "string" ? st.data.soonRules : null, ...(st.data.reAlertDays ? { reAlertDays: st.data.reAlertDays } : {}), updatedAt: iso(st.updated_at) };
  return Core.normalizeState(s);                                                      // 깨진 행은 여기서 버려진다
}

module.exports = { APPEND, CURRENT, TABLES, CONFLICT, LABEL, toRows, plan, chunk, fromRows, fp };
