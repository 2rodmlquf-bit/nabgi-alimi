// S-10 내보내기(JSON, FR-S08): 로그인·인터넷 없이도 내 기록을 파일로 저장한다. 비밀 정보는 들어가지 않는다.
const fs = require("fs"), path = require("path");
const { ROOT } = require("../helpers");
const Core = require("../../src/store/core");
const { clean } = require("../../src/persist");

module.exports = {
  id: "S-10",
  name: "내보내기(JSON): 로그인 없이 저장, 비밀 정보 없음",
  run: async ctx => {
    const dir = fs.mkdtempSync(path.join(ROOT, ".e2e-userdata-"));
    const out = path.join(dir, "내보낸-기록.json");
    const view = { ...clean(null), informed: { "PO-2026-1001": [{ date: "2026-10-10", channel: "전화", status: "지연", due: "", note: "E2E 첫째" }, { date: "2026-10-11", channel: "메일", status: "지연", due: "", note: "E2E 둘째" }] }, reasons: { "PO-2026-1002": "E2E 사유" }, soonRules: "필터=3" };
    let state = Core.fromView(view, null);
    state = { ...state, cloudLink: { enabled: true, project: "practice", ownerUserId: "E2E-비밀-계정", linkedAt: "x", lastSyncedAt: "y" } };
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state), "utf8");
    process.env.NABGI_SAVE_FILE = out;                       // E2E 모드에서만 저장 창 대신 이 경로에 저장된다
    let app;
    try { app = await ctx.launch({ userData: dir }); } finally { delete process.env.NABGI_SAVE_FILE; }
    await app.click("#cloudBtn"); await app.sleep(300);
    ctx.check("연결·로그인 전에도 '내보내기' 단추가 보인다 (로컬 기록이 기준)", await app.exists("#cloudExport") && (await app.eval("document.getElementById('cloudExportBlock').hidden")) === false);
    await app.eval("document.getElementById('cloudExportBlock').open = true"); await app.sleep(150);
    await app.click("#cloudExport");
    await app.waitFor(async () => fs.existsSync(out), 6000);
    const j = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
    ctx.check("파일이 만들어지고 화면에 저장 위치를 알려 준다", !!j && /저장했어요/.test((await app.text("#cloudExportMsg")) || ""));
    ctx.check("기록 건수와 내용이 들어 있다 (안내 2건, 주문 메모 1건)", !!j && j.format === "nabgi-export" && j.counts.informLog === 2 && j.counts.orderMeta === 1 && j.data.informLog["PO-2026-1001"][0].note === "E2E 첫째");
    ctx.check("클라우드 연결 정보와 계정 id는 들어 있지 않다", !!j && j.data.cloudLink === undefined && !fs.readFileSync(out, "utf8").includes("E2E-비밀-계정"));
    ctx.check("내보내도 이 컴퓨터의 기록은 그대로다", JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).informLog["PO-2026-1001"].length === 2);
  },
};
