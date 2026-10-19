// S-08 오류 경로·규모 (Phase 7, 7-B·7-C): 이상한 상황에서도 앱이 멈추지 않고, 데이터를 잃지 않고, 이유를 알려 주는지 본다.
// 단위 시험(test/stability.test.js, ordersFile.test.js)이 못 보는 "화면에서 어떻게 보이는가"를 확인한다.
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");
const { ELECTRON, ROOT, sleep } = require("../helpers");
const { buildCsv } = require("../../tools/make-large");

const OUT = path.join(__dirname, "..", "out");

module.exports = {
  id: "S-08",
  name: "오류 경로·규모: 한 개만 실행, 저장 불가, 이상한 값·파일, 5,000행",
  run: async ctx => {
    fs.mkdirSync(OUT, { recursive: true });

    // ---------- 같은 앱을 두 개 띄움 (G-7) ----------
    const app = await ctx.launch();
    await app.click("#sampleBtn"); await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const second = spawn(ELECTRON, [ROOT], { env: { ...process.env, NABGI_E2E: "1", NABGI_USER_DATA: app.userData, NABGI_OPEN_FILE: "" }, stdio: "ignore" });
    const exit = await new Promise(res => { const t = setTimeout(() => { try { second.kill(); } catch (e) { /* 이미 끝남 */ } res({ code: "시간 초과" }); }, 12000); second.on("exit", code => { clearTimeout(t); res({ code }); }); });
    ctx.check("G-7 같은 저장 폴더로 앱을 하나 더 띄우면 새 창 없이 곧바로 끝난다 (두 앱이 같은 파일을 덮어쓰지 않게)", exit.code === 0, "종료 코드 " + exit.code);
    ctx.check("G-7 먼저 떠 있던 앱은 그대로 쓸 수 있다", (await app.count("#tbody tr")) === 15);
    await app.close();

    // ---------- 저장 파일을 열 수 없음: state.json 자리에 폴더가 있음 ----------
    const blockedDir = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-blocked-"));
    fs.mkdirSync(path.join(blockedDir, "state.json"));                              // 파일이 아니라 폴더 → 읽기도 쓰기도 못 한다
    const a2 = await ctx.launch({ userData: blockedDir });
    await a2.click("#sampleBtn"); await a2.waitFor(async () => (await a2.count("#tbody tr")) > 0);
    const info = ((await a2.text("#savedInfo")) || "").trim();
    ctx.check("7-C 저장 파일을 열 수 없어도 앱은 뜨고 화면에 이유를 알린다", /저장 파일을 열지 못했어요/.test(info), info.slice(0, 70));
    await a2.click("#tbody tr"); await a2.sleep(250);
    await a2.clickText("#detail button", "안내함으로 기록"); await a2.sleep(700);
    const after = ((await a2.text("#savedInfo")) || "").trim();
    ctx.check("7-C 그 상태에서 기록을 눌러도 멈추지 않는다: 저장은 안 되지만 이유를 알리고, 화면의 작업은 유지된다", /^안내 10-12/.test(((await a2.text("#tbody tr:nth-child(1) td:nth-child(4)")) || "").trim()) && /저장하지 않았어요|저장하지 못했/.test(after), after.slice(0, 90));
    await a2.close();
    fs.rmSync(blockedDir, { recursive: true, force: true });

    // ---------- 기준일·임박 기준에 이상한 값 ----------
    const a3 = await ctx.launch();
    await a3.click("#sampleBtn"); await a3.waitFor(async () => (await a3.count("#tbody tr")) > 0);
    await a3.setValue("#today", ""); await a3.sleep(400);
    const rows1 = await a3.count("#tbody tr");
    ctx.check("7-C 기준일을 비우면 오늘 날짜로 판정하고 목록은 그대로 나온다 (멈추지 않음)", rows1 > 0 && (await a3.exists("#result")) && (await a3.eval("document.getElementById('result').hidden")) === false, rows1 + "행");
    for (const v of ["0", "-5", "", "999"]) {
      await a3.setValue("#soon", v, "input"); await a3.setValue("#soon", v, "change"); await a3.sleep(250);
    }
    ctx.check("7-C 임박 기준에 0·음수·빈 칸·999를 넣어도 멈추지 않고 목록이 나온다", (await a3.count("#tbody tr")) >= 0 && (await a3.eval("document.getElementById('result').hidden")) === false);
    await a3.close();

    // ---------- 빈 파일, 큰 파일, 열 수 없는 파일 ----------
    const empty = path.join(OUT, "s08-empty.csv"); fs.writeFileSync(empty, "");
    const big = path.join(OUT, "s08-big.csv"); fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024, 65));
    const junk = path.join(OUT, "s08-junk.xlsx"); fs.writeFileSync(junk, Buffer.from([0, 1, 2, 3, 0, 5, 6, 7, 0, 9]));
    for (const [file, re, label] of [[empty, /읽을 수 있는 행이 없어요/, "빈 파일"], [big, /너무 커요/, "20MB를 넘는 큰 파일"], [junk, /엑셀.*CSV|열지 못/, "엑셀도 CSV도 아닌 파일"]]) {
      const a = await ctx.launch({ openFile: file });
      await a.click("#openBtn"); await a.sleep(1200);
      const msg = ((await a.text("#fileName")) || "").trim();
      ctx.check("7-C " + label + "는 이유를 알리고 앱은 계속 쓸 수 있다", re.test(msg) && (await a.eval("document.getElementById('openBtn').disabled")) === false, msg.slice(0, 80));
      await a.close();
    }

    // ---------- 규모: 5,000행 (G-4 합격선은 docs/PERF.md) ----------
    const large = path.join(OUT, "s08-large-5000.csv"); fs.writeFileSync(large, buildCsv(5000), "utf8");
    const a4 = await ctx.launch({ openFile: large });
    const t = async code => a4.eval(`(async () => { const t0 = performance.now(); ${code}; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t0); })()`);
    const load = await a4.eval(`(async () => { const t0 = performance.now(); document.getElementById('openBtn').click(); while (!document.querySelector('#tbody tr')) await new Promise(r => setTimeout(r, 5)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t0); })()`);
    const shown = await a4.count("#tbody tr");
    const sort = await t("document.querySelectorAll('#thead th.sortable')[1].click()");
    const search = await t("const q = document.getElementById('q'); q.value = 'PO-L-00'; q.dispatchEvent(new Event('input', { bubbles: true }))");
    await a4.eval("(() => { const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); })()"); await a4.sleep(300);
    const select = await t("document.querySelectorAll('#tbody tr')[3].click()");
    ctx.note("5,000행: 불러오기 " + load + "ms, 정렬 " + sort + "ms, 검색 " + search + "ms, 상세 열기 " + select + "ms (표 " + shown + "행)");
    ctx.check("G-4 5,000행: 불러오기가 합격선(2,000ms) 안이다", load <= 2000, load + "ms");
    ctx.check("G-4 5,000행: 정렬·검색·상세 열기가 합격선(1,000ms) 안이다", sort <= 1000 && search <= 1000 && select <= 1000, sort + " / " + search + " / " + select + "ms");
    ctx.check("G-4 5,000행: 판정 결과가 나온다 (표에 지연·임박·확인 필요가 보인다)", shown > 1000, shown + "행");
  },
};
