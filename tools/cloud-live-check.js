// 진짜 Supabase(연습용 프로젝트)에 앱의 올리기·복원 엔진을 그대로 돌려 보는 점검. 사용: node tools/cloud-live-check.js
// 필요: supabase/qa/qa-config.local.json, qa-users.local.json (supabase/qa/README.md의 준비 순서). 시험 계정 A·B로만 로그인한다.
// 넣는 기록은 모두 이름이 QA-LIVE- 로 시작해서 supabase/qa/cleanup.sql 로 한 번에 지울 수 있다. 가상 데이터만 쓴다.
const { MemoryStore } = require("../src/store/memoryStore");
const { createSync } = require("../src/sync/engine");
const { clean } = require("../src/persist");
const lib = require("../supabase/qa/lib");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); };
const ent = (date, note, x = {}) => ({ date, channel: "전화", status: "지연", due: "2026-09-24", note, ...x });

function machine(users, who) {
  const store = new MemoryStore({ holder: { text: null } });
  const mem = { meta: null, session: null };
  const persist = { loadMeta: async () => mem.meta, saveMeta: async m => { mem.meta = JSON.parse(JSON.stringify(m)); }, loadSession: async () => mem.session, saveSession: async s => { mem.session = s; }, backup: async () => "(메모리)" };
  const sync = createSync({ store, persist, autoUpload: false });
  return { store, sync, who, users };
}

(async () => {
  const c = lib.config(), U = lib.users();
  const A = machine(U, "a");
  console.log("프로젝트:", c.url);
  check("공개 키 검사를 통과한다", (await A.sync.configure({ url: c.url, key: c.key })).ok);
  const bad = await A.sync.login(U.a.email, "틀린-비밀번호");
  check("틀린 비밀번호는 한국어 안내로 거부된다", !bad.ok && /맞지 않아요/.test(bad.error), bad.error);
  check("로그인한다", (await A.sync.login(U.a.email, U.a.password)).ok);

  const view = { ...clean(null),
    informed: { "QA-LIVE-1": [ent("2026-10-10", "첫째"), ent("2026-10-11", "둘째", { channel: "메일", status: "임박" })], "QA-LIVE-2": [ent("2026-10-12", "다른 주문", { status: "확인필요", due: "" })] },
    quickNotes: { "QA-LIVE-1": [{ text: "전화로 들음" }] }, reasons: { "QA-LIVE-1": "통관 서류 보완" }, causeOverride: { "QA-LIVE-1": "통관·서류" }, edited: { "QA-LIVE-1": { from: "2026-09-24", to: "2026-10-23" } },
    contacted: { "QA-LIVE-가온": "2026-10-12" }, contactLog: { "QA-LIVE-가온": [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "2026-10-20", note: "연락함" }, { date: "2026-10-13", kind: "reply", channel: "전화", promised: "", note: "" }] },
    subst: { "QA-LIVE-1": { state: "의심", note: "규격 다름", supItem: "A-1", supSpec: "", supQty: "", source: "메일", date: "2026-10-12" } }, schedule: { "QA-LIVE-1": [{ date: "2026-10-30", qty: "3" }] },
    soonRules: "필터=3", notice: { template: "공지형", alt: "", signature: "QA" } };
  await A.store.save(view);

  const pv = await A.sync.preview();
  check("올릴 건수를 미리 계산한다 (표 8개 모두)", pv.ok && Object.values(pv.counts).every(n => n > 0), JSON.stringify(pv.counts));
  const m = await A.sync.migrate();
  check("처음 옮기기: 올리기 성공", m.ok, m.error || "보낸 " + m.sent + "건");
  check("건수 비교가 같다", m.ok && m.verify.same, m.ok ? JSON.stringify(Object.fromEntries(Object.entries(m.verify.tables).map(([k, v]) => [k, v.remote + "/" + v.local]))) : "");
  const again = await A.sync.upload();
  check("다시 올려도 보낼 것이 없다 (멱등)", again.ok && again.sent === 0);

  // 지우기 + 값 바꾸기 → 삭제 표시와 갱신만 간다
  const v2 = (await A.store.load()).view; v2.informed["QA-LIVE-1"].shift(); v2.reasons["QA-LIVE-1"] = "바뀐 사유"; await A.store.save(v2);
  const up2 = await A.sync.upload();
  check("지운 기록은 삭제 표시로, 바뀐 값은 갱신으로 올라간다", up2.ok && up2.sent === 2, "보낸 " + up2.sent + "건 " + (up2.error || ""));

  // 새 컴퓨터(B 아님, 같은 계정)에서 복원
  const A2 = machine(U, "a");
  await A2.sync.configure({ url: c.url, key: c.key }); await A2.sync.login(U.a.email, U.a.password);
  const rs = await A2.sync.restore();
  check("복원: 성공", rs.ok, rs.error || JSON.stringify(rs.added));
  const back = (await A2.store.load()).view;
  const mine = Object.keys(back.informed).filter(k => k.startsWith("QA-LIVE-"));
  check("복원: 지운 기록은 안 돌아오고 나머지는 돌아온다 (안내 2건)", mine.length === 2 && back.informed["QA-LIVE-1"].length === 1 && back.informed["QA-LIVE-1"][0].note === "둘째" && back.informed["QA-LIVE-2"][0].status === "확인필요");
  const parts = { 사유: back.reasons["QA-LIVE-1"], 납기변경: back.edited["QA-LIVE-1"] && back.edited["QA-LIVE-1"].to, 연락함: back.contacted["QA-LIVE-가온"], 연락기록: (back.contactLog["QA-LIVE-가온"] || []).length, 약속일: (back.contactLog["QA-LIVE-가온"] || []).map(e => e.promised).sort().pop(), 대체품: back.subst["QA-LIVE-1"] && back.subst["QA-LIVE-1"].state, 분납: back.schedule["QA-LIVE-1"] && back.schedule["QA-LIVE-1"][0].qty, 설정: back.soonRules };
  check("복원: 값(사유·납기 변경·연락함·연락 기록·대체품·분납·설정)이 같다", back.reasons["QA-LIVE-1"] === "바뀐 사유" && back.edited["QA-LIVE-1"].to === "2026-10-23" && back.contacted["QA-LIVE-가온"] === "2026-10-12"
    && back.contactLog["QA-LIVE-가온"].length === 2 && parts.약속일 === "2026-10-20" && back.subst["QA-LIVE-1"].state === "의심" && back.schedule["QA-LIVE-1"][0].qty === "3" && back.soonRules === "필터=3", JSON.stringify(parts));
  check("복원: 한 번 더 해도 변화가 없다", (await A2.sync.restore()).changed === 0);

  // 계정 격리
  const B = machine(U, "b");
  await B.sync.configure({ url: c.url, key: c.key }); await B.sync.login(U.b.email, U.b.password);
  const rb = await B.sync.restore();
  check("다른 계정(B)은 A의 기록을 받지 못한다", rb.ok && !Object.keys((await B.store.load()).view.informed).some(k => k.startsWith("QA-LIVE-")));

  // 서버가 거부하는 값 (글자 수 제한 등)은 화면 규칙보다 DB 규칙이 더 엄격할 때를 본다: 채널 값은 앱이 이미 정규화하므로 정상 경로로는 거부가 없다
  console.log("\n" + (failed ? failed + "개 실패" : "모두 통과") + "  (넣은 기록은 이름이 QA-LIVE- 로 시작해요. supabase/qa/cleanup.sql 참고)");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("점검 중 오류:", e.message); process.exit(2); });
