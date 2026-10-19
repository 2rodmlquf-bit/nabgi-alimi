// S-05 화면 구조·설정 (PRD FR-17 영역 순서와 접근성, FR-18 다시 안내 기준, FR-19 복사 후 기록 유도).
// 개선 전 측정값(1280x820에서 기록 버튼까지 1,374px 스크롤)은 docs/AUDIT.md에 있다. 여기서는 개선 후 합격선을 지킨다.
const fs = require("fs"), path = require("path");
const { measureAt } = require("../layoutMetrics");

module.exports = {
  id: "S-05",
  name: "화면 구조·설정 (FR-17 영역 순서, FR-18 다시 안내 기준, FR-19 복사 후 기록 유도)",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const badge = (row = 1) => app.text(`#tbody tr:nth-child(${row}) td:nth-child(4)`).then(t => (t || "").replace(/\s+/g, " ").trim());
    const bar = () => app.text("#informBar").then(t => (t || "").replace(/\s+/g, " "));
    const REC = '#detail [data-screen-id="LS-31-A"] button.primary';

    // ---------- FR-17: 영역 순서 ----------
    const m = await measureAt(app, 1280, 820);
    ctx.note("개선 후 측정(1280x820): " + JSON.stringify(m));
    ctx.check("FR-17 안내 현황 막대가 요약 카드 위에 있고 첫 화면에 보인다", m.informBarTop < m.cardsTop && m.informBarVisible === true, "막대 " + m.informBarTop + "px, 카드 " + m.cardsTop + "px");
    ctx.check("FR-17 상세 패널 순서: 안내 기록 → 안내문 → 빠른 메모 → 파일 원래 값", m["LS-31-A"] < m["LS-32-A"] && m["LS-32-A"] < m["LS-33-A"] && m["LS-33-A"] < m.rawValuesTop, [m["LS-31-A"], m["LS-32-A"], m["LS-33-A"], m.rawValuesTop].join(" < "));
    const order = await app.eval(`(() => { const d = document.getElementById('detail'); const pos = sel => { const e = d.querySelector(sel); return e ? e.getBoundingClientRect().top : null; }; return { cause: pos('[data-screen-id="LS-34-A"]'), raw: pos('dl') }; })()`);
    ctx.check("FR-17 파일 원래 값이 지연 원인(LS-34-A)보다 위에 있다", order.raw != null && order.cause != null && order.raw < order.cause, JSON.stringify(order));
    ctx.check("FR-17 합격: 1280x820에서 상세를 연 직후 스크롤 없이 '안내함으로 기록' 버튼이 보인다 (개선 전 1,374px)", m.recordBtnNeedsScroll === 0, m.recordBtnNeedsScroll + "px 필요");
    const m2 = await measureAt(app, 1280, 820, "PO-2026-1010");
    ctx.check("FR-17 안내 기록이 쌓인 주문이어도 기록 버튼 위치가 같다 (기록 목록이 버튼 아래에 있다)", m2.recordBtnNeedsScroll === 0);
    await app.click(REC); await app.sleep(300); await app.click(REC); await app.sleep(300);   // 같은 날 같은 채널 중복은 막히므로 한 건만 쌓인다
    const m3 = await measure(app);
    ctx.check("FR-17 기록 뒤에도 기록 버튼 위치가 변하지 않는다", Math.abs(m3.recordBtnTop - m2.recordBtnTop) <= 2, m2.recordBtnTop + " → " + m3.recordBtnTop);
    await app.viewport(1280, 820);

    // ---------- FR-19: 복사 직후 기록 유도 ----------
    await app.eval("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })");   // 복사 권한 대화상자 없이 시험
    await app.click("#tbody tr:nth-child(1)"); await app.sleep(300);
    const before = await badge(1), informedCount = await app.eval("Object.keys(S.informed).length");
    await app.clickText('#detail [data-screen-id="LS-32-A"] button', "복사"); await app.sleep(300);
    const st = await app.eval(`(() => { const b = document.querySelector(${JSON.stringify(REC)}); return { text: b.textContent.trim(), nudge: b.classList.contains('nudge'), focus: document.activeElement === b, hint: (document.querySelector('#detail .nudgehint') || {}).textContent || '' }; })()`);
    ctx.check("FR-19 안내문을 복사하면 '안내함으로 기록' 버튼이 강조되고 포커스를 받는다", st.text === "안내함으로 기록" && st.nudge && st.focus, JSON.stringify(st));
    ctx.check("FR-19 '복사했어요, 보낸 뒤 눌러 두세요' 안내가 보인다", /보낸 뒤/.test(st.hint));
    ctx.check("FR-19 자동으로 기록하지는 않는다 (앱은 실제로 보냈는지 모른다)", (await badge(1)) === before && (await app.eval("Object.keys(S.informed).length")) === informedCount);
    await app.click("#tbody tr:nth-child(3)"); await app.sleep(300);
    ctx.check("FR-19 기록하지 않고 다른 주문으로 넘어가도 막지 않고, 새 주문에는 강조가 없다", (await app.eval("S.selected")) !== null && (await app.count("#detail button.nudge")) === 0);
    await app.click("#tbody tr:nth-child(1)"); await app.sleep(300);
    await app.clickText('#detail [data-screen-id="LS-32-A"] button', "복사"); await app.sleep(200);
    await app.click(REC); await app.sleep(400);
    ctx.check("FR-19 강조된 버튼 한 번 클릭으로 기록된다", /^안내 /.test(await badge(1)));

    // ---------- FR-18: 다시 안내 기준 일수 ----------
    await app.click("#rulesBtn"); await app.sleep(200);
    ctx.check("FR-18 품목별 임박 기준 패널 안에 '다시 안내 기준'(RU-21-A)이 있고 기본값은 7일이다", (await app.exists('#rulePanel [data-screen-id="RU-21-A"]')) && (await app.eval("document.getElementById('reAlertDays').value")) === "7");
    await app.setValue("#today", "2026-10-15"); await app.sleep(400);          // 첫 주문은 10-12에 안내했다: 3일 지남
    const reCount = async () => +((/다시 안내 (\d+)/.exec(await bar()) || [])[1] || 0);
    const reBefore = await reCount();
    ctx.check("FR-18 기본 7일이면 3일 지난 주문은 아직 '안내 완료'다", /^안내 10-12/.test(await badge(1)), (await badge(1)) + " | 다시 안내 " + reBefore + "건");
    for (const [v, why] of [["0", "0"], ["31", "31"], ["7.5", "소수"], ["", "빈 칸"]]) {
      await app.setValue("#reAlertDays", v, "input"); await app.click("#reAlertApply"); await app.sleep(150);
      const msg = ((await app.text("#reAlertMsg")) || "").trim();
      ctx.check("FR-18 잘못된 값(" + why + ")은 거부하고 이유를 보여 준다. 설정은 그대로다", msg.length > 3 && /일수|숫자|1~30/.test(msg) && (await app.eval("S.reAlertDays")) === null, msg);
    }
    await app.setValue("#reAlertDays", "3", "input"); await app.click("#reAlertApply"); await app.sleep(500);
    ctx.check("FR-18 3일로 바꾸면 새로고침 없이 바로 안내 상태가 '다시 안내'로 바뀌고 현황 막대 숫자도 바뀐다", (await badge(1)) === "다시 안내" && (await reCount()) > reBefore, (await badge(1)) + " | 다시 안내 " + reBefore + " → " + (await reCount()) + "건");
    await app.click("#tbody tr:nth-child(1)"); await app.sleep(300);
    ctx.check("FR-18 상세에 바뀐 기준의 이유가 보인다 (3일째)", /3일째 새 소식을 알리지 않았어요/.test((await app.text('#detail [data-screen-id="LS-31-A"]')) || ""));
    const file = path.join(app.userData, "state.json");
    const saved = await app.waitFor(() => { try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return j.settings && j.settings.reAlertDays === 3 ? j : null; } catch (e) { return null; } }, 5000);
    ctx.check("FR-18 저장 파일(settings)에 3이 남는다", !!saved);
    const dir = app.userData;
    await app.close();
    const app2 = await ctx.launch({ userData: dir });
    ctx.check("FR-18 앱을 다시 켜면 3일이 복원되어 입력 칸에 보인다", (await app2.eval("S.reAlertDays")) === 3 && (await app2.eval("document.getElementById('reAlertDays').value")) === "3");
    await app2.click("#sampleBtn"); await app2.waitFor(async () => (await app2.count("#tbody tr")) > 0);
    await app2.setValue("#today", "2026-10-15"); await app2.sleep(500);
    ctx.check("FR-18 다시 켠 뒤에도 같은 기준으로 판정한다 (첫 주문이 다시 안내)", (await app2.text("#tbody tr:nth-child(1) td:nth-child(4)") || "").replace(/\s+/g, " ").trim() === "다시 안내");
    await app2.click("#rulesBtn"); await app2.click("#reAlertReset"); await app2.sleep(500);
    ctx.check("FR-18 '기본값으로' 누르면 7일로 돌아가고 상태가 즉시 되돌아온다", (await app2.eval("S.reAlertDays")) === null && (await app2.eval("document.getElementById('reAlertDays').value")) === "7" && /^안내 10-12/.test((await app2.text("#tbody tr:nth-child(1) td:nth-child(4)") || "").trim()));
  },
};

async function measure(app) { return require("../layoutMetrics").measure(app); }
