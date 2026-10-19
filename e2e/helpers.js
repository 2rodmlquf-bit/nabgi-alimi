// E2E 도우미: 실제 앱(Electron)을 E2E 모드로 띄우고 Chrome DevTools Protocol(CDP)로 화면을 조작한다.
// 외부 라이브러리 없이 Node 내장 WebSocket·fetch만 쓴다. 안전장치는 src/runtimeEnv.js와 main.js가 맡는다
// (NABGI_E2E=1 은 NABGI_USER_DATA 없이는 시작하지 않는다).
//
// 주의: 화면 스크립트가 다 불러와지기 전에 버튼을 누르면 아무 일도 일어나지 않는다. launchApp이 준비될 때까지 기다린다.
const { spawn, execSync } = require("child_process");
const fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const SAMPLE_ORDERS = path.join(ROOT, "샘플주문.csv");
const REAL_STATE = path.join(process.env.APPDATA || "", "delivery-watch", "state.json");

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 10000, step = 120) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}

// 최소 CDP 클라이언트: 명령 보내기, 이벤트 받기
function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map(), handlers = {};
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method && handlers[m.method]) handlers[m.method].forEach(h => h(m.params));
    };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
      on: (method, fn) => { (handlers[method] = handlers[method] || []).push(fn); },
      close: () => ws.close(),
    });
  });
}

let portSeed = 9400 + Math.floor(Math.random() * 400);
const killTree = pid => { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch (e) { /* 이미 끝남 */ } };
const q = JSON.stringify; // 문자열을 자바스크립트 코드에 안전하게 넣는다

// 앱을 띄운다. userData를 주면 그 폴더를 재사용하고(재시작 시험), 안 주면 새 임시 폴더를 만든다.
async function launchApp({ userData, openFile } = {}) {
  const dir = userData || fs.mkdtempSync(path.join(ROOT, ".e2e-userdata-"));
  const port = portSeed++;
  const child = spawn(ELECTRON, [ROOT, `--remote-debugging-port=${port}`], {
    env: { ...process.env, NABGI_E2E: "1", NABGI_USER_DATA: dir, NABGI_OPEN_FILE: openFile || "" }, stdio: "ignore",
  });
  const errors = [];
  const target = await waitFor(async () => {
    try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); return t.find(x => x.type === "page" && /index\.html/.test(x.url)); } catch (e) { return null; }
  }, 25000);
  if (!target) { killTree(child.pid); throw new Error("앱 화면에 연결하지 못했어요"); }
  const cdp = await connectCdp(target.webSocketDebuggerUrl);

  // 콘솔 오류와 처리되지 않은 예외를 모은다 (시나리오가 끝나면 0건이어야 통과)
  cdp.on("Runtime.exceptionThrown", p => errors.push("예외: " + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)));
  cdp.on("Runtime.consoleAPICalled", p => { if (p.type === "error") errors.push("console.error: " + p.args.map(a => a.value || a.description || "").join(" ")); });
  cdp.on("Log.entryAdded", p => { if (p.entry.level === "error") errors.push("로그 오류: " + p.entry.text + (p.entry.url ? " (" + p.entry.url + ")" : "")); });
  await cdp.send("Runtime.enable"); await cdp.send("Log.enable");

  const app = {
    userData: dir, errors, port,
    eval: async expr => {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error("화면 코드 오류: " + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    sleep, waitFor,
    count: sel => app.eval(`document.querySelectorAll(${q(sel)}).length`),
    exists: async sel => (await app.count(sel)) > 0,
    text: sel => app.eval(`(document.querySelector(${q(sel)}) || {}).innerText`),
    click: async sel => { const ok = await app.eval(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true; })()`); if (!ok) throw new Error("누를 요소가 없어요: " + sel); },
    // scope 안에서 글자가 똑같은 버튼(또는 includes)을 누른다
    clickText: async (scope, text, { exact = true } = {}) => {
      const ok = await app.eval(`(() => { const b = [...document.querySelectorAll(${q(scope)})].find(x => ${exact ? "x.textContent.trim() === " : "x.textContent.includes("}${q(text)}${exact ? "" : ")"}); if (!b) return false; b.click(); return true; })()`);
      if (!ok) throw new Error(`누를 버튼이 없어요: ${scope} "${text}"`);
    },
    setValue: (sel, value, event = "change") => app.eval(`(() => { const e = document.querySelector(${q(sel)}); e.value = ${q(String(value))}; e.dispatchEvent(new Event(${q(event)}, { bubbles: true })); })()`),
    screenshot: async file => { const r = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.result.data, "base64")); },
    close: async () => { try { cdp.close(); } catch (e) { /* 이미 닫힘 */ } killTree(child.pid); await sleep(700); },
  };

  // 화면 스크립트가 준비될 때까지 기다린다
  const ready = await waitFor(() => app.eval("document.readyState === 'complete' && !!window.app && typeof initState === 'function'"), 15000);
  if (!ready) { await app.close(); throw new Error("화면 스크립트가 준비되지 않았어요"); }
  await sleep(600); // initState(저장 기록 읽기)가 끝나길 기다린다
  return app;
}

const fingerprint = f => { try { const c = require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16); const s = fs.statSync(f); return `${c}:${s.size}:${s.mtimeMs}`; } catch (e) { return "(없음)"; } };

module.exports = { ROOT, SAMPLE_ORDERS, REAL_STATE, sleep, waitFor, launchApp, fingerprint };
