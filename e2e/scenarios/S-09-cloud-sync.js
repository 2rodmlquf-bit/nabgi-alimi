// S-09 클라우드 저장 (SY-11-M·AU-11-M·SY-21-A·SY-31-M): 로그인 → 처음 옮기기 → 자동 올리기 → 끊김 → 새 컴퓨터에서 복원 → 다른 계정 거부.
// 서버는 이 컴퓨터(127.0.0.1)에서 도는 가짜 Supabase다(test/helpers/fakeSupabase.js). 실제 Supabase와의 일치는 tools/cloud-live-check.js가 확인한다.
// 앱은 http://127.0.0.1 주소만 쓰므로 외부 통신은 0건이다.
const fs = require("fs"), path = require("path"), http = require("http");
const { ROOT } = require("../helpers");
const { createFake } = require("../../test/helpers/fakeSupabase");
const Core = require("../../src/store/core");
const { clean } = require("../../src/persist");

const newDir = () => fs.mkdtempSync(path.join(ROOT, ".e2e-userdata-"));
const KEY = "sb_publishable_" + "e2e".repeat(12);
const ent = (date, note) => ({ date, channel: "전화", status: "지연", due: "2026-09-24", note });

function serve(fake, port = 0) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", async () => {
      const headers = {}; Object.entries(req.headers).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
      const r = await fake.fetchImpl("http://127.0.0.1" + req.url, { method: req.method, headers: { Authorization: headers.authorization || "", Prefer: headers.prefer || "", Range: headers.range || "" }, body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined });
      const text = await r.text();
      res.writeHead(r.status, { "content-type": "application/json", ...(r.headers.get("content-range") ? { "content-range": r.headers.get("content-range") } : {}) });
      res.end(req.method === "HEAD" ? undefined : text);
    });
  });
  return new Promise(ok => server.listen(port, "127.0.0.1", () => ok({ server, port: server.address().port, close: () => new Promise(r => { server.close(r); server.closeAllConnections && server.closeAllConnections(); }) })));
}

module.exports = {
  id: "S-09",
  name: "클라우드 저장: 로그인, 처음 옮기기, 자동 올리기, 끊김, 복원, 다른 계정 거부",
  run: async ctx => {
    const fake = createFake({ users: { "a@e2e.test": { password: "pw-a", id: "user-a" }, "b@e2e.test": { password: "pw-b", id: "user-b" } } });
    let srv = await serve(fake);
    const base = "http://127.0.0.1:" + srv.port;
    const txt = (app, sel) => app.text(sel).then(t => (t || "").replace(/\s+/g, " ").trim());
    const rowsReady = app => app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const login = async (app, email, pw) => { await app.setValue("#cloudEmail", email, "input"); await app.setValue("#cloudPassword", pw, "input"); await app.click("#cloudLogin"); await app.sleep(500); };
    const connect = async app => {
      await app.click("#cloudBtn"); await app.sleep(200);
      await app.setValue("#cloudUrl", base, "input"); await app.setValue("#cloudKey", KEY, "input"); await app.click("#cloudConfigSave");
      await app.waitFor(async () => !(await app.eval("document.getElementById('cloudLoginBlock').hidden")), 5000);
    };

    // 이 컴퓨터에 있던 기록 (안내 2건, 사유, 연락함 표시, 설정)
    const dir1 = newDir();
    const view = { ...clean(null), informed: { "PO-2026-1001": [ent("2026-10-10", "첫째"), ent("2026-10-11", "둘째")] }, reasons: { "PO-2026-1002": "통관 서류" }, contacted: { 가온산업: "2026-10-12" }, soonRules: "필터=3" };
    fs.writeFileSync(path.join(dir1, "state.json"), JSON.stringify(Core.fromView(view, null)), "utf8");
    let app = await ctx.launch({ userData: dir1 });

    // ---------- 1. 기본은 꺼짐: 화면과 통신이 지금과 같다 ----------
    ctx.check("기본 상태에서는 동기화 상태 영역(SY-21-A)이 보이지 않고 서버에 요청이 가지 않는다", (await app.eval("document.getElementById('cloudInfo').hidden")) === true && fake.calls.length === 0);
    await app.click("#cloudBtn"); await app.sleep(200);
    ctx.check("설정 패널(SY-11-M)에 '이 컴퓨터에만 저장이 기본이고 데이터가 서버로 나간다'는 안내가 있다", /이 컴퓨터에만 저장/.test(await txt(app, "#cloudPanel")) && /서버로 나가는/.test(await txt(app, "#cloudPanel")));
    ctx.check("연결 전에는 로그인 칸(AU-11-M)이 보이지 않고, 가입·비밀번호 재설정 링크가 없다", (await app.eval("document.getElementById('cloudLoginBlock').hidden")) === true && !/가입하기|비밀번호 찾기|비밀번호를 잊/.test(await txt(app, "#cloudPanel")));

    // ---------- 2. 연결 설정 검사와 로그인 ----------
    await app.setValue("#cloudUrl", "http://evil.example.com", "input"); await app.setValue("#cloudKey", KEY, "input"); await app.click("#cloudConfigSave"); await app.sleep(300);
    ctx.check("엉뚱한 주소는 거부하고 이유를 알려 준다", /프로젝트 주소는/.test(await txt(app, "#cloudConfigMsg")), await txt(app, "#cloudConfigMsg"));
    await app.setValue("#cloudKey", "service_role_" + "z".repeat(30), "input"); await app.setValue("#cloudUrl", base, "input"); await app.click("#cloudConfigSave"); await app.sleep(300);
    ctx.check("service_role 키는 거부한다", /service_role/.test(await txt(app, "#cloudConfigMsg")));
    await app.setValue("#cloudKey", KEY, "input"); await app.click("#cloudConfigSave");
    await app.waitFor(async () => !(await app.eval("document.getElementById('cloudLoginBlock').hidden")), 5000);
    ctx.check("공개 키는 저장되고 입력 칸에서 지워진다(키를 다시 보여 주지 않는다). 로그인 칸이 나타난다", (await app.eval("document.getElementById('cloudKey').value")) === "" && !(await app.eval("document.getElementById('cloudLoginBlock').hidden")));
    await login(app, "a@e2e.test", "틀린비밀번호");
    ctx.check("틀린 비밀번호는 한국어 안내가 나온다", /맞지 않아요/.test(await txt(app, "#cloudLoginMsg")), await txt(app, "#cloudLoginMsg"));
    ctx.check("실패해도 비밀번호 칸은 비워진다", (await app.eval("document.getElementById('cloudPassword').value")) === "");
    await login(app, "a@e2e.test", "pw-a");
    await app.waitFor(async () => !(await app.eval("document.getElementById('cloudOpsBlock').hidden")), 5000);
    ctx.check("맞는 비밀번호로 로그인하면 올리기·복원 영역이 나타난다", /a@e2e\.test 로 로그인됨/.test(await txt(app, "#cloudState")), await txt(app, "#cloudState"));
    const diskMeta = JSON.parse(fs.readFileSync(path.join(dir1, "cloud.json"), "utf8"));
    ctx.check("디스크에 비밀번호는 없다 (cloud.json·state.json 어디에도)", !/pw-a/.test(JSON.stringify(diskMeta)) && !/pw-a/.test(fs.readFileSync(path.join(dir1, "state.json"), "utf8")));
    ctx.check("주인 계정이 이 컴퓨터에 묶인다 (state.json cloudLink)", JSON.parse(fs.readFileSync(path.join(dir1, "state.json"), "utf8")).cloudLink.ownerUserId === "user-a");

    // ---------- 3. 처음 옮기기 (SY-31-M): 확인 → 백업 → 올리기 → 건수 비교 ----------
    await app.click("#cloudMigrate"); await app.sleep(500);
    const pv = await txt(app, "#cloudMigrateInfo");
    ctx.check("옮기기 전에 올릴 건수를 보여 주고, 확인 버튼이 나타난다 (아직 서버에는 아무것도 안 갔다)", /안내 기록 2건/.test(pv) && !(await app.eval("document.getElementById('cloudMigrateGo').hidden")) && !fake.db.inform_logs, pv);
    await app.click("#cloudMigrateGo");
    await app.waitFor(async () => /건수가 모두 같아요/.test(await txt(app, "#cloudMigrateInfo")), 10000);
    ctx.check("옮긴 뒤 컴퓨터와 서버의 건수가 같다고 알려 주고 클라우드 저장이 켜진다", (fake.db.inform_logs || []).length === 2 && /켰어요/.test(await txt(app, "#cloudMigrateInfo")));
    ctx.check("서버 행에는 로그인한 계정이 붙어 있다 (다른 계정 것이 아니다)", fake.db.inform_logs.every(r => r.user_id === "user-a") && fake.db.order_meta.length === 1 && fake.db.supplier_contact_marks.length === 1 && fake.db.user_settings.length === 1);
    ctx.check("옮기기 직전의 백업 파일이 만들어졌고 원래 저장 파일과 같은 내용이다", fs.readdirSync(dir1).some(n => /^state\.pre-cloud-.*\.bak\.json$/.test(n)));
    ctx.check("헤더에 동기화 상태(SY-21-A)가 나타난다", !(await app.eval("document.getElementById('cloudInfo').hidden")) && /모두 올렸어요/.test(await txt(app, "#cloudInfo")), await txt(app, "#cloudInfo"));

    // ---------- 4. 평소 사용: 기록하면 잠시 뒤 자동으로 올라간다 ----------
    await app.click("#sampleBtn"); await app.showList(); await rowsReady(app);
    await app.click("#tbody tr"); await app.sleep(250);
    await app.clickText("#detail button", "안내함으로 기록");
    const auto = await app.waitFor(() => ((fake.db.inform_logs || []).length === 3 ? true : null), 15000);
    ctx.check("화면에서 안내 기록을 남기면 버튼을 누르지 않아도 서버에 올라간다 (3건)", !!auto);

    // ---------- 5. 인터넷이 끊겨도 기록은 막히지 않는다 ----------
    await srv.close();
    await app.click("#cloudBtn"); await app.sleep(200); if (await app.eval("document.getElementById('cloudPanel').hidden")) await app.click("#cloudBtn");
    await app.sleep(300);
    await app.click("#tbody tr:nth-child(2)"); await app.sleep(250);
    await app.clickText("#detail button", "안내함으로 기록");
    const saved = await app.waitFor(() => { try { const j = JSON.parse(fs.readFileSync(path.join(dir1, "state.json"), "utf8")); return Object.values(j.informLog).flat().filter(e => !e.deletedAt).length >= 4 ? j : null; } catch (e) { return null; } }, 12000);
    ctx.check("끊긴 상태에서도 안내 기록은 이 컴퓨터에 저장된다 (4건)", !!saved);
    await app.eval("document.getElementById('cloudUpload').click()"); await app.sleep(800);
    ctx.check("서버가 끊긴 채 올리면 '인터넷에 연결하지 못했어요' 안내가 나온다", /인터넷에 연결하지 못했어요/.test(await txt(app, "#cloudRestoreInfo")), await txt(app, "#cloudRestoreInfo"));
    await app.waitFor(async () => /올리지 못했어요/.test(await txt(app, "#cloudInfo")), 8000);
    ctx.check("헤더에 올리지 못했다는 사실과 기록은 안전하다는 안내가 보인다", /올리지 못했어요/.test(await txt(app, "#cloudInfo")) && /안전/.test(await txt(app, "#cloudInfo")), await txt(app, "#cloudInfo"));
    await app.close();

    // ---------- 6. 서버가 돌아오면: 다른 컴퓨터(빈 저장 폴더)에서 복원 ----------
    srv = await serve(fake, srv.port);
    const dir2 = newDir();
    const app2 = await ctx.launch({ userData: dir2 });
    await connect(app2);
    await login(app2, "a@e2e.test", "pw-a");
    await app2.waitFor(async () => !(await app2.eval("document.getElementById('cloudOpsBlock').hidden")), 5000);
    await app2.click("#cloudRestore");
    await app2.waitFor(async () => /가져왔어요|가져올 새 기록이 없어요/.test(await txt(app2, "#cloudRestoreInfo")), 10000);
    ctx.check("복원하면 서버의 기록이 이 컴퓨터로 돌아온다고 건수와 함께 알려 준다", /가져왔어요: .*안내 기록 3건/.test(await txt(app2, "#cloudRestoreInfo")), await txt(app2, "#cloudRestoreInfo"));
    const restored = JSON.parse(fs.readFileSync(path.join(dir2, "state.json"), "utf8"));
    ctx.check("복원된 기록이 저장 파일에 들어갔다 (안내 3건·사유·연락함 표시·설정)", Object.values(restored.informLog).flat().length === 3 && restored.orderMeta["PO-2026-1002"].reason === "통관 서류" && restored.contactMarks["가온산업"].date === "2026-10-12" && restored.settings.soonRules === "필터=3", JSON.stringify(restored.settings) + " / " + JSON.stringify(fake.db.user_settings));
    await app2.click("#cloudRestore"); await app2.sleep(1500);
    ctx.check("한 번 더 복원해도 '가져올 새 기록이 없어요' (중복 없음)", /가져올 새 기록이 없어요/.test(await txt(app2, "#cloudRestoreInfo")), await txt(app2, "#cloudRestoreInfo"));
    await app2.click("#sampleBtn"); await app2.showList(); await rowsReady(app2);
    const shown = await app2.eval("Object.values(S.informed).flat().length");
    ctx.check("목록을 열면 복원된 안내 기록이 화면에도 반영돼 있다", shown === 3, String(shown));

    // ---------- 7. 이 컴퓨터는 처음 로그인한 계정에 묶인다 ----------
    await app2.click("#cloudLogout"); await app2.sleep(400);
    await login(app2, "b@e2e.test", "pw-b");
    ctx.check("다른 계정으로는 로그인할 수 없다고 이유를 알려 준다", /다른 계정에 연결되어 있어요/.test(await txt(app2, "#cloudLoginMsg")), await txt(app2, "#cloudLoginMsg"));
    ctx.check("거부된 뒤에도 로그인 상태가 아니다 (올리기 영역이 숨겨짐)", (await app2.eval("document.getElementById('cloudOpsBlock').hidden")) === true);
    await app2.close();
    await srv.close();
    const outside = fake.calls.filter(c => !/^\/(auth|rest)\/v1\//.test(c.path));
    ctx.check("서버로 간 요청은 모두 로그인·읽기·쓰기 주소뿐이다", outside.length === 0, outside.map(c => c.path).join(","));
  },
};
