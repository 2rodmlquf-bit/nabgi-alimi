// 설치 파일에 들어간 내용을 점검한다 (Phase 8). 사용: node tools/check-package.js   (먼저 npm run dist)
// dist/win-unpacked/resources/app.asar 안의 파일 목록을 보고: 필요한 파일이 다 있고, 개발 도구·시험·문서는 없는지 확인한다.
const fs = require("fs"), path = require("path");
const asar = require("@electron/asar");

const ROOT = path.join(__dirname, "..");
const file = path.join(ROOT, "dist", "win-unpacked", "resources", "app.asar");
if (!fs.existsSync(file)) { console.error("app.asar가 없어요. 먼저 npm run dist를 실행하세요."); process.exit(2); }
const list = asar.listPackage(file).map(x => x.replace(/\\/g, "/"));

// 화면과 메인이 쓰는 파일은 모두 있어야 한다: index.html이 부르는 스크립트 + main.js가 require하는 모듈 + 샘플
const must = new Set(["/main.js", "/preload.js", "/package.json", "/renderer/index.html", "/renderer/renderer.js", "/renderer/style.css", "/build/icon.png", "/샘플주문.csv", "/샘플주문.xlsx"]);
const html = fs.readFileSync(path.join(ROOT, "renderer", "index.html"), "utf8");
[...html.matchAll(/<script src="\.\.\/(src\/[^"]+)"/g)].forEach(m => must.add("/" + m[1]));
const requires = f => [...fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/require\("(\.[^"]+)"\)/g)].map(m => path.posix.join(path.posix.dirname("/" + f.replace(/\\/g, "/")), m[1]).replace(/\.js$/, "") + ".js");
const seen = new Set();
const walk = f => { requires(f).forEach(r => { const rel = r.slice(1); if (seen.has(r) || !fs.existsSync(path.join(ROOT, rel))) { if (!fs.existsSync(path.join(ROOT, rel))) { const idx = r.replace(/\.js$/, "") + "/index.js"; if (fs.existsSync(path.join(ROOT, idx.slice(1)))) { must.add(idx); walk(idx.slice(1)); } } return; } seen.add(r); must.add(r); walk(rel); }); };
walk("main.js");
["샘플메일", "샘플공급사"].forEach(d => { if (!list.some(x => x.startsWith("/" + d + "/"))) must.add("/" + d + "/(폴더)"); });

const missing = [...must].filter(m => !list.includes(m) && !m.endsWith("(폴더)")).concat([...must].filter(m => m.endsWith("(폴더)")));
const unwanted = list.filter(x => /^\/(test|tools|e2e|docs|dist|\.e2e-userdata|\.backup)(\/|$)/.test(x) || /^\/(CHANGELOG|README|기획문서|문제정의서|2차-설계)\.md$/.test(x) || /^\/make-.*\.js$/.test(x));
const size = Math.round(fs.statSync(file).size / 1024);
console.log("app.asar: " + list.length + "개 파일, " + size + "KB");
console.log("필요한 파일 " + must.size + "개 중 빠진 것: " + (missing.length ? missing.join(", ") : "없음"));
console.log("들어가면 안 되는 것(시험·도구·문서): " + (unwanted.length ? unwanted.slice(0, 8).join(", ") : "없음"));
const exe = path.join(ROOT, "dist", "DeliveryWatch-Setup-" + require("../package.json").version + ".exe");
if (fs.existsSync(exe)) console.log("설치 파일: " + path.basename(exe) + " " + (fs.statSync(exe).size / 1048576).toFixed(1) + "MB");
process.exit(missing.length || unwanted.length ? 1 : 0);
