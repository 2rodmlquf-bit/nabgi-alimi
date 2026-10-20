// QA 화면을 내 컴퓨터에서만 연다. 사용: node supabase/qa/serve.js  →  브라우저에서 http://localhost:5173
// 127.0.0.1(이 컴퓨터)에서만 접속된다. 같은 네트워크의 다른 컴퓨터는 접속할 수 없다 (시험 계정 정보가 들어 있는 파일을 서비스하므로).
// 끄려면 이 창에서 Ctrl+C.
const http = require("http"), fs = require("fs"), path = require("path");

const PORT = parseInt(process.env.PORT, 10) || 5173;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
const ALLOWED = new Set(["index.html", "qa-config.local.js", "qa-users.local.js"]);        // 이 파일들만 내 준다

http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
  if (!ALLOWED.has(name)) { res.writeHead(404); return res.end("not found"); }
  const file = path.join(__dirname, name);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(name)] || "text/plain", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log("QA 화면: http://localhost:" + PORT + "  (끄려면 Ctrl+C)"));
