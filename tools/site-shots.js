// 소개 페이지(site/)에 쓸 화면 캡처를 만든다. 가상 샘플 데이터만 쓰고, 가짜 서버(test/helpers)로 로그인 상태를 흉내 낸다. 사용: node tools/site-shots.js
const fs = require("fs"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, "..");
const { launchApp } = require(ROOT + "/e2e/helpers");
const { createFake } = require(ROOT + "/test/helpers/fakeSupabase");
const OUT = path.join(ROOT, "site", "img");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fake = createFake({ users: { "demo@example.test": { password: "pw", id: "demo" } } });
  const server = http.createServer((req, res) => { const ch = []; req.on("data", c => ch.push(c)); req.on("end", async () => {
    const h = {}; Object.entries(req.headers).forEach(([k, v]) => { h[k.toLowerCase()] = v; });
    const r = await fake.fetchImpl("http://127.0.0.1" + req.url, { method: req.method, headers: { Authorization: h.authorization || "", Prefer: h.prefer || "", Range: h.range || "" }, body: ch.length ? Buffer.concat(ch).toString() : undefined });
    const t = await r.text(); res.writeHead(r.status, { "content-type": "application/json", ...(r.headers.get("content-range") ? { "content-range": r.headers.get("content-range") } : {}) }); res.end(req.method === "HEAD" ? undefined : t); }); });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const app = await launchApp();
  try {
    await app.viewport(1280, 820);
    await app.click("#sampleBtn"); await app.waitFor(async () => !(await app.eval("document.getElementById('homeView').hidden")), 8000); await app.sleep(500);
    await app.screenshot(OUT + "/00-home.png");
    await app.showList(); await app.waitFor(async () => (await app.count("#tbody tr")) > 0); await app.sleep(500);
    await app.screenshot(OUT + "/01-list.png");
    await app.click("#tbody tr:nth-child(2)"); await app.sleep(500);
    await app.screenshot(OUT + "/02-detail.png");
    const R = '#detail [data-screen-id="LS-37-A"]';
    await app.setValue(R + ' input[aria-label="회신 받은 날"]', "2026-10-05", "input"); await app.setValue(R + ' input[aria-label="약속일 (선택)"]', "2026-10-09", "input");
    await app.click(R + " button.primary"); await app.sleep(500);
    await app.screenshot(OUT + "/06-reply.png");
    await app.click("#tabContact"); await app.sleep(500); await app.screenshot(OUT + "/03-contact.png");
    await app.click("#tabAna"); await app.sleep(500); await app.screenshot(OUT + "/04-analysis.png");
    await app.click("#cloudBtn"); await app.sleep(300);
    await app.setValue("#cloudUrl", "http://127.0.0.1:" + server.address().port, "input"); await app.setValue("#cloudKey", "sb_publishable_" + "x".repeat(30), "input"); await app.click("#cloudConfigSave"); await app.sleep(500);
    await app.setValue("#cloudEmail", "demo@example.test", "input"); await app.setValue("#cloudPassword", "pw", "input"); await app.click("#cloudLogin"); await app.sleep(800);
    await app.click("#cloudMigrate"); await app.sleep(400); await app.click("#cloudMigrateGo"); await app.sleep(2500);
    await app.viewport(1280, 1000); await app.sleep(300);
    await app.eval("window.scrollTo(0, 0)"); await app.screenshot(OUT + "/05-cloud.png");
  } finally { await app.close(); server.close(); }
  console.log(fs.readdirSync(OUT).join(", "));
})().catch(e => { console.error(e); process.exit(1); });
