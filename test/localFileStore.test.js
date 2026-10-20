// 로컬 파일 저장소 전용 시험: 실제 파일을 다루는 부분 (예전 형식 이전, 백업, 손상 파일 보관, 읽기 전용, 쓰기 실패).
// 저장소가 지켜야 하는 공통 행동은 store.contract.test.js가 맡는다.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { LocalFileStore } = require("../src/store/localFileStore");
const { createStore } = require("../src/store");
const { clean } = require("../src/persist");

const det = () => { let t = 0, n = 0; return { now: () => "2026-10-19T09:00:" + String(t++ % 60).padStart(2, "0") + ".000Z", newId: () => "id-" + (++n) }; };
const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === "id" || k === "createdAt" ? undefined : x)));
const ent = (date, extra) => ({ date, channel: "메일", status: "지연", due: "2026-09-24", note: "", ...extra });

// 2026-10-19 실제 저장 파일(안내 기록 기능 이전 버전)과 같은 모양에, 안내 기록이 있는 버전 하나를 더한다
const V0 = { edited: {}, reasons: { A: "통관 서류 보완" }, causeOverride: {}, notice: { template: "사과형", alt: "", signature: "" },
  contacted: { 가온산업: "2026-10-12" }, contactLog: { 가온산업: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "" }] },
  subst: {}, schedule: {}, soonRules: "필터=3\n그리스=3", informed: { A: [ent("2026-10-10"), ent("2026-10-12", { channel: "전화" })] } };

function withDir(fn) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-local-"));
    try { await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");
const exists = (dir, f) => fs.existsSync(path.join(dir, f));
const names = dir => fs.readdirSync(dir).sort();

test("새 폴더: 파일이 없으면 비어 있고, 저장하면 state.json(현재 형식 v3)이 생기며 임시 파일은 남지 않는다", withDir(async dir => {
  const s = new LocalFileStore({ dir, ...det() });
  assert.deepEqual((await s.load()).view, clean(null));
  assert.equal(exists(dir, "state.json"), false);                      // 읽기만 해서는 파일을 만들지 않는다
  await s.save({ ...clean(null), reasons: { A: "x" } });
  assert.equal(JSON.parse(read(dir, "state.json")).schemaVersion, 3);
  assert.deepEqual(names(dir), ["state.json"]);                        // state.json.tmp가 남지 않았다
  assert.equal(s.describe().kind, "local-file");
  assert.equal(s.describe().path, path.join(dir, "state.json"));
  assert.ok(s.describe().sizeBytes > 0);
}));

test("저장 폴더가 아직 없어도 저장하면 만들어진다", withDir(async dir => {
  const s = new LocalFileStore({ dir: path.join(dir, "깊은", "폴더"), ...det() });
  assert.deepEqual(await s.save({ ...clean(null), reasons: { A: "x" } }), { ok: true });
  assert.ok(fs.existsSync(path.join(dir, "깊은", "폴더", "state.json")));
}));

test("예전(v0) 파일: 백업을 만든 뒤 새 형식으로 바꾸고, 내용은 하나도 잃지 않는다", withDir(async dir => {
  const original = JSON.stringify(V0);
  fs.writeFileSync(path.join(dir, "state.json"), original, "utf8");
  const r = await new LocalFileStore({ dir, ...det() }).load();
  assert.deepEqual(r.notices.map(n => n.code), ["migrated"]);
  assert.match(r.notices[0].message, /state\.v0\.bak\.json/);
  assert.equal(r.readOnly, false);
  assert.deepEqual(strip(r.view), strip(clean(V0)));                   // 내용이 그대로
  assert.equal(r.view.informed.A.length, 2);
  r.view.informed.A.forEach(e => { assert.ok(e.id); assert.ok(e.createdAt); });
  assert.equal(read(dir, "state.v0.bak.json"), original);              // 백업은 원본과 똑같다
  assert.equal(JSON.parse(read(dir, "state.json")).schemaVersion, 3);  // 파일은 이제 v3
}));

test("이전을 마친 뒤 다시 열면 알림이 없고 id가 그대로이며 백업은 바뀌지 않는다 (여러 번 열어도 결과가 같다)", withDir(async dir => {
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(V0), "utf8");
  const first = await new LocalFileStore({ dir, ...det() }).load();
  const bak = read(dir, "state.v0.bak.json"), file1 = read(dir, "state.json");
  const second = await new LocalFileStore({ dir, ...det() }).load();
  assert.deepEqual(second.notices, []);
  assert.deepEqual(second.view, first.view);                           // id까지 같다
  assert.equal(read(dir, "state.json"), file1);                        // 다시 쓰지도 않았다
  assert.equal(read(dir, "state.v0.bak.json"), bak);
  assert.deepEqual(names(dir), ["state.json", "state.v0.bak.json"]);
}));

test("백업 이름이 이미 쓰이고 있고 내용이 다르면 덮어쓰지 않고 새 이름으로 백업한다", withDir(async dir => {
  fs.writeFileSync(path.join(dir, "state.v0.bak.json"), "먼저 만든 다른 백업", "utf8");
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(V0), "utf8");
  const r = await new LocalFileStore({ dir, ...det() }).load();
  assert.equal(read(dir, "state.v0.bak.json"), "먼저 만든 다른 백업");   // 기존 백업은 그대로
  const extra = names(dir).filter(n => /^state\.v0\.bak-.*\.json$/.test(n));
  assert.equal(extra.length, 1);
  assert.equal(read(dir, extra[0]), JSON.stringify(V0));
  assert.match(r.notices[0].message, new RegExp(extra[0].replace(/\./g, "\\.")));
}));

test("읽을 수 없는 파일(깨진 JSON, 빈 파일, 배열): 지우지 않고 보관한 뒤 빈 상태로 시작하고 알려 준다", withDir(async dir => {
  for (const bad of ['{ "informed": ', "", "[1,2,3]", "그냥 글자"]) {
    for (const f of names(dir)) fs.rmSync(path.join(dir, f));
    fs.writeFileSync(path.join(dir, "state.json"), bad, "utf8");
    const s = new LocalFileStore({ dir, ...det() });
    const r = await s.load();
    assert.deepEqual(r.view, clean(null), JSON.stringify(bad));
    assert.deepEqual(r.notices.map(n => n.code), ["corrupt"]);
    assert.equal(r.readOnly, false);
    const kept = names(dir).filter(n => /^state\.corrupt-.*\.json$/.test(n));
    assert.equal(kept.length, 1, JSON.stringify(bad));
    assert.equal(read(dir, kept[0]), bad);                             // 내용이 그대로 보관됨
    assert.equal(exists(dir, "state.json"), false);
    assert.deepEqual(await s.save({ ...clean(null), reasons: { A: "새로" } }), { ok: true });   // 이어서 정상 저장
    assert.equal((await new LocalFileStore({ dir, ...det() }).load()).view.reasons.A, "새로");
  }
}));

test("BOM이 붙은 v1 파일도 읽는다", withDir(async dir => {
  const s0 = new LocalFileStore({ dir, ...det() });
  await s0.save({ ...clean(null), reasons: { A: "x" } });
  fs.writeFileSync(path.join(dir, "state.json"), "﻿" + read(dir, "state.json"), "utf8");
  const r = await new LocalFileStore({ dir, ...det() }).load();
  assert.equal(r.view.reasons.A, "x");
  assert.deepEqual(r.notices, []);
}));

test("더 새로운 버전의 파일: 읽기 전용으로 열고, 저장·삭제를 거부하며, 파일은 한 글자도 바뀌지 않는다", withDir(async dir => {
  const future = JSON.stringify({ schemaVersion: 4, 새로운: "필드" });
  fs.writeFileSync(path.join(dir, "state.json"), future, "utf8");
  const s = new LocalFileStore({ dir, ...det() });
  const r = await s.load();
  assert.equal(r.readOnly, true);
  assert.deepEqual(r.notices.map(n => n.code), ["future-version"]);
  const sv = await s.save({ ...clean(null), reasons: { A: "x" } });
  assert.equal(sv.ok, false); assert.match(sv.error, /저장하지 않았어요/);
  const cl = await s.clear();
  assert.equal(cl.ok, false);
  assert.equal(read(dir, "state.json"), future);
  assert.deepEqual(names(dir), ["state.json"]);                        // 보관·백업 파일도 만들지 않았다
}));

test("파일을 열 수 없으면(폴더가 파일 이름을 차지함) 읽기 전용이고 아무것도 덮어쓰지 않는다", withDir(async dir => {
  fs.mkdirSync(path.join(dir, "state.json"));
  const s = new LocalFileStore({ dir, ...det() });
  const r = await s.load();
  assert.equal(r.readOnly, true);
  assert.deepEqual(r.notices.map(n => n.code), ["read-failed"]);
  assert.equal((await s.save({ ...clean(null), reasons: { A: "x" } })).ok, false);
  assert.ok(fs.statSync(path.join(dir, "state.json")).isDirectory());
}));

test("저장이 실패해도(임시 파일을 못 씀) 기존 저장 파일과 메모리의 내용은 그대로다", withDir(async dir => {
  const s = new LocalFileStore({ dir, ...det() });
  await s.save({ ...clean(null), reasons: { A: "원래" } });
  const before = read(dir, "state.json");
  fs.mkdirSync(path.join(dir, "state.json.tmp"));                       // 임시 파일 자리를 막는다
  const r = await s.save({ ...clean(null), reasons: { A: "바꾸려던 내용" } });
  assert.equal(r.ok, false); assert.match(r.error, /저장하지 못했습니다/);
  assert.equal(read(dir, "state.json"), before);
  assert.equal((await s.load()).view.reasons.A, "원래");                // 실패한 내용이 메모리에 남지 않는다
}));

test("새 형식으로 바꾸지 못하면 원본을 그대로 두고, 내용은 읽어 오되 읽기 전용이다", withDir(async dir => {
  const original = JSON.stringify(V0);
  fs.writeFileSync(path.join(dir, "state.json"), original, "utf8");
  fs.mkdirSync(path.join(dir, "state.json.tmp"));                       // 새 파일을 쓸 수 없게 막는다
  const s = new LocalFileStore({ dir, ...det() });
  const r = await s.load();
  assert.equal(r.readOnly, true);
  assert.deepEqual(r.notices.map(n => n.code), ["migrate-failed"]);
  assert.deepEqual(strip(r.view), strip(clean(V0)));                    // 사용자는 자기 데이터를 볼 수 있다
  assert.equal(read(dir, "state.json"), original);                      // 원본은 그대로
  assert.equal(read(dir, "state.v0.bak.json"), original);               // 백업은 이미 만들어졌다
  assert.equal((await s.save({ ...clean(null) })).ok, false);           // 하지만 저장은 막는다
}));

test("안내 기록을 취소하면 파일에 삭제 표시(deletedAt)가 남고, 화면에는 보이지 않는다", withDir(async dir => {
  const s = new LocalFileStore({ dir, ...det() });
  await s.save({ ...clean(null), informed: { A: [ent("2026-10-10"), ent("2026-10-11")] } });
  const v = (await s.load()).view; v.informed.A.pop();
  await s.save(v);
  const onDisk = JSON.parse(read(dir, "state.json")).informLog.A;
  assert.equal(onDisk.length, 2);
  assert.equal(onDisk[0].deletedAt, undefined);
  assert.ok(onDisk[1].deletedAt);
  assert.equal((await new LocalFileStore({ dir, ...det() }).load()).view.informed.A.length, 1);
}));

test("저장소 만들기: 'local'과 'memory'만 알고, 모르는 방식은 이유를 알려 주며 거부한다", withDir(async dir => {
  assert.equal(createStore({ mode: "local", dir }).describe().kind, "local-file");
  assert.equal(createStore({ mode: "memory" }).describe().kind, "memory");
  assert.equal(createStore({ dir }).describe().kind, "local-file");     // 기본은 local
  assert.throws(() => createStore({ mode: "supabase", dir }), /알 수 없는 저장 방식/);
  assert.throws(() => new LocalFileStore({}), /저장 폴더/);
}));
