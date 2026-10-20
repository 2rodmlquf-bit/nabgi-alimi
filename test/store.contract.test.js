// 저장소 계약 시험: 어떤 저장소 구현이든 이 행동을 지켜야 한다 (devpian.md Phase 2 T2.7).
// 지금은 MemoryStore와 LocalFileStore에 돌린다. Phase 10에서 SupabaseStore를 factories에 한 줄 더하면 "로컬과 똑같이 동작한다"가 증명된다.
// 화면은 저장소 구현을 모른다. 이 계약만 믿는다.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { MemoryStore } = require("../src/store/memoryStore");
const { LocalFileStore } = require("../src/store/localFileStore");
const { clean } = require("../src/persist");

let seq = 0;
const det = () => { let t = 0, n = 0; return { now: () => "2026-10-19T09:" + String(Math.floor(t++ / 60) % 60).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0") + ".000Z", newId: () => "id-" + (++n) }; };

// factory: { name, make() -> { store, reopen(), cleanup() } }. reopen은 같은 저장 내용으로 새 저장소를 연다 (앱을 껐다 켜는 것).
const factories = [
  { name: "MemoryStore", make: () => { const holder = { text: null }; return { store: new MemoryStore({ ...det(), holder }), reopen: () => new MemoryStore({ ...det(), holder }), seed: text => { holder.text = text; }, backedUp: () => true, cleanup() {} }; } },
  { name: "LocalFileStore", make: () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-store-"));
    const s = new LocalFileStore({ dir, ...det() });
    return { store: s, reopen: () => new LocalFileStore({ dir, ...det() }), seed: text => fs.writeFileSync(path.join(dir, "state.json"), text, "utf8"), backedUp: orig => fs.existsSync(path.join(dir, "state.v1.bak.json")) && fs.readFileSync(path.join(dir, "state.v1.bak.json"), "utf8") === orig, cleanup() { fs.rmSync(dir, { recursive: true, force: true }); } };
  } },
];

const ent = (date, extra) => ({ date, channel: "메일", status: "지연", due: "2026-09-24", note: "", ...extra });
const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === "id" || k === "createdAt" ? undefined : x)));

for (const f of factories) {
  const t = (name, fn) => test(`[${f.name}] ${name}`, async () => { const h = f.make(); try { await fn(h); } finally { h.cleanup(); } });

  t("처음에는 비어 있다: 빈 뷰, 알림 없음, 읽기 전용 아님", async ({ store }) => {
    const r = await store.load();
    assert.deepEqual(r.view, clean(null));
    assert.deepEqual(r.notices, []);
    assert.equal(r.readOnly, false);
  });

  t("저장하고 다시 읽으면 같은 내용이다. 앱을 껐다 켜도(reopen) 같다", async ({ store, reopen }) => {
    const view = { ...clean(null), informed: { A: [ent("2026-10-10", { note: "전화로 설명" })] }, reasons: { A: "통관 서류 보완" }, causeOverride: { A: "통관·서류" },
      edited: { A: { from: "2026-09-24", to: "2026-10-23" } }, notice: { template: "공지형", alt: "", signature: "홍길동 드림" }, soonRules: "필터=3\n장갑=3", contacted: { 가온산업: "2026-10-12" } };
    assert.deepEqual(await store.save(view), { ok: true });
    assert.deepEqual(strip((await store.load()).view), strip(clean(view)));
    assert.deepEqual(strip((await reopen().load()).view), strip(clean(view)));
  });

  t("한글·이모지·줄바꿈이 그대로 보존된다", async ({ store, reopen }) => {
    const note = "전화로 들음 \"따옴표\"\n두 번째 줄 😀 テスト";
    await store.save({ ...clean(null), informed: { "PO-한글-1": [ent("2026-10-10", { note })] }, reasons: { "PO-한글-1": "재고 없음\n해외 선적" } });
    const v = (await reopen().load()).view;
    assert.equal(v.informed["PO-한글-1"][0].note, note);
    assert.equal(v.reasons["PO-한글-1"], "재고 없음\n해외 선적");
  });

  t("안내 기록마다 고유한 id와 만든 시각이 붙고, 저장·불러오기를 되풀이해도 바뀌지 않는다", async ({ store, reopen }) => {
    await store.save({ ...clean(null), informed: { A: [ent("2026-10-10"), ent("2026-10-11")], B: [ent("2026-10-12")] } });
    const v1 = (await store.load()).view;
    const all = [...v1.informed.A, ...v1.informed.B];
    assert.equal(new Set(all.map(e => e.id)).size, 3);
    all.forEach(e => { assert.ok(e.id); assert.ok(e.createdAt); });
    await store.save(v1);                                           // 화면이 받은 뷰를 그대로 다시 저장
    await store.save((await store.load()).view);
    const v2 = (await reopen().load()).view;
    assert.deepEqual(v2.informed, v1.informed);                     // id도 createdAt도 그대로
  });

  t("안내 기록을 취소(뷰에서 빼기)하고 저장하면 다시 열어도 보이지 않고, 남은 기록은 그대로다", async ({ store, reopen }) => {
    await store.save({ ...clean(null), informed: { A: [ent("2026-10-10"), ent("2026-10-11", { channel: "전화" })] } });
    const v = (await store.load()).view;
    const keep = v.informed.A[0];
    v.informed.A.pop();
    await store.save(v);
    const after = (await reopen().load()).view;
    assert.equal(after.informed.A.length, 1);
    assert.deepEqual(after.informed.A[0], keep);
    delete after.informed.A;                                        // 모두 취소
    const s2 = reopen(); await s2.load(); await s2.save(after);
    assert.deepEqual((await reopen().load()).view.informed, {});
  });

  t("주문당 안내 기록은 최근 50건까지만 보인다", async ({ store }) => {
    const many = Array.from({ length: 60 }, (_, i) => ent("2026-10-" + String((i % 28) + 1).padStart(2, "0"), { note: "m" + i }));
    await store.save({ ...clean(null), informed: { A: many } });
    const v = (await store.load()).view.informed.A;
    assert.equal(v.length, 50);
    assert.equal(v[0].note, "m10"); assert.equal(v[49].note, "m59");
  });

  t("저장 내용이 2,000,000자를 넘으면 거부하고 이유를 알려 주며, 기존 저장 내용은 그대로다", async ({ store, reopen }) => {
    await store.save({ ...clean(null), reasons: { A: "원래 내용" } });
    const r = await store.save({ ...clean(null), reasons: { A: "a".repeat(2100000) } });
    assert.equal(r.ok, false);
    assert.match(r.error, /너무 큽니다/);
    assert.equal((await store.load()).view.reasons.A, "원래 내용");
    assert.equal((await reopen().load()).view.reasons.A, "원래 내용");
  });

  t("저장하는 동안 입력(뷰)을 바꾸지 않는다", async ({ store }) => {
    const view = { ...clean(null), informed: { A: [ent("2026-10-10")] }, reasons: { A: "x" } };
    const frozen = JSON.stringify(view);
    await store.save(view);
    assert.equal(JSON.stringify(view), frozen);
  });

  t("저장을 연달아 요청해도 순서대로 처리되어 마지막 내용이 남는다", async ({ store, reopen }) => {
    const views = [1, 2, 3, 4, 5].map(i => ({ ...clean(null), reasons: { A: "버전" + i } }));
    const results = await Promise.all(views.map(v => store.save(v)));
    assert.ok(results.every(r => r.ok));
    assert.equal((await reopen().load()).view.reasons.A, "버전5");
  });

  t("지우면 빈 상태가 되고, 다시 열어도 비어 있다. 지운 뒤에도 저장할 수 있다", async ({ store, reopen }) => {
    await store.save({ ...clean(null), informed: { A: [ent("2026-10-10")] }, reasons: { A: "x" } });
    assert.deepEqual(await store.clear(), { ok: true });
    assert.deepEqual((await store.load()).view, clean(null));
    assert.deepEqual((await reopen().load()).view, clean(null));
    assert.deepEqual(await store.save({ ...clean(null), reasons: { B: "다시" } }), { ok: true });
    assert.equal((await reopen().load()).view.reasons.B, "다시");
  });

  t("정보 조회(info)가 저장 종류와 알림·읽기 전용 여부를 알려 준다", async ({ store }) => {
    await store.load();
    const i = store.info();
    assert.ok(["memory", "local-file"].includes(i.kind));
    assert.ok(Array.isArray(i.notices));
    assert.equal(i.readOnly, false);
  });

  t("빠른 메모: 저장하면 id와 시각이 붙고, 다시 열어도 같고, 안내 기록과 섞이지 않는다", async ({ store, reopen }) => {
    await store.save({ ...clean(null), informed: { A: [ent("2026-10-10")] }, quickNotes: { A: [{ text: "전화로 들음: 통관 지연", createdAt: "2026-10-12T05:30:00.000Z" }, { text: "둘째 😀\n줄바꿈" }], B: [{ text: "다른 주문" }] } });
    const v = (await store.load()).view;
    assert.deepEqual(v.quickNotes.A.map(n => n.text), ["전화로 들음: 통관 지연", "둘째 😀\n줄바꿈"]);
    assert.equal(v.quickNotes.A[0].createdAt, "2026-10-12T05:30:00.000Z");     // 화면이 준 시각을 그대로 쓴다
    v.quickNotes.A.concat(v.quickNotes.B).forEach(n => { assert.ok(n.id); assert.ok(n.createdAt); });
    assert.equal(v.informed.A.length, 1);                                       // 안내 기록은 그대로
    assert.deepEqual((await reopen().load()).view, v);                          // 껐다 켜도 id까지 같다
  });

  t("빠른 메모를 지우면 다시 열어도 보이지 않고, 남은 메모와 안내 기록은 그대로다", async ({ store, reopen }) => {
    await store.save({ ...clean(null), informed: { A: [ent("2026-10-10")] }, quickNotes: { A: [{ text: "첫째" }, { text: "둘째" }] } });
    const v = (await store.load()).view;
    const keep = v.quickNotes.A[1];
    v.quickNotes.A.shift();
    await store.save(v);
    const after = (await reopen().load()).view;
    assert.deepEqual(after.quickNotes.A, [keep]);
    assert.equal(after.informed.A.length, 1);
    delete after.quickNotes.A;
    const s2 = reopen(); await s2.load(); await s2.save(after);
    assert.deepEqual((await reopen().load()).view.quickNotes, {});
  });

  t("빠른 메모는 주문당 최근 50건까지만 보이고, 한 건은 300자까지다", async ({ store }) => {
    const many = Array.from({ length: 60 }, (_, i) => ({ text: "m" + i }));
    await store.save({ ...clean(null), quickNotes: { A: many, B: [{ text: "가".repeat(400) }] } });
    const v = (await store.load()).view.quickNotes;
    assert.equal(v.A.length, 50); assert.equal(v.A[0].text, "m10"); assert.equal(v.A[49].text, "m59");
    assert.equal(v.B[0].text.length, 300);
  });

  // ---- v1 파일(0.5.0이 쓰던 형식)을 v2로 옮기는 계약 (모든 저장소 공통) ----
  t("v1 파일: 새 형식(v2)으로 바꾸고 알려 주며, 내용을 잃지 않고, 다시 열면 같은 결과다", async ({ store, reopen, seed, backedUp }) => {
    const v1 = JSON.stringify({ schemaVersion: 1, savedAt: "2026-10-18T09:00:00.000Z",
      informLog: { A: [{ id: "i1", date: "2026-10-10", channel: "메일", status: "지연", due: "2026-09-24", note: "전화", createdAt: "2026-10-10T01:00:00.000Z" }, { id: "i2", date: "2026-10-11", channel: "전화", status: "지연", due: "", note: "", createdAt: "2026-10-11T01:00:00.000Z", deletedAt: "2026-10-12T00:00:00.000Z" }] },
      quickNotes: { A: [{ id: "n1", text: "메모", createdAt: "2026-10-10T02:00:00.000Z" }] }, orderMeta: {},
      settings: { notice: null, soonRules: "필터=3", updatedAt: "2026-10-10T00:00:00.000Z" },
      legacy: { contacted: { 가온산업: "2026-10-12" }, contactLog: { 가온산업: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "" }] }, subst: {}, schedule: {} } });
    seed(v1);
    const r = await store.load();
    assert.equal(r.notices.length, 1); assert.equal(r.notices[0].code, "migrated");
    assert.equal(backedUp(v1), true);                                            // 예전 파일은 그대로 백업됐다
    assert.deepEqual(r.view.informed.A.map(e => e.id), ["i1"]);                  // 지운 기록은 계속 지워진 채, 남은 기록은 id 그대로
    assert.equal(r.view.quickNotes.A[0].id, "n1");
    assert.equal(r.view.soonRules, "필터=3");
    assert.equal(r.view.contacted.가온산업, "2026-10-12");
    assert.equal(r.view.contactLog.가온산업.length, 1);
    const again = await reopen().load();
    assert.deepEqual(again.notices, []);                                         // 다시 열면 알림 없음
    assert.deepEqual(again.view, r.view);                                        // 내용(id 포함)이 같다
  });

  t("같은 화면을 거듭 저장해도 지운 표시가 늘어나지 않는다 (id 없는 안내 기록 포함)", async ({ store, reopen }) => {
    await store.save({ ...clean(null), informed: { A: [ent("2026-10-10"), ent("2026-10-11")] } });
    const v = (await store.load()).view;
    const s2 = reopen(); await s2.load();
    await s2.save(v); await s2.save(v); await s2.save(v);
    const r = await reopen().load();
    assert.equal(r.view.informed.A.length, 2);
    if (r.state) assert.equal(r.state.informLog.A.filter(e => e.deletedAt).length, 0);
  });

  t("v2 파일(0.6.0이 쓰던 형식): v3로 바꾸고 알려 주며, 기록을 잃지 않고, 회신 목록이 빈 채로 생긴다", async ({ store, reopen, seed }) => {
    const v2 = JSON.stringify({ schemaVersion: 2, savedAt: "2026-10-19T09:00:00.000Z",
      informLog: { A: [{ id: "i1", date: "2026-10-10", channel: "메일", status: "지연", due: "", note: "전화", createdAt: "2026-10-10T01:00:00.000Z" }] },
      quickNotes: {}, orderMeta: { A: { reason: "통관", updatedAt: "2026-10-10T00:00:00.000Z" } }, settings: { notice: null, soonRules: null, updatedAt: "" },
      contactLog: {}, contactMarks: { 가온산업: { date: "2026-10-12", updatedAt: "2026-10-12T00:00:00.000Z" } }, substChecks: {}, scheduleEntries: {}, cloudLink: { enabled: false, project: "", ownerUserId: "", linkedAt: "", lastSyncedAt: "" } });
    seed(v2);
    const r = await store.load();
    assert.equal(r.notices.length, 1); assert.equal(r.notices[0].code, "migrated");
    assert.equal(r.view.informed.A[0].id, "i1"); assert.equal(r.view.reasons.A, "통관"); assert.equal(r.view.contacted.가온산업, "2026-10-12");
    assert.deepEqual(r.view.replies, {});
    const again = await reopen().load();
    assert.deepEqual(again.notices, []); assert.deepEqual(again.view, r.view);                      // 다시 열면 알림 없음, 같은 내용
  });

  t("회신(공급사 약속일)을 저장하고 다시 열어도 같다. 지우면 보이지 않는다", async ({ store, reopen }) => {
    await store.save({ ...clean(null), replies: { A: [{ date: "2026-10-10", promised: "2026-10-30", channel: "전화", note: "다음 주", source: "manual", supplier: "가온산업" }] } });
    const v = (await store.load()).view;
    assert.equal(v.replies.A[0].promised, "2026-10-30"); assert.ok(v.replies.A[0].id);
    assert.deepEqual((await reopen().load()).view, v);                                               // 껐다 켜도 id까지 같다
    delete v.replies.A;
    const s2 = reopen(); await s2.load(); await s2.save(v);
    assert.deepEqual((await reopen().load()).view.replies, {});
  });
}
