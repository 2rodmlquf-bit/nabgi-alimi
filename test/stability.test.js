// 안정성 (Phase 7, 7-C): 저장 도중 꺼짐, 저장 실패, 저장 공간 상한과 80% 경고.
// 지키는 것: 저장이 실패해도 기존 파일과 메모리의 작업은 그대로, 크래시 없음, 데이터 손실 없음.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { LocalFileStore } = require("../src/store/localFileStore");
const { MemoryStore } = require("../src/store/memoryStore");
const Core = require("../src/store/core");

const det = () => { let n = 0; return { now: () => "2026-10-19T09:00:00.000Z", newId: () => "id-" + ++n }; };
const ent = i => ({ date: "2026-10-12", channel: "메일", status: "지연", due: "2026-09-24", note: "기록 " + i });
// 주문 n개에 안내 기록 per건씩 (주문당 상한 50건)
// Core.fromView는 now를 글자(ISO 시각)로 받는다 (저장소의 now()가 아니라 그 값)
const opts = () => { const d = det(); return { now: d.now(), newId: d.newId }; };
const bigView = (orders, per = 50) => ({ informed: Object.fromEntries(Array.from({ length: orders }, (_, i) => ["PO-" + String(i).padStart(5, "0"), Array.from({ length: per }, (_, k) => ent(k))])) });

function withDir(fn) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-stab-"));
    try { await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

test("저장 도중 꺼진 흔적(남은 임시 파일)이 있어도 기존 저장 파일을 그대로 읽고, 다음 저장이 임시 파일을 정리한다", withDir(async dir => {
  const s1 = new LocalFileStore({ dir, ...det() });
  await s1.save({ reasons: { A: "통관 서류 보완" } });
  fs.writeFileSync(path.join(dir, "state.json.tmp"), '{"schemaVersion":1,"informLog":{"반쯤', "utf8");   // 쓰다 만 임시 파일
  const s2 = new LocalFileStore({ dir, ...det() });
  const r = await s2.load();
  assert.equal(r.view.reasons.A, "통관 서류 보완");
  assert.equal(r.readOnly, false);
  assert.deepEqual(r.notices, []);
  assert.equal((await s2.save({ reasons: { A: "통관 서류 보완", B: "선적 지연" } })).ok, true);
  assert.equal(fs.existsSync(path.join(dir, "state.json.tmp")), false);
  assert.equal((await new LocalFileStore({ dir, ...det() }).load()).view.reasons.B, "선적 지연");
}));

test("교체(이름 바꾸기)가 실패하면 저장은 실패로 알리고 기존 파일은 그대로이며, 메모리의 작업은 다음 저장에 다시 담긴다", withDir(async dir => {
  const s = new LocalFileStore({ dir, ...det() });
  await s.save({ reasons: { A: "첫 저장" } });
  const before = fs.readFileSync(path.join(dir, "state.json"), "utf8");
  const real = s._write.bind(s);
  s._write = async () => { throw new Error("디스크가 가득 찼어요 (시험)"); };
  const bad = await s.save({ reasons: { A: "첫 저장", B: "저장 안 되는 작업" } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /저장하지 못했습니다/);
  assert.equal(fs.readFileSync(path.join(dir, "state.json"), "utf8"), before);        // 기존 파일 그대로
  s._write = real;
  assert.equal((await s.save({ reasons: { A: "첫 저장", B: "저장 안 되는 작업" } })).ok, true);   // 화면은 같은 작업을 다시 보낸다
  assert.equal((await new LocalFileStore({ dir, ...det() }).load()).view.reasons.B, "저장 안 되는 작업");
}));

test("저장 폴더를 쓸 수 없으면(폴더가 아닌 파일이 막고 있음) 저장 실패를 알리되 던지지 않는다", withDir(async dir => {
  const blocked = path.join(dir, "막힘");
  fs.writeFileSync(blocked, "폴더가 아니라 파일", "utf8");
  const s = new LocalFileStore({ dir: path.join(blocked, "아래"), ...det() });
  const r = await s.save({ reasons: { A: "x" } });
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 5);
}));

test("저장 공간 상한: 2MB를 넘는 저장은 거부하고 기존 내용은 그대로, 화면은 이유를 안내한다", withDir(async dir => {
  const s = new LocalFileStore({ dir, ...det() });
  await s.save({ reasons: { A: "작은 저장" } });
  const before = fs.readFileSync(path.join(dir, "state.json"), "utf8");
  const r = await s.save(bigView(600));                                              // 600주문 × 50건 ≈ 4MB
  assert.equal(r.ok, false);
  assert.match(r.error, /너무 큽니다/);
  assert.equal(fs.readFileSync(path.join(dir, "state.json"), "utf8"), before);
  assert.equal((await s.save({ reasons: { A: "작은 저장", B: "이어서" } })).ok, true);   // 거부된 뒤에도 평소처럼 저장된다
}));

test("저장 공간 80%부터는 저장은 되고 경고가 함께 온다. 그 아래에서는 경고가 없다", async () => {
  // 80% 안팎이 될 때까지 주문을 늘려 본다 (주문 하나가 약 0.4%)
  let n = 100, view, size;
  do { n += 5; view = bigView(n); size = JSON.stringify(Core.fromView(view, null, opts())).length; } while (size < Core.MAX_CHARS * Core.WARN_RATIO && n < 600);
  assert.ok(size >= Core.MAX_CHARS * Core.WARN_RATIO && size <= Core.MAX_CHARS, "시험 데이터가 80~100% 사이여야 한다: " + size);
  const s = new MemoryStore(det());
  const warn = await s.save(view);
  assert.equal(warn.ok, true);
  assert.match(warn.warning, /\d+% 썼어요/);
  const s2 = new MemoryStore(det());
  const calm = await s2.save(bigView(20));
  assert.equal(calm.ok, true);
  assert.equal(calm.warning, undefined);
});

test("실사용 규모 어림: 주문 1,000건에 건당 안내 3건씩이면 상한의 몇 %인가 (PERF.md에 기록하는 숫자)", () => {
  const size = JSON.stringify(Core.fromView(bigView(1000, 3), null, opts())).length;
  const pct = Math.round(size / Core.MAX_CHARS * 100);
  console.log("  [규모] 1,000주문×3건(시험용 짧은 id) = " + Math.round(size / 1024) + "KB (" + pct + "%)");
  assert.ok(pct < 40, "실사용 규모는 상한의 절반 아래여야 한다: " + pct + "%");
});
