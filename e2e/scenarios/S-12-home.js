// S-12 홈 (PRD FR-20·26, CUJ-6): 파일을 열면 맨 앞 탭 홈에서 오늘 할 일(안내할 것·회신 늦음·오늘 연락할 곳)을 보고, 처음이면 시작 안내가 뜬다.
// 판정 규칙은 단위 시험(test/home.test.js, replies.test.js)이 고정하고, 여기서는 화면이 그 결과를 제대로 보여 주고 이동하는지 본다.
const fs = require("fs"), path = require("path");
const { ROOT } = require("../helpers");
const Core = require("../../src/store/core");
const { clean } = require("../../src/persist");

module.exports = {
  id: "S-12",
  name: "홈: 오늘 할 일 세 묶음, 처음 시작 안내, 회신 늦음과 조용함, 항목을 누르면 주문으로",
  run: async ctx => {
    const txt = async (app, sel) => ((await app.text(sel)) || "").replace(/\s+/g, " ").trim();
    const HOME = "#homeView";

    // ---------- 1. 파일을 열기 전: 빈 화면이 3단계를 안내한다 ----------
    let app = await ctx.launch();
    ctx.check("파일을 열기 전에는 빈 화면(MN-11-P)이 보이고, 시작 순서에 홈이 나온다", !(await app.eval("document.getElementById('empty').hidden")) && /홈/.test(await txt(app, "#empty")) && /안내함으로 기록/.test(await txt(app, "#empty")));

    // ---------- 2. 샘플을 열면 홈이 맨 앞 탭으로 열린다 ----------
    await app.click("#sampleBtn");
    await app.waitFor(async () => !(await app.eval("document.getElementById('mainTabs').hidden")), 8000);
    await app.sleep(400);
    ctx.check("탭이 5개이고 맨 앞 '홈'이 선택돼 열린다 (예외 목록이 아니다)", (await app.count("#mainTabs [role=tab]")) === 5 && (await txt(app, "#mainTabs [role=tab]:first-child")) === "홈" && (await app.eval("document.getElementById('tabHome').getAttribute('aria-selected')")) === "true" && !(await app.eval("document.getElementById('homeView').hidden")) && (await app.eval("document.getElementById('listView').hidden")));
    ctx.check("세 묶음(HM-21-A 안내할 것, HM-22-A 회신 늦음, HM-23-A 오늘 연락할 곳)이 있다", (await app.exists(HOME + ' [data-screen-id="HM-21-A"]')) && (await app.exists(HOME + ' [data-screen-id="HM-22-A"]')) && (await app.exists(HOME + ' [data-screen-id="HM-23-A"]')));
    const inform = await txt(app, HOME + ' [data-screen-id="HM-21-A"]');
    ctx.check("안내할 것은 샘플의 지연 7 + 임박 6 + 확인 필요 2 = 15건이고 모두 미안내다", /15건/.test(inform) && /미안내 15/.test(inform), inform.slice(0, 80));
    ctx.check("회신 늦음은 0건이고 '없어요' 안내가 보인다", /0건/.test(await txt(app, HOME + ' [data-screen-id="HM-22-A"]')) && /없어요/.test(await txt(app, HOME + ' [data-screen-id="HM-22-A"]')));
    ctx.check("오늘 연락할 곳은 1곳 이상이고, 연락 탭과 같은 곳 수다", await app.eval(`(() => { const n = parseInt(document.querySelector('#homeView [data-screen-id="HM-23-A"] .homebig').textContent, 10); return n > 0; })()`));
    const guide = await txt(app, HOME + ' [data-screen-id="HM-24-A"]');
    ctx.check("기록이 하나도 없으니 처음 시작 안내(HM-24-A)가 보이고 1단계는 끝, 2단계가 '지금 할 차례'다", /✓ 1\. 목록 열기/.test(guide) && /2\. 예외 목록에서 주문 눌러 보기 ← 지금 할 차례/.test(guide), guide);
    ctx.check("금지어(재안내·확인필요·안내완료·입고완료)가 홈에 없다", !/재안내|확인필요|안내완료|입고완료/.test(await txt(app, HOME)));

    // ---------- 3. 항목을 누르면 그 주문 상세로 간다 ----------
    await app.click(HOME + ' [data-screen-id="HM-21-A"] ul button');
    await app.waitFor(async () => !(await app.eval("document.getElementById('listView').hidden")), 4000); await app.sleep(300);
    ctx.check("안내할 것의 첫 항목(가장 오래 지연된 주문)을 누르면 예외 목록으로 가서 그 주문 상세가 열린다", (await txt(app, "#detail h2")) === "PO-2026-1001" && (await app.eval("document.getElementById('tabList').getAttribute('aria-selected')")) === "true", await txt(app, "#detail h2"));

    await app.click("#tabHome"); await app.sleep(300);
    const g2 = await txt(app, HOME + ' [data-screen-id="HM-24-A"]');
    ctx.check("주문을 눌러 봤으니 시작 안내가 3단계(안내함으로 기록)로 넘어가고, 끝낸 2단계는 ✓로 흐려진다", /✓ 2\./.test(g2) && /3\. 안내함으로 기록 남기기 ← 지금 할 차례/.test(g2), g2);
    await app.click("#tabList"); await app.sleep(300);

    // ---------- 4. 회신을 기록하면 홈의 회신 늦음에 잡힌다 ----------
    await app.click("#tbody tr:nth-child(2)"); await app.sleep(300);                                      // PO-2026-1002 (바다물산)
    const R = '#detail [data-screen-id="LS-37-A"]';
    await app.setValue(R + ' input[aria-label="회신 받은 날"]', "2026-10-05", "input"); await app.setValue(R + ' input[aria-label="약속일 (선택)"]', "2026-10-09", "input");
    await app.click(R + " button.primary"); await app.sleep(400);
    await app.click("#tabHome"); await app.sleep(400);
    const late = await txt(app, HOME + ' [data-screen-id="HM-22-A"]');
    ctx.check("약속일(10-09)이 기준일(10-12)보다 지난 주문이 홈 '회신 늦음'에 1건, 3일째로 나온다", /1건/.test(late) && /3일째/.test(late) && /PO-2026-1002/.test(late), late);
    await app.click(HOME + ' [data-screen-id="HM-22-A"] ul button'); await app.sleep(400);
    ctx.check("회신 기록도 '기록'이라서 시작 안내는 사라진다", !(await app.exists(HOME + ' [data-screen-id="HM-24-A"]')));
    ctx.check("회신 늦음 항목을 누르면 그 주문 상세로 간다", (await txt(app, "#detail h2")) === "PO-2026-1002" && /회신 늦음 3일째/.test(await txt(app, '#detail [data-screen-id="LS-38-A"]')));

    // ---------- 5. 안내 기록을 남기면 시작 안내가 사라지고 안내할 것이 줄어든다 ----------
    await app.clickText("#detail button", "안내함으로 기록"); await app.sleep(500);
    await app.click("#tabHome"); await app.sleep(400);
    ctx.check("안내할 것이 14건으로 줄고 '미안내 14'가 된다", /14건/.test(await txt(app, HOME + ' [data-screen-id="HM-21-A"]')) && /미안내 14/.test(await txt(app, HOME + ' [data-screen-id="HM-21-A"]')));
    ctx.check("안내 현황의 '예외 목록에서 보기'를 누르면 예외 목록으로 간다", await (async () => { await app.clickText(HOME + ' [data-screen-id="HM-21-A"] button', "예외 목록에서 보기"); await app.sleep(300); return !(await app.eval("document.getElementById('listView').hidden")); })());
    await app.close();

    // ---------- 6. 그날 공급사에 연락했으면 회신 늦음이 조용하다 ----------
    const dir = fs.mkdtempSync(path.join(ROOT, ".e2e-userdata-"));
    const view = { ...clean(null), replies: { "PO-2026-1002": [{ date: "2026-10-05", promised: "2026-10-09", channel: "메일", note: "", source: "manual", supplier: "바다물산" }] }, contacted: { 바다물산: "2026-10-12" } };
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(Core.fromView(view, null)), "utf8");
    const app2 = await ctx.launch({ userData: dir });
    await app2.click("#sampleBtn");
    await app2.waitFor(async () => !(await app2.eval("document.getElementById('homeView').hidden")), 8000); await app2.sleep(500);
    const quiet = await txt(app2, HOME + ' [data-screen-id="HM-22-A"]');
    ctx.check("기준일에 공급사에 연락(연락함 기록)했으면 회신 늦음은 0건이고 '조용히 둬요'가 보인다", /0건/.test(quiet) && /조용히 둬요/.test(quiet), quiet);
  },
};
