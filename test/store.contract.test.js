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
  { name: "MemoryStore", make: () => { const holder = { text: null }; return { store: new MemoryStore({ ...det(), holder }), reopen: () => new MemoryStore({ ...det(), holder }), cleanup() {} }; } },
  { name: "LocalFileStore", make: () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-store-"));
    const s = new LocalFileStore({ dir, ...det() });
    return { store: s, reopen: () => new LocalFileStore({ dir, ...det() }), cleanup() { fs.rmSync(dir, { recursive: true, force: true }); } };
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
}
