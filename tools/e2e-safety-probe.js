// Phase 0 안전 점검: E2E 모드로 실제 앱을 띄워 "실제 사용자 데이터를 건드리지 않는지" 확인한다.
// 사용: node tools/e2e-safety-probe.js   (종료 코드 0이면 통과)
//
// 확인하는 것
//  1. NABGI_E2E=1 인데 NABGI_USER_DATA가 없으면 앱이 시작하지 않는다.
//  2. E2E 모드에서 CSV 열기는 대화상자 대신 NABGI_OPEN_FILE을 연다.
//  3. 안내 기록을 남기면 임시 폴더에 state.json이 생긴다.
//  4. 그동안 실제 사용자 데이터(%APPDATA%/delivery-watch/state.json)는 바뀌지 않는다.
// 화면 조작은 Chrome DevTools Protocol(앱의 --remote-debugging-port)로 한다. Node 내장 WebSocket을 쓴다.
const { spawn, spawnSync, execSync } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const SAMPLE = path.join(ROOT, "샘플주문.csv");
const PORT = Number(process.env.PROBE_PORT || 9333);
const REAL_STATE = path.join(process.env.APPDATA || "", "delivery-watch", "state.json");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); };
const fingerprint = f => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16) + ":" + fs.statSync(f).size + ":" + fs.statSync(f).mtimeMs : "(없음)");

function killTree(pid) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch (e) { /* 이미 끝남 */ } }

// 최소 CDP 클라이언트
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      eval: async expr => { const i = ++id; const p = new Promise(r => pending.set(i, r)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })); const m = await p; return m.result && m.result.result ? m.result.result.value : undefined; },
      close: () => ws.close(),
    });
  });
}
async function waitFor(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; }

(async () => {
  console.log("실제 데이터 파일:", REAL_STATE, "\n");
  const realBefore = fingerprint(REAL_STATE);

  // 1) 저장 폴더 없이 E2E 모드 -> 시작하지 않아야 한다
  const refused = spawnSync(ELECTRON, [ROOT], { env: { ...process.env, NABGI_E2E: "1", NABGI_USER_DATA: "" }, encoding: "utf8", timeout: 20000 });
  check("E2E 모드인데 NABGI_USER_DATA가 없으면 시작을 거부한다", refused.status === 1 && /NABGI_USER_DATA/.test(refused.stderr || ""), "종료 코드 " + refused.status);

  // 2~4) 분리된 임시 저장 폴더로 실제 앱을 띄운다
  const userData = fs.mkdtempSync(path.join(ROOT, ".e2e-userdata-"));
  const child = spawn(ELECTRON, [ROOT, `--remote-debugging-port=${PORT}`], { env: { ...process.env, NABGI_E2E: "1", NABGI_USER_DATA: userData, NABGI_OPEN_FILE: SAMPLE }, stdio: "ignore" });
  let page;
  try {
    const target = await waitFor(async () => { try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); return t.find(x => x.type === "page" && /index\.html/.test(x.url)); } catch (e) { return null; } }, 20000);
    check("앱이 E2E 모드로 시작되고 화면에 연결된다", !!target);
    if (!target) throw new Error("화면에 연결하지 못했어요");
    page = await connect(target.webSocketDebuggerUrl);
    // 화면 스크립트가 다 불러와져 버튼에 동작이 붙을 때까지 기다린다 (너무 일찍 누르면 아무 일도 안 일어난다)
    const ready = await waitFor(() => page.eval("document.readyState === 'complete' && !!window.app && typeof initState === 'function'"), 15000);
    check("화면 스크립트가 준비된다", !!ready);
    await sleep(600); // initState(저장 기록 읽기)가 끝나길 기다린다

    // CSV 열기: 대화상자가 떴다면 여기서 멈춘다 (우회가 안 된 것)
    await page.eval("document.getElementById('openBtn').click()");
    const rows = await waitFor(async () => { const n = await page.eval("document.querySelectorAll('#tbody tr').length"); return n > 0 ? n : null; }, 10000);
    let why = "";
    if (!rows) why = " | 파일 이름 칸: " + JSON.stringify(await page.eval("document.getElementById('fileName').textContent")) + ", 빈 화면 숨김: " + (await page.eval("document.getElementById('empty').hidden")) + ", 결과 숨김: " + (await page.eval("document.getElementById('result').hidden")) + ", 지연 카드: " + (await page.eval("document.getElementById('nLate').textContent"));
    check("CSV 열기가 대화상자 없이 지정한 파일을 연다", !!rows, rows ? rows + "행" : "목록이 안 뜸" + why);

    // 안내 기록 남기기
    await page.eval("document.querySelector('#tbody tr').click()");
    await sleep(300);
    await page.eval("[...document.querySelectorAll('#detail button')].find(b => b.textContent === '안내함으로 기록').click()");
    await sleep(1500); // 저장은 300ms 디바운스 뒤에 일어난다
    const badge = await page.eval("document.querySelector('#tbody tr td:nth-child(4)').innerText");
    check("안내 기록이 화면에 반영된다", /^안내 \d\d-\d\d$/.test(String(badge).trim()), String(badge).trim());

    const tmpState = path.join(userData, "state.json");
    const saved = fs.existsSync(tmpState) ? JSON.parse(fs.readFileSync(tmpState, "utf8")) : null;
    check("임시 저장 폴더에 state.json이 생기고 안내 기록이 들어 있다", !!saved && Object.keys(saved.informed || {}).length === 1, saved ? "informed 주문 " + Object.keys(saved.informed || {}).length + "건" : "파일 없음");
  } catch (e) {
    check("점검 중 오류 없음", false, e.message);
  } finally {
    if (page) page.close();
    killTree(child.pid);
    await sleep(800);
  }

  const realAfter = fingerprint(REAL_STATE);
  check("실제 사용자 데이터(state.json)가 바뀌지 않았다", realBefore === realAfter, realBefore === realAfter ? realBefore : realBefore + "  ->  " + realAfter);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { /* 잠겨 있으면 .gitignore가 막는다 */ }

  const failed = results.filter(r => !r.ok).length;
  console.log("\n" + (failed ? failed + "개 실패" : "모두 통과 (" + results.length + "개)"));
  process.exit(failed ? 1 : 0);
})();
