// E2E 실행기. 사용: npm run test:e2e   (또는 node e2e/run.js --only S-00 --keep)
//   --only <id>  : 그 시나리오만 (여러 번 쓰면 여러 개)
//   --quiet      : 앱 창을 화면에 띄우지 않는다 (시험 중 깜빡임 없음. 숨기면 S-06(키보드·포커스)과 S-08(실행 중복) 일부가 실패한다. 최종 확인은 --quiet 없이 돌린다)
//   --keep       : 임시 저장 폴더를 지우지 않는다 (실패 원인 조사용)
// 시나리오마다 앱을 새로 띄우고(깨끗한 임시 저장 폴더), 끝나면 콘솔 오류 0건인지 확인한다.
// 전체가 끝나면 실제 사용자 데이터(state.json)가 바뀌지 않았는지도 확인한다.
const fs = require("fs"), path = require("path");
const { ROOT, REAL_STATE, launchApp, fingerprint } = require("./helpers");

const args = process.argv.slice(2);
const only = args.flatMap((a, i) => (a === "--only" ? [args[i + 1]] : []));
const keep = args.includes("--keep");
if (args.includes("--quiet")) process.env.NABGI_E2E_HIDDEN = "1";         // 앱 창을 화면에 띄우지 않는다 (자식 프로세스가 환경변수를 이어받는다)
const OUT = path.join(__dirname, "out");

const scenarios = fs.readdirSync(path.join(__dirname, "scenarios")).filter(f => f.endsWith(".js")).sort()
  .map(f => require(path.join(__dirname, "scenarios", f))).filter(s => !only.length || only.includes(s.id));

(async () => {
  if (!scenarios.length) { console.error("실행할 시나리오가 없어요" + (only.length ? " (--only " + only.join(", ") + " 와 맞는 것이 없음)" : "") + "."); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const realBefore = fingerprint(REAL_STATE);
  const summary = [];
  console.log(`E2E 시작: 시나리오 ${scenarios.length}개 · 실제 데이터 ${REAL_STATE}\n`);

  for (const sc of scenarios) {
    const apps = [], dirs = new Set(), checks = [], gaps = [];
    const ctx = {
      check: (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); console.log("  " + (ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); return !!ok; },
      note: text => console.log("  ·    " + text),
      // 감사에서 발견한 "문서와 동작이 다른 곳". 실패로 세지 않고 따로 모아 AUDIT.md와 백로그에 올린다. 고치면 check로 바꾼다.
      gap: (name, detail = "") => { gaps.push({ name, detail }); console.log("  GAP  " + name + (detail ? "  (" + detail + ")" : "")); },
      launch: async opts => { const a = await launchApp(opts); apps.push(a); dirs.add(a.userData); return a; },
    };
    console.log(`[${sc.id}] ${sc.name}`);
    let crashed = null;
    try { await sc.run(ctx); } catch (e) { crashed = e; ctx.check("시나리오가 끝까지 실행된다", false, e.message); }
    // T1.12: 콘솔 오류·처리되지 않은 예외는 0건이어야 한다
    const errs = apps.flatMap(a => a.errors);
    ctx.check("콘솔 오류·예외 0건", errs.length === 0, errs.slice(0, 3).join(" | "));
    const failed = checks.filter(c => !c.ok);
    if (failed.length && apps.length) { try { await apps[apps.length - 1].screenshot(path.join(OUT, sc.id + "-FAIL.png")); } catch (e) { /* 이미 종료됨 */ } }
    for (const a of apps) await a.close();
    if (!keep) for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 잠겨 있으면 .gitignore가 막는다 */ }
    summary.push({ id: sc.id, name: sc.name, total: checks.length, failed: failed.length, gaps: gaps.length });
    console.log("");
  }

  const realAfter = fingerprint(REAL_STATE);
  const safe = realBefore === realAfter;
  console.log((safe ? "PASS " : "FAIL ") + "실제 사용자 데이터(state.json)가 바뀌지 않았다  (" + (safe ? realBefore : realBefore + " -> " + realAfter) + ")");
  console.log("\n요약");
  summary.forEach(s => console.log(`  ${s.failed ? "FAIL" : "PASS"} ${s.id} ${s.name}  (${s.total - s.failed}/${s.total})${s.gaps ? "  · 발견 사항(GAP) " + s.gaps + "건" : ""}`));
  const bad = summary.filter(s => s.failed).length + (safe ? 0 : 1);
  console.log("\n" + (bad ? bad + "개 실패" : "모두 통과"));
  process.exit(bad ? 1 : 0);
})();
