// E2E 도우미: 실제 앱(Electron)을 E2E 모드로 띄우고 Chrome DevTools Protocol(CDP)로 화면을 조작한다.
// 외부 라이브러리 없이 Node 내장 WebSocket·fetch만 쓴다. 안전장치는 src/runtimeEnv.js와 main.js가 맡는다
// (NABGI_E2E=1 은 NABGI_USER_DATA 없이는 시작하지 않는다).
//
// 주의: 화면 스크립트가 다 불러와지기 전에 버튼을 누르면 아무 일도 일어나지 않는다. launchApp이 준비될 때까지 기다린다.
const { spawn, execSync } = require("child_process");
const fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
// NABGI_E2E_EXE에 설치 파일이 만든 실행 파일(dist/win-unpacked/납기 알리미.exe)을 주면, 개발용 Electron 대신 그것으로 같은 시험을 돌린다 (Phase 8: 패키징된 앱 확인).
const PACKED_EXE = process.env.NABGI_E2E_EXE && path.isAbsolute(process.env.NABGI_E2E_EXE) ? process.env.NABGI_E2E_EXE : null;
const appCommand = () => (PACKED_EXE ? { cmd: PACKED_EXE, args: [] } : { cmd: ELECTRON, args: [ROOT] });
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
    const ws = new WebSocket(wsUrl); let id = 0, closed = false; const pending = new Map(), handlers = {};
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
      else if (m.method && handlers[m.method]) handlers[m.method].forEach(h => h(m.params));
    };
    ws.onclose = () => { closed = true; pending.forEach(p => p.reject(new Error("앱과의 연결이 닫혔어요"))); pending.clear(); };   // 기다리던 명령이 영원히 멈추지 않게
    ws.onerror = reject;
    ws.onopen = () => resolve({
      send: (method, params = {}, timeoutMs = 15000) => new Promise((res, rej) => {
        if (closed) return rej(new Error("앱과의 연결이 닫혔어요 (" + method + ")"));
        const i = ++id; const timer = setTimeout(() => { pending.delete(i); rej(new Error("앱이 " + timeoutMs / 1000 + "초 안에 응답하지 않았어요 (" + method + ")")); }, timeoutMs);
        pending.set(i, { resolve: m => { clearTimeout(timer); res(m); }, reject: er => { clearTimeout(timer); rej(er); } });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
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
  const errors = [];
  // 앱은 한 개만 뜨도록 잠겨 있다(G-7). 방금 강제로 끈 앱의 잠금이 잠깐 남아 있으면 새 앱이 곧바로 끝나 버리므로, 그때는 조금 기다렸다가 다시 띄운다.
  let port, child, target;
  for (let attempt = 0; attempt < 6; attempt++) {
    port = portSeed++;
    child = spawn(appCommand().cmd, [...appCommand().args, `--remote-debugging-port=${port}`], {
      env: { ...process.env, NABGI_E2E: "1", NABGI_USER_DATA: dir, NABGI_OPEN_FILE: openFile || "" }, stdio: "ignore",
    });
    let exited = false; child.on("exit", () => { exited = true; });
    target = await waitFor(async () => {
      if (exited) return "exited";
      try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); return t.find(x => x.type === "page" && /index\.html/.test(x.url)); } catch (e) { return null; }
    }, 25000);
    if (target && target !== "exited") break;
    killTree(child.pid);
    if (!target) break;                                   // 25초 안에 안 뜸: 다시 해도 소용없다
    await sleep(1200);
  }
  if (!target || target === "exited") { killTree(child.pid); throw new Error("앱 화면에 연결하지 못했어요"); }
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  let closing = false;
  child.on("exit", (code, sig) => { if (!closing) errors.push("앱 프로세스가 갑자기 끝났어요 (code=" + code + ", signal=" + sig + ")"); });   // 시험 도중 앱이 죽으면 원인을 남긴다

  // 콘솔 오류와 처리되지 않은 예외를 모은다 (시나리오가 끝나면 0건이어야 통과)
  cdp.on("Runtime.exceptionThrown", p => errors.push("예외: " + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)));
  cdp.on("Runtime.consoleAPICalled", p => { if (p.type === "error") errors.push("console.error: " + p.args.map(a => a.value || a.description || "").join(" ")); });
  cdp.on("Log.entryAdded", p => { if (p.entry.level === "error") errors.push("로그 오류: " + p.entry.text + (p.entry.url ? " (" + p.entry.url + ")" : "")); });
  await cdp.send("Runtime.enable"); await cdp.send("Log.enable");

  const app = {
    userData: dir, errors, port,
    eval: async expr => {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).catch(e => { throw new Error(e.message + " ← " + String(expr).replace(/\s+/g, " ").slice(0, 110)); });
      if (r.result && r.result.exceptionDetails) throw new Error("화면 코드 오류: " + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    // 파일을 열면 맨 앞 탭이 홈(HM-11-T)이다. 목록·상세를 시험하는 시나리오는 이 도우미로 예외 목록 탭으로 간다. 파일이 안 열렸으면(오류 시험) 기다리다 그냥 넘어간다.
    showList: async (ms = 2500) => { if (await waitFor(() => app.eval("!document.getElementById('mainTabs').hidden"), ms)) await app.click("#tabList"); },
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
    // 창 크기를 흉내 낸다 (레이아웃·미디어 쿼리가 이 크기로 계산된다). 끝나면 앱을 닫으므로 되돌릴 필요 없다.
    viewport: (width, height) => cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }),
    // 키 하나를 실제 키 입력처럼 보낸다 ("Tab", "Enter", "ArrowDown", " " ...). shift: true면 Shift를 누른 채로.
    press: async (key, { shift = false } = {}) => {
      const codes = { Tab: 9, Enter: 13, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, " ": 32, Escape: 27 };
      const text = key === "Enter" ? "\r" : key === " " ? " " : undefined;
      const base = { key, code: key === " " ? "Space" : key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 };
      await cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}) });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(120);
    },
    // 라이트·다크 모드를 흉내 낸다 ("light" | "dark")
    // 끝난 색을 재도록 '동작 줄이기(prefers-reduced-motion)'도 함께 켠다 (앱 CSS가 transition을 끈다).
    colorScheme: value => cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }, { name: "prefers-reduced-motion", value: "reduce" }] }),
    screenshot: async file => { const r = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.result.data, "base64")); },
    close: async () => { closing = true; try { cdp.close(); } catch (e) { /* 이미 닫힘 */ } killTree(child.pid); await sleep(700); },
  };

  // 화면 스크립트가 준비될 때까지 기다린다
  const ready = await waitFor(() => app.eval("document.readyState === 'complete' && !!window.app && typeof initState === 'function'"), 15000);
  if (!ready) { await app.close(); throw new Error("화면 스크립트가 준비되지 않았어요"); }
  await sleep(600); // initState(저장 기록 읽기)가 끝나길 기다린다
  return app;
}

const fingerprint = f => { try { const c = require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16); const s = fs.statSync(f); return `${c}:${s.size}:${s.mtimeMs}`; } catch (e) { return "(없음)"; } };

module.exports = { appCommand, PACKED_EXE, ELECTRON, ROOT, SAMPLE_ORDERS, REAL_STATE, sleep, waitFor, launchApp, fingerprint };
