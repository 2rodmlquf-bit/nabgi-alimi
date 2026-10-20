// QA용 시험 데이터를 넣는다. 사용: node supabase/qa/seed.js
// 사용자가 직접 QA할 수 있도록 계정 A에는 여러 종류의 기록을, 계정 B에는 일부러 적은 기록을 넣는다(서로 안 보이는지 확인하려고).
// 모두 주문번호 QA-PO-…, 공급사 QA… 로 시작하는 가상 데이터다. 같은 id를 쓰므로 여러 번 실행해도 중복되지 않는다.
const { users, api, signIn, stableUuid } = require("./lib");

const id = s => stableUuid("nabgi-qa-seed:" + s);
const day = (offset) => new Date(Date.UTC(2026, 9, 12) + offset * 86400000).toISOString().slice(0, 10);
const at = (dayOffset, hh = 9) => new Date(Date.UTC(2026, 9, 12 + dayOffset, hh - 9, 0, 0)).toISOString();   // 한국 시각 hh시

function dataFor(who) {
  if (who === "b") {
    return {
      inform_logs: [
        { key: "b1", order_no: "QA-PO-9001", logged_on: day(0), channel: "메일", status: "지연", due: "2026-09-30", note: "B의 기록 (A에게는 안 보여야 함)", created_at: at(0) },
        { key: "b2", order_no: "QA-PO-9002", logged_on: day(0), channel: "전화", status: "임박", due: "2026-10-14", note: "B의 기록 2", created_at: at(0, 10) },
        { key: "b3", order_no: "QA-PO-9003", logged_on: day(0), channel: "구두", status: "확인필요", due: "", note: "납기 확인 중", created_at: at(0, 11) },
      ],
      quick_notes: [{ key: "b1", order_no: "QA-PO-9001", body: "B의 메모 (A에게는 안 보여야 함)", created_at: at(0) }],
      user_settings: { data: { reAlertDays: 10, note: "B의 설정" } },
    };
  }
  return {
    inform_logs: [
      { key: "a1", order_no: "QA-PO-1001", logged_on: day(-2), channel: "전화", status: "지연", due: "2026-09-24", note: "전화로 안내", created_at: at(-2) },
      { key: "a2", order_no: "QA-PO-1001", logged_on: day(0), channel: "메일", status: "지연", due: "2026-09-24", note: "통관 지연으로 다시 안내", created_at: at(0) },
      { key: "a3", order_no: "QA-PO-1002", logged_on: day(-7), channel: "메일", status: "임박", due: "2026-10-14", note: "임박 사전 안내", created_at: at(-7) },
      { key: "a4", order_no: "QA-PO-1002", logged_on: day(0), channel: "카톡·문자", status: "지연", due: "2026-10-14", note: "임박 안내 뒤 지연이 되어 다시 안내", created_at: at(0, 10) },
      { key: "a5", order_no: "QA-PO-1003", logged_on: day(-1), channel: "구두", status: "확인필요", due: "", note: "납기를 읽을 수 없어 확인 중이라고 안내", created_at: at(-1) },
      { key: "a6", order_no: "QA-PO-1004", logged_on: day(-3), channel: "기타", status: "지연", due: "2026-10-01", note: "취소한 기록 (삭제 표시: user)", created_at: at(-3), deleted_at: at(-3, 12), deleted_reason: "user" },
      { key: "a7", order_no: "QA-PO-1005", logged_on: day(-30), channel: "메일", status: "지연", due: "2026-09-01", note: "한도로 밀린 오래된 기록 (삭제 표시: cap)", created_at: at(-30), deleted_at: at(0, 8), deleted_reason: "cap" },
      { key: "a8", order_no: "QA-PO-1005", logged_on: day(0), channel: "메일", status: "지연", due: "2026-09-01", note: "한글 😀 \"따옴표\" 시험", created_at: at(0, 12) },
    ],
    quick_notes: [
      { key: "a1", order_no: "QA-PO-1002", body: "전화로 들음: 통관 서류 보완 중, 10월 말 예상 😀", created_at: at(-1) },
      { key: "a2", order_no: "QA-PO-1002", body: "공급사가 내일 다시 연락 준다고 함", created_at: at(0) },
      { key: "a3", order_no: "QA-PO-1005", body: "메신저로 선적 지연 소식", created_at: at(0, 13) },
    ],
    order_meta: [
      { order_no: "QA-PO-1001", reason: "통관 서류 보완", cause_override: "통관·서류", updated_at: new Date().toISOString() },
      { order_no: "QA-PO-1002", reason: "공급사 발주 지연", updated_at: new Date().toISOString() },
      { order_no: "QA-PO-1005", edited_from: "2026-09-01", edited_to: "2026-10-30", reason: "공급사 회신으로 납기 변경", updated_at: new Date().toISOString() },
    ],
    substitute_checks: [
      { key: "a1", order_no: "QA-PO-1004", state: "의심", note: "규격이 다른 것 같다는 회신", sup_spec: "6204-2RS", created_at: at(-2) },
      { key: "a2", order_no: "QA-PO-1004", state: "승인", note: "연구원 승인 받음", sup_item: "산업용 베어링 6204-2RS", sup_spec: "6204-2RS", sup_qty: "10", source: "QA 시험", checked_on: day(0), created_at: at(0) },
    ],
    schedule_entries: [
      { key: "a1", order_no: "QA-PO-1004", arrives_on: "2026-10-20", qty: "4", created_at: at(0) },
      { key: "a2", order_no: "QA-PO-1004", arrives_on: "2026-10-30", qty: "6", created_at: at(0) },
    ],
    supplier_contact_logs: [
      { key: "a1", supplier_name: "QA가온산업", logged_on: day(-3), kind: "attempt", channel: "메일", note: "납기 문의", created_at: at(-3) },
      { key: "a2", supplier_name: "QA가온산업", logged_on: day(-1), kind: "attempt", channel: "전화", note: "무응답", created_at: at(-1) },
      { key: "a3", supplier_name: "QA가온산업", logged_on: day(0), kind: "reply", channel: "전화", promised_on: day(5), note: "구두로 10월 17일까지 보낸다고 함", created_at: at(0) },
      { key: "a4", supplier_name: "QA나래테크", logged_on: day(0), kind: "attempt", channel: "메일", note: "재문의", created_at: at(0) },
    ],
    supplier_contact_marks: [
      { supplier_name: "QA가온산업", last_contacted_on: day(0), updated_at: new Date().toISOString() },
      { supplier_name: "QA나래테크", last_contacted_on: day(0), updated_at: new Date().toISOString() },
    ],
    user_settings: { data: { reAlertDays: 5, notice: { template: "공지형", signature: "구매팀 QA" }, soonRules: "필터=3\n그리스=3" } },
  };
}

async function seed(who, tag) {
  const U = users()[who];
  const S = await signIn(U.email, U.password);
  const d = dataFor(who);
  const counts = {};
  for (const [table, rows] of Object.entries(d)) {
    if (table === "user_settings") {
      const r = await api("/rest/v1/user_settings?on_conflict=user_id", { method: "POST", token: S.token, headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: { ...rows, updated_at: new Date().toISOString() } });
      if (r.status >= 300) throw new Error(tag + " user_settings 실패 " + r.status + " " + r.text.slice(0, 150));
      counts[table] = 1; continue;
    }
    if (table === "order_meta" || table === "supplier_contact_marks") {
      const conflict = table === "order_meta" ? "user_id,order_no" : "user_id,supplier_name";
      const groups = new Map();
      rows.forEach(row => { const k = Object.keys(row).sort().join(","); (groups.get(k) || groups.set(k, []).get(k)).push(row); });
      for (const group of groups.values()) {
        const r = await api("/rest/v1/" + table + "?on_conflict=" + conflict, { method: "POST", token: S.token, headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: group });
        if (r.status >= 300) throw new Error(tag + " " + table + " 실패 " + r.status + " " + r.text.slice(0, 150));
      }
      counts[table] = rows.length; continue;
    }
    const body = rows.map(({ key, ...rest }) => ({ id: id(who + ":" + table + ":" + key), ...rest }));
    // PostgREST는 한 번에 보내는 행들의 열이 모두 같아야 한다 → 열 구성이 같은 행끼리 묶어서 보낸다
    const groups = new Map();
    body.forEach(row => { const k = Object.keys(row).sort().join(","); (groups.get(k) || groups.set(k, []).get(k)).push(row); });
    for (const group of groups.values()) {
      const r = await api("/rest/v1/" + table, { method: "POST", token: S.token, headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: group });
      if (r.status >= 300) throw new Error(tag + " " + table + " 실패 " + r.status + " " + r.text.slice(0, 150));
    }
    counts[table] = rows.length;
  }
  return counts;
}

(async () => {
  for (const [who, tag] of [["a", "A"], ["b", "B"]]) {
    const c = await seed(who, tag);
    console.log("계정 " + tag + " 시험 데이터: " + Object.entries(c).map(([t, n]) => t + " " + n).join(", "));
  }
  console.log("\n끝. 같은 id라서 다시 실행해도 중복되지 않아요. 지우려면 supabase/qa/cleanup.sql을 보세요.");
})().catch(e => { console.error("실패:", e.message); process.exit(1); });
