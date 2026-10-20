// 저장 파일 이전 리허설: 실제 저장 파일(의 백업)을 복사본으로 새 저장소와 실제 앱에 통과시켜, 내용이 하나도 빠지지 않는지 확인한다 (MANUAL_TESTS M-09).
// 사용: node tools/migration-rehearsal.js [예전 형식 저장 파일 경로]   (기본: .backup/state.v0.2026-10-19.json)
// 원본은 읽기만 하고 절대 바꾸지 않는다. 모든 작업은 임시 폴더의 복사본에서 한다. 출력은 건수만 보여 주고 내용은 찍지 않는다.
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { LocalFileStore } = require("../src/store/localFileStore");
const { clean } = require("../src/persist");
const { launchApp } = require("../e2e/helpers");

const src = path.resolve(process.argv[2] || path.join(__dirname, "..", ".backup", "state.v0.2026-10-19.json"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); };
const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === "id" || k === "createdAt" ? undefined : x)));
const sizes = v => Object.fromEntries(["edited", "reasons", "causeOverride", "contacted", "contactLog", "informed", "subst", "schedule"].map(k => [k, Object.keys(v[k] || {}).length]));

(async () => {
  console.log("원본(읽기 전용):", src);
  const before = sha(src), original = fs.readFileSync(src, "utf8");
  const oldView = clean(JSON.parse(original));                      // 예전 앱이 이 파일을 읽던 방식 그대로
  console.log("예전 형식 건수:", JSON.stringify(sizes(oldView)), "· soonRules", (oldView.soonRules || "").length + "자 · 안내문 선택", oldView.notice ? oldView.notice.template : "(없음)", "\n");

  // ---- 1) 저장소만으로 ----
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-rehearsal-"));
  fs.copyFileSync(src, path.join(dir1, "state.json"));
  const r = await new LocalFileStore({ dir: dir1 }).load();
  check("저장소: 예전 형식을 새 형식으로 바꿨다고 알린다", r.notices.length === 1 && r.notices[0].code === "migrated");
  check("저장소: 내용이 하나도 빠지지 않았다 (id·만든 시각을 빼고 같다)", JSON.stringify(strip(r.view)) === JSON.stringify(strip(oldView)), JSON.stringify(sizes(r.view)));
  check("저장소: 백업이 원본과 똑같다", fs.readFileSync(path.join(dir1, "state.v0.bak.json"), "utf8") === original);
  check("저장소: 새 파일은 v2다", JSON.parse(fs.readFileSync(path.join(dir1, "state.json"), "utf8")).schemaVersion === 2);
  const again = await new LocalFileStore({ dir: dir1 }).load();
  check("저장소: 다시 열면 알림이 없고 내용(id 포함)이 같다 (여러 번 열어도 같은 결과)", again.notices.length === 0 && JSON.stringify(again.view) === JSON.stringify(r.view));

  // ---- 2) 실제 앱으로 ----
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-rehearsal-"));
  fs.copyFileSync(src, path.join(dir2, "state.json"));
  const app = await launchApp({ userData: dir2 });
  try {
    const note = (await app.text("#savedInfo")) || "";
    check("앱: 화면에 이전 사실을 알려 준다", /새 형식(\(v2\))?으로 바꿨어요/.test(note));
    const inApp = await app.eval("({ contacted: Object.keys(S.contacted).length, contactLog: Object.keys(S.contactLog).length, informed: Object.keys(S.informed).length, reasons: Object.keys(S.reasons).length, soonRules: (S.soonRules || '').length, template: S.notice.template })");
    check("앱: 공급사 연락 기록·사유·품목별 기준·안내문 선택이 그대로 불러와진다", inApp.contacted === sizes(oldView).contacted && inApp.contactLog === sizes(oldView).contactLog && inApp.reasons === sizes(oldView).reasons && inApp.soonRules === (oldView.soonRules || "").length && inApp.template === (oldView.notice ? oldView.notice.template : "사과형"), JSON.stringify(inApp));
    await app.click("#sampleBtn"); await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    await app.click("#tabContact"); await app.sleep(400);
    const contactText = (await app.text("#contactView")) || "";
    check("앱: '오늘 연락할 곳' 탭이 오류 없이 열린다", contactText.length > 0);
  } finally { await app.close(); }
  check("앱: 콘솔 오류·예외 0건", app.errors.length === 0, app.errors.slice(0, 2).join(" | "));

  for (const d of [dir1, dir2]) fs.rmSync(d, { recursive: true, force: true });
  check("원본은 한 글자도 바뀌지 않았다", sha(src) === before, before);
  console.log("\n" + (failed ? failed + "개 실패" : "모두 통과"));
  process.exit(failed ? 1 : 0);
})();
