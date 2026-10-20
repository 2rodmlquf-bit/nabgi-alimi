// Supabase DB 자동 시험. 사용: node supabase/qa/db-tests.js
// 앱이 쓸 것과 같은 길(로그인 → REST API → RLS·제약·트리거)로, 시험 계정 A·B가 실제로 읽고 쓰며 규칙이 지켜지는지 확인한다.
// 시험 행은 주문번호가 QA-T-<실행번호>-… 로 시작하고, 끝에 삭제 표시를 한다(DB는 지우기를 막으므로 행은 남는다).
const { users, api, signIn, uuid } = require("./lib");

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "  PASS " : "  FAIL ") + name + (detail ? "  (" + detail + ")" : "")); };
const code = r => (r.json && r.json.code) || "";
const denied = r => (r.status === 401 || r.status === 403) && code(r) === "42501";
const bad = r => r.status === 400 && code(r) === "23514";               // 제약(check) 위반
const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

(async () => {
  const U = users();
  const A = await signIn(U.a.email, U.a.password), B = await signIn(U.b.email, U.b.password);
  const run = Date.now().toString(36);
  const ORD = n => "QA-T-" + run + "-" + n;
  const SUP = "QA-T-" + run + "-공급사";
  const log = (o = {}) => ({ id: uuid(), order_no: ORD("1"), logged_on: "2026-10-12", channel: "메일", status: "지연", due: "2026-09-24", note: "QA 시험", created_at: nowIso(), ...o });
  const ins = (table, token, body, prefer = "return=representation") => api("/rest/v1/" + table, { method: "POST", token, headers: { Prefer: prefer }, body });
  const get = (table, token, query) => api("/rest/v1/" + table + "?" + query, { token });
  const patch = (table, token, query, body) => api("/rest/v1/" + table + "?" + query, { method: "PATCH", token, headers: { Prefer: "return=representation" }, body });
  console.log("시험 실행 번호:", run, "\n");
  const origSettings = (await get("user_settings", A.token, "select=data")).json[0];   // 시험이 설정을 바꾸므로 끝에서 원래대로 돌려 놓는다

  console.log("[로그인 안 한 요청]");
  let r = await get("inform_logs", null, "select=id&limit=1");
  check("로그인하지 않으면 안내 기록을 읽을 수 없다", denied(r), r.status + " " + code(r));
  r = await ins("inform_logs", null, log());
  check("로그인하지 않으면 안내 기록을 쓸 수 없다", denied(r), r.status + " " + code(r));
  r = await get("user_settings", null, "select=user_id");
  check("로그인하지 않으면 설정도 읽을 수 없다", denied(r), r.status + " " + code(r));

  console.log("\n[안내 기록: 쓰기와 본인만 보기]");
  const row1 = log();
  r = await ins("inform_logs", A.token, row1);
  check("A가 안내 기록을 남긴다 (user_id를 보내지 않았다)", r.status === 201 && r.json && r.json[0] && r.json[0].user_id === A.userId, r.status + " " + (r.json && r.json[0] ? "user_id 자동" : r.text.slice(0, 100)));
  r = await get("inform_logs", A.token, "select=id,note&id=eq." + row1.id);
  check("A는 자기 기록을 읽는다", r.status === 200 && r.json.length === 1);
  r = await get("inform_logs", B.token, "select=id&id=eq." + row1.id);
  check("B는 A의 기록을 볼 수 없다 (0건)", r.status === 200 && r.json.length === 0);
  r = await get("inform_logs", B.token, "select=id&order_no=like." + ORD("") + "*");
  check("B가 전체를 조회해도 A의 시험 기록은 안 보인다", r.status === 200 && r.json.length === 0);
  r = await ins("inform_logs", B.token, log({ user_id: A.userId }));
  check("B가 A의 이름(user_id)으로 기록을 넣으려 하면 거부된다", denied(r), r.status + " " + code(r));
  r = await ins("inform_logs", A.token, log({ user_id: B.userId }));
  check("A가 B의 이름으로 넣으려 해도 거부된다", denied(r), r.status + " " + code(r));

  console.log("\n[올리기를 두 번 해도 한 건 (멱등)]");
  r = await ins("inform_logs", A.token, row1, "resolution=ignore-duplicates,return=minimal");
  const again = await get("inform_logs", A.token, "select=id&id=eq." + row1.id);
  check("같은 id를 다시 올려도 중복이 생기지 않는다", r.status < 300 && again.json.length === 1, "올리기 " + r.status + ", 행 " + again.json.length);
  r = await ins("inform_logs", A.token, row1);
  check("그냥 다시 넣으면 충돌(409)로 알려 준다", r.status === 409 && code(r) === "23505", r.status + " " + code(r));

  console.log("\n[append-only: 고치기·지우기 금지, 삭제 표시만 허용]");
  r = await patch("inform_logs", A.token, "id=eq." + row1.id, { note: "고쳐 봄" });
  check("안내 기록의 메모를 고칠 수 없다", denied(r), r.status + " " + code(r));
  r = await api("/rest/v1/inform_logs?id=eq." + row1.id, { method: "DELETE", token: A.token });
  const still = await get("inform_logs", A.token, "select=id&id=eq." + row1.id);
  check("안내 기록을 지울 수 없고 행은 그대로다", denied(r) && still.json.length === 1, r.status + " " + code(r));
  r = await patch("inform_logs", A.token, "id=eq." + row1.id, { deleted_at: nowIso() });
  check("삭제 시각만 넣고 이유를 빼면 거부된다 (짝 제약)", bad(r), r.status + " " + code(r));
  r = await patch("inform_logs", A.token, "id=eq." + row1.id, { deleted_at: nowIso(), deleted_reason: "x" });
  check("삭제 이유에 엉뚱한 값을 넣으면 거부된다", bad(r), r.status + " " + code(r));
  const row2 = log({ order_no: ORD("2") });
  await ins("inform_logs", A.token, row2, "return=minimal");
  r = await patch("inform_logs", B.token, "id=eq." + row2.id, { deleted_at: nowIso(), deleted_reason: "user" });
  const intact = await get("inform_logs", A.token, "select=deleted_at&id=eq." + row2.id);
  check("B는 A의 기록에 삭제 표시를 할 수 없다 (0건 바뀜)", r.status === 200 && r.json.length === 0 && intact.json[0].deleted_at === null);
  r = await patch("inform_logs", A.token, "id=eq." + row2.id, { deleted_at: nowIso(), deleted_reason: "user" });
  check("A는 자기 기록을 취소(삭제 표시, 이유 user)할 수 있다", r.status === 200 && r.json.length === 1 && r.json[0].deleted_reason === "user");
  r = await patch("inform_logs", A.token, "id=eq." + row1.id, { deleted_at: nowIso(), deleted_reason: "cap" });
  check("한도로 밀림(cap)도 같은 방식으로 표시된다", r.status === 200 && r.json[0].deleted_reason === "cap");

  console.log("\n[값 규칙 (제약)]");
  r = await ins("inform_logs", A.token, log({ channel: "문자" }));
  check("모르는 채널은 거부된다", bad(r), r.status + " " + code(r));
  r = await ins("inform_logs", A.token, log({ note: "가".repeat(201) }));
  check("안내 메모 201자는 거부된다", bad(r), r.status + " " + code(r));
  r = await ins("inform_logs", A.token, log({ note: "가".repeat(200), order_no: ORD("len") }), "return=minimal");
  check("안내 메모 200자는 들어간다", r.status === 201, String(r.status));
  r = await ins("inform_logs", A.token, log({ status: "확인필요", order_no: ORD("chk") }), "return=minimal");
  check("상태 '확인필요' 기록이 들어간다 (계획서 초안이 빠뜨렸던 값)", r.status === 201, String(r.status));
  r = await ins("inform_logs", A.token, log({ status: "정상" }));
  check("상태에 '정상'은 거부된다 (지연·임박·확인필요만)", bad(r), r.status + " " + code(r));
  r = await ins("inform_logs", A.token, log({ order_no: "" }));
  check("빈 주문번호는 거부된다", bad(r), r.status + " " + code(r));
  const kor = "한글 😀 \"따옴표\" 줄바꿈\n두 번째 줄";
  const korRow = log({ order_no: ORD("kor"), note: kor });
  await ins("inform_logs", A.token, korRow, "return=minimal");
  r = await get("inform_logs", A.token, "select=note&id=eq." + korRow.id);
  check("한글·이모지·줄바꿈이 그대로 저장되고 읽힌다", r.json && r.json[0] && r.json[0].note === kor);
  const stamp = "2026-10-12T05:30:00.123+00:00";
  const stRow = log({ order_no: ORD("ts"), created_at: stamp });
  await ins("inform_logs", A.token, stRow, "return=minimal");
  r = await get("inform_logs", A.token, "select=created_at&id=eq." + stRow.id);
  check("앱이 정한 만든 시각(createdAt)이 그대로 보존된다", r.json && r.json[0] && new Date(r.json[0].created_at).getTime() === new Date(stamp).getTime());

  console.log("\n[빠른 메모 · 대체품 · 분납 · 공급사 연락]");
  r = await ins("quick_notes", A.token, { id: uuid(), order_no: ORD("n"), body: "가".repeat(300) }, "return=minimal");
  check("빠른 메모 300자는 들어간다", r.status === 201, String(r.status));
  r = await ins("quick_notes", A.token, { id: uuid(), order_no: ORD("n"), body: "가".repeat(301) });
  check("빠른 메모 301자는 거부된다", bad(r), r.status + " " + code(r));
  r = await ins("substitute_checks", A.token, { id: uuid(), order_no: ORD("s"), state: "승인", sup_item: "6204-2RS" }, "return=minimal");
  check("대체품 확인(승인)이 들어간다", r.status === 201, String(r.status));
  r = await ins("substitute_checks", A.token, { id: uuid(), order_no: ORD("s"), state: "모름" });
  check("대체품 상태에 엉뚱한 값은 거부된다", bad(r), r.status + " " + code(r));
  r = await ins("schedule_entries", A.token, { id: uuid(), order_no: ORD("p"), arrives_on: "2026-10-30", qty: "4" }, "return=minimal");
  check("분납 일정이 들어간다", r.status === 201, String(r.status));
  r = await ins("schedule_entries", A.token, { id: uuid(), order_no: ORD("p"), arrives_on: "2026-13-45", qty: "4" });
  check("잘못된 날짜(13월 45일)는 거부된다", r.status === 400, r.status + " " + code(r));
  r = await ins("supplier_contact_logs", A.token, { id: uuid(), supplier_name: SUP, logged_on: "2026-10-12", kind: "attempt", channel: "메일" }, "return=minimal");
  check("공급사 연락 기록(attempt)이 들어간다", r.status === 201, String(r.status));
  r = await ins("supplier_contact_logs", A.token, { id: uuid(), supplier_name: SUP, logged_on: "2026-10-12", kind: "call" });
  check("연락 종류에 엉뚱한 값은 거부된다", bad(r), r.status + " " + code(r));

  console.log("\n[현재 값 표: 최신이 이긴다]");
  const meta = (reason, updated_at) => ({ order_no: ORD("m"), reason, updated_at });
  const up = (table, token, body, conflict) => api("/rest/v1/" + table + "?on_conflict=" + conflict, { method: "POST", token, headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body });
  const metaNow = async () => (await get("order_meta", A.token, "select=reason&order_no=eq." + ORD("m"))).json;
  r = await up("order_meta", A.token, meta("v2", nowIso(-1000)), "user_id,order_no");
  check("주문 메타를 처음 저장한다", r.status < 300 && (await metaNow())[0].reason === "v2", String(r.status));
  await up("order_meta", A.token, meta("오래된값", nowIso(-60000)), "user_id,order_no");
  check("더 오래된 시각으로 덮어쓰려 하면 무시된다", (await metaNow())[0].reason === "v2");
  await up("order_meta", A.token, meta("v3", nowIso()), "user_id,order_no");
  check("더 새로운 시각이면 덮어쓴다", (await metaNow())[0].reason === "v3");
  r = await get("order_meta", B.token, "select=reason&order_no=eq." + ORD("m"));
  check("B는 A의 주문 메타를 볼 수 없다", r.status === 200 && r.json.length === 0);
  r = await api("/rest/v1/order_meta?order_no=eq." + ORD("m"), { method: "DELETE", token: A.token });
  check("주문 메타는 지울 수 없다", denied(r) && (await metaNow()).length === 1, r.status + " " + code(r));
  r = await up("supplier_contact_marks", A.token, { supplier_name: SUP, last_contacted_on: "2026-10-12", updated_at: nowIso() }, "user_id,supplier_name");
  const mk = await get("supplier_contact_marks", A.token, "select=last_contacted_on&supplier_name=eq." + encodeURIComponent(SUP));
  check("연락함 표시가 저장된다", r.status < 300 && mk.json[0].last_contacted_on === "2026-10-12", String(r.status));
  await up("supplier_contact_marks", A.token, { supplier_name: SUP, last_contacted_on: "2025-01-01", updated_at: nowIso(-86400000) }, "user_id,supplier_name");
  const mk2 = await get("supplier_contact_marks", A.token, "select=last_contacted_on&supplier_name=eq." + encodeURIComponent(SUP));
  check("연락함 표시도 오래된 시각 덮어쓰기는 무시된다", mk2.json[0].last_contacted_on === "2026-10-12");
  r = await up("user_settings", A.token, { data: { reAlertDays: 3, notice: { template: "공지형" } }, updated_at: nowIso() }, "user_id");
  const st = await get("user_settings", A.token, "select=data");
  check("설정(jsonb)이 저장되고 그대로 읽힌다", r.status < 300 && st.json[0].data.reAlertDays === 3, String(r.status));
  r = await get("user_settings", B.token, "select=user_id,data");
  check("B는 A의 설정을 볼 수 없다 (보이는 행은 B 자신의 것뿐)", r.status === 200 && r.json.every(x => x.user_id === B.userId) && !r.json.some(x => x.data && x.data.reAlertDays === 3), r.json.length + "행");
  r = await up("user_settings", B.token, { data: [1, 2, 3], updated_at: nowIso() }, "user_id");
  check("설정이 객체가 아니면(배열) 거부된다", r.status === 400, r.status + " " + code(r));

  console.log("\n[많은 양]");
  const bulk = Array.from({ length: 500 }, (_, i) => log({ order_no: ORD("bulk"), note: "대량 " + i }));
  let t0 = Date.now();
  r = await ins("inform_logs", A.token, bulk, "return=minimal");
  const tIns = Date.now() - t0;
  t0 = Date.now();
  const list = await get("inform_logs", A.token, "select=id&order_no=eq." + ORD("bulk"));
  const tGet = Date.now() - t0;
  check("500건을 한 번에 올리고 모두 읽는다", r.status === 201 && list.json.length === 500, "올리기 " + tIns + "ms, 읽기 " + tGet + "ms");
  check("읽기가 2초 안에 끝난다", tGet < 2000, tGet + "ms");

  console.log("\n[정리: 시험 행에 삭제 표시]");
  const tomb = { deleted_at: nowIso(), deleted_reason: "user" };
  for (const [who, U2] of [["A", A], ["B", B]]) {
    let n = 0;
    for (const t of ["inform_logs", "quick_notes", "substitute_checks", "schedule_entries"]) {
      r = await patch(t, U2.token, "order_no=like.QA-T-" + run + "-*&deleted_at=is.null", tomb);
      n += r.json ? r.json.length : 0;
    }
    r = await patch("supplier_contact_logs", U2.token, "supplier_name=like.QA-T-" + run + "-*&deleted_at=is.null", tomb);
    n += r.json ? r.json.length : 0;
    console.log("  " + who + ": 시험 행 " + n + "건에 삭제 표시");
  }
  if (origSettings) await up("user_settings", A.token, { data: origSettings.data, updated_at: nowIso() }, "user_id");
  r = await get("inform_logs", A.token, "select=id&order_no=like.QA-T-" + run + "-*&deleted_at=is.null");
  check("삭제 표시 뒤 A의 시험 기록 중 살아 있는 것은 0건이다", r.json.length === 0);

  const fail = results.filter(x => !x.ok);
  console.log("\n" + (results.length - fail.length) + "/" + results.length + " 통과" + (fail.length ? ", 실패 " + fail.length + "건: " + fail.map(f => f.name).join(" | ") : ""));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error("시험이 중단됐어요:", e.message); process.exit(2); });
