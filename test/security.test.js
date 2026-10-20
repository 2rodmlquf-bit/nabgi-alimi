// 보안·개인정보 점검 (Phase 7, 7-D): 매번 자동으로 확인한다. 코드를 읽어 위험한 패턴이 생기지 않았는지 본다.
// - 화면에 데이터를 넣을 때 HTML로 해석하지 않는다 (innerHTML 등 0건)
// - 화면 권한: contextIsolation, nodeIntegration 끔, CSP script-src 'self'
// - preload가 여는 기능 목록은 의도한 것만 (몰래 늘어나면 여기서 걸린다)
// - 외부 통신은 한 곳(Claude API, 사용자가 키를 넣었을 때만)이다
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const list = dir => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(".js")).map(f => dir + "/" + f);
// 주석과 문자열 안의 말이 아니라 코드를 보려고 주석만 걷어 낸다
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const RENDERER_FILES = [...list("renderer"), "preload.js"];
const SRC_FILES = [...list("src"), ...list("src/store"), ...list("src/sync")];

test("화면(renderer)과 화면이 쓰는 src 코드에 HTML 해석·동적 실행이 0건이다", () => {
  const banned = [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write\s*\(/, /\beval\s*\(/, /new Function\s*\(/, /setTimeout\s*\(\s*["'`]/, /dangerouslySetInnerHTML/];
  const hits = [];
  [...RENDERER_FILES, ...SRC_FILES, "main.js"].forEach(f => banned.forEach(re => { if (re.test(code(f))) hits.push(f + " " + re); }));
  assert.deepEqual(hits, []);
});

test("창 설정: contextIsolation 켜짐, nodeIntegration 꺼짐, preload 지정", () => {
  const main = code("main.js");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
  assert.doesNotMatch(main, /contextIsolation:\s*false/);
  assert.doesNotMatch(main, /webSecurity:\s*false/);
  assert.doesNotMatch(main, /enableRemoteModule/);
  assert.match(main, /preload:\s*path\.join\(__dirname,\s*"preload\.js"\)/);
});

test("CSP: script-src 'self'만, 인라인·eval·외부 주소 허용 없음", () => {
  const html = read("renderer/index.html");
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  assert.ok(csp, "CSP 메타가 있어야 한다");
  assert.match(csp[1], /script-src 'self'(;|$)/);
  assert.match(csp[1], /default-src 'self'/);
  assert.doesNotMatch(csp[1], /unsafe-inline|unsafe-eval|https?:|\*/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[^<]/);                 // 인라인 스크립트 없음
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*"/i);                              // onclick="…" 같은 인라인 이벤트 없음
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);                         // 외부 스크립트 없음
});

test("preload가 화면에 여는 기능 목록 (늘어나면 이 목록과 함께 검토한다). 키를 읽어 오는 기능은 없다", () => {
  const names = [...code("preload.js").matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]).sort();
  assert.deepEqual(names, ["clearKey", "clearState", "extractEmail", "keyStatus", "loadSample", "loadSampleMails", "loadSampleSupplier", "loadState", "mapColumns",
    "openCsv", "openMailAttachment", "openOrders", "pickMailFolder", "pickSupplierFile", "saveFile", "saveKey", "saveState", "stateInfo",
    "exportState", "cloudStatus", "cloudConfigure", "cloudLogin", "cloudLogout", "cloudEnable", "cloudUpload", "cloudPreview", "cloudMigrate", "cloudRestore", "cloudVerify", "cloudUnlink"].sort());   // 클라우드 기능 11개는 ADR-0006. 토큰·키를 돌려주는 것은 없다
  assert.doesNotMatch(read("preload.js"), /require\((?!"electron")/);               // electron 말고 다른 모듈을 끌어오지 않는다
  assert.ok(!names.some(n => /^(getKey|readKey|key)$/.test(n)), "키 값을 돌려주는 기능이 없어야 한다");
});

test("외부 통신은 main.js의 Claude API 호출 한 곳뿐이고, 사용자가 키를 넣었을 때만 일어난다", () => {
  const main = code("main.js");
  const calls = main.match(/\bfetch\s*\(/g) || [];
  assert.equal(calls.length, 1);
  assert.match(main, /fetch\("https:\/\/api\.anthropic\.com\/v1\/messages"/);
  const urls = [...main.matchAll(/https?:\/\/[^\s"'`)]+/g)].map(m => m[0]);
  assert.ok(urls.every(u => u.startsWith("https://api.anthropic.com/")), urls.join(", "));
  const fn = /async function callClaude[\s\S]*?\n}/.exec(main);
  assert.ok(fn, "callClaude가 있어야 한다");
  assert.match(fn[0], /readKey\(\)/);                                              // 키가 없으면 호출하지 않는다
  [...RENDERER_FILES.filter(f => f !== "preload.js"), ...SRC_FILES].forEach(f => assert.doesNotMatch(code(f), /\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|navigator\.sendBeacon/, f));
});

test("CSV로 내보낼 때 =, +, -, @로 시작하는 칸은 수식으로 실행되지 않게 막는다", () => {
  const { toCsv } = require("../src/report");
  const out = toCsv(["열"], [['=HYPERLINK("http://example.com","x")'], ["+1"], ["-2"], ["@SUM(1)"], ["정상"]]);
  const cells = out.split(/\r?\n/).slice(1);
  cells.slice(0, 4).forEach(c => assert.match(c, /^"?'[=+\-@]/, c));
  assert.equal(cells[4], "정상");
});

test("클라우드 저장: 서버 통신은 src/sync/client.js 한 곳뿐이고, 서비스 키·비밀번호 저장이 없고, 화면은 서버 주소로 직접 통신하지 않는다", () => {
  const withFetch = SRC_FILES.filter(f => /globalThis\.fetch|fetchImpl/.test(code(f)));
  assert.deepEqual(withFetch.sort(), ["src/sync/client.js", "src/sync/engine.js"].sort());          // engine은 주입만 받아 넘긴다
  assert.doesNotMatch(code("src/sync/client.js"), /https?:\/\/(?!localhost|127\.0\.0\.1|\.\.\.|abc)[a-z0-9.-]+\.[a-z]{2,}/i);   // 코드에 박아 둔 서버 주소 없음 (주소는 사용자가 설정)
  SRC_FILES.concat(["main.js"]).forEach(f => assert.doesNotMatch(code(f), /service_role\s*[:=]\s*["']/, f));
  assert.doesNotMatch(code("src/sync/filePersist.js"), /password/i);                              // 비밀번호는 저장하지 않는다
  assert.doesNotMatch(code("renderer/renderer.js"), /supabase\.co|\/rest\/v1|\/auth\/v1/);          // 화면은 서버를 모른다
});
