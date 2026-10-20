// S-04 엑셀 주문 목록 (PRD FR-07, CUJ-4): 회사 프로그램이 내보낸 .xlsx를 CSV로 다시 저장하지 않고 그대로 연다.
// 여정: 목록 열기 → 열이 자동으로 연결되었는지 확인 → 목록 표시. 안 맞으면 열 연결 화면, 잘리면 알림.
const fs = require("fs"), path = require("path");
const { buildOrderFixtures } = require("../../make-sample-orders-xlsx");

const OUT = path.join(__dirname, "..", "out");
const ROOT = path.join(__dirname, "..", "..");

module.exports = {
  id: "S-04",
  name: "엑셀 주문 목록 (CUJ-4): 열기 → 자동 연결 → 목록, 한도·오류 안내",
  run: async ctx => {
    fs.mkdirSync(OUT, { recursive: true });
    const fx = buildOrderFixtures();
    const put = name => { const f = path.join(OUT, "s04-" + name); fs.writeFileSync(f, fx[name]); return f; };
    const summary = app => app.eval("JSON.stringify({ n: S.rows.length, counts: S.result && S.result.counts, ex: S.result && S.result.exceptions.map(o => o['주문번호'] + ':' + o.status), cols: S.columns })");
    const open = async file => { const app = await ctx.launch({ openFile: file }); await app.click("#openBtn"); await app.showList(); await app.sleep(900); return app; };
    const noteText = async app => (((await app.text("#fileNote")) || "").replace(/\s+/g, " ").trim());

    // ---------- 1. 골든: 같은 내용의 CSV와 xlsx는 같은 결과 ----------
    const a = await open(path.join(ROOT, "샘플주문.csv"));
    await a.waitFor(async () => (await a.count("#tbody tr")) > 0);
    await a.eval("(document.getElementById('today').value = '2026-10-12', document.getElementById('today').dispatchEvent(new Event('change')))"); await a.sleep(300);
    const csvSum = await summary(a);
    await a.close();
    const b = await open(path.join(ROOT, "샘플주문.xlsx"));
    await b.waitFor(async () => (await b.count("#tbody tr")) > 0);
    await b.eval("(document.getElementById('today').value = '2026-10-12', document.getElementById('today').dispatchEvent(new Event('change')))"); await b.sleep(300);
    const xlsxSum = await summary(b);
    ctx.check("엑셀(.xlsx)을 열면 같은 내용의 CSV와 열·행 수·지연/임박/확인 필요 목록이 같다 (FR-07 핵심)", csvSum === xlsxSum && JSON.parse(xlsxSum).n > 0, JSON.parse(xlsxSum).n + "행");
    ctx.check("열이 자동으로 연결되어 열 연결 화면이 열리지 않고, 알릴 것이 없으면 안내 줄도 없다 (CUJ-4 2단계)", (await b.eval("document.getElementById('mapPanel').hidden")) === true && (await b.eval("document.getElementById('fileNote').hidden")) === true);
    ctx.check("파일 이름과 전체 건수가 머리에 보인다 (CUJ-4 3단계)", /샘플주문\.xlsx · 전체 \d+건/.test((await b.text("#fileName")) || ""));
    await b.close();

    // ---------- 2. 제목 줄이 있는 파일 ----------
    const c = await open(put("02-제목줄과합친칸.xlsx"));
    await c.waitFor(async () => (await c.count("#tbody tr")) > 0);
    ctx.check("표 위에 제목 줄이 있어도 머리글을 찾고, 몇 번째 줄을 열 이름으로 읽었는지 알려 준다", /4번째 줄을 열 이름으로/.test(await noteText(c)) && JSON.parse(await summary(c)).n === JSON.parse(csvSum).n, await noteText(c));
    await c.close();

    // ---------- 3. 5,001줄: 일부만 읽었다고 알린다 ----------
    const d = await open(put("09-5001줄.xlsx"));
    await d.waitFor(async () => (await d.eval("S.rows.length")) > 0);
    const warnCls = await d.eval("(document.querySelector('#fileNote .warnline') || {}).className || ''");
    ctx.check("한도(5,000줄)를 넘으면 '일부만 읽었다'고 경고색으로 알리고 읽은 행 수는 4,999다", /앞의 5000줄까지만/.test(await noteText(d)) && warnCls.includes("warnline") && (await d.eval("S.rows.length")) === 4999, await noteText(d));
    await d.close();

    // ---------- 4. 열 이름이 다른 파일 → 열 연결 화면 ----------
    const e = await open(put("14-열이름다름.xlsx"));
    const mapShown = await e.waitFor(async () => (await e.eval("document.getElementById('mapPanel').hidden")) === false, 5000);
    ctx.check("납기일 열을 못 찾으면 열 연결 화면이 열리고 목록은 숨는다 (사람이 확인한 뒤 반영)", !!mapShown && (await e.eval("document.getElementById('result').hidden")) === true);
    await e.setValue("#map-납기일", "도착예정"); await e.click("#applyMap");
    ctx.check("엑셀의 열을 연결하면 목록이 나온다", !!(await e.waitFor(async () => (await e.count("#tbody tr")) > 0 || (await e.eval("S.rows.length")) === 1, 5000)) && (await e.eval("S.rows.length")) === 1);
    await e.close();

    // ---------- 5. 시트가 둘 다 표 ----------
    const f = await open(put("13-시트둘다표.xlsx"));
    await f.waitFor(async () => (await f.eval("S.rows.length")) > 0);
    const before = await f.eval("S.rows.length");
    ctx.check("표가 있는 시트가 여럿이면 시트 선택 칸이 보인다", (await f.exists("#fileNote select")) && before === 3, "처음 읽은 행 " + before + " (점수가 같으면 앞 시트)");
    await f.setValue("#fileNote select", "1", "change"); await f.sleep(500);
    ctx.check("다른 시트를 고르면 그 시트의 행으로 바뀐다", (await f.eval("S.rows.length")) === 5 && /'B동'/.test(await noteText(f)), await noteText(f));
    await f.close();

    // ---------- 6. 읽을 수 없는 파일: 멈추지 않고 이유를 알려 준다 ----------
    for (const [name, re, label] of [["12-구형xls.xls", /\.xls\(구형 엑셀\)/, "구형 .xls 파일"], ["10-손상.xlsx", /\S{6,}/, "손상된 파일"]]) {
      const g = await open(put(name));
      const msg = ((await g.text("#fileName")) || "").trim();
      ctx.check(label + "은(는) 이유를 알려 주고 앱은 계속 쓸 수 있다", re.test(msg) && (await g.eval("document.getElementById('openBtn').disabled")) === false, msg);
      await g.click("#sampleBtn"); await g.showList();
      ctx.check(label + " 다음에도 샘플을 열 수 있다", !!(await g.waitFor(async () => (await g.count("#tbody tr")) > 0, 5000)));
      await g.close();
    }
  },
};
