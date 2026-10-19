// 용어·접근성·대비 점검을 한 번에 돌려 표로 출력한다. 사용: node tools/a11y-audit.js
// 앱을 임시 저장 폴더로 띄우므로 실제 데이터는 건드리지 않는다. 결과는 docs/AUDIT.md 9절 "개선 전/후"에 옮겨 적는다.
const { launchApp } = require("../e2e/helpers");
const P = require("../e2e/a11yProbe");
const BANNED = ["재안내", "확인필요", "안내완료"];

(async () => {
  const app = await launchApp();
  try {
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    await app.setValue("#today", "2026-10-20"); await app.sleep(300);
    await app.click("#tbody tr"); await app.sleep(300);
    await app.clickText("#detail button", "안내함으로 기록"); await app.sleep(300);
    await app.setValue("#today", "2026-10-12"); await app.sleep(300);
    const texts = [];
    const grab = async label => texts.push([label, await app.eval(P.VISIBLE_TEXT)]);
    const tabBtn = name => app.eval(`[...document.querySelectorAll('#mainTabs button')].find(b => b.textContent.trim() === ${JSON.stringify(name)}).click()`);
    for (const tab of ["지연 분석", "오늘 연락할 곳", "보고서", "예외 목록"]) { await tabBtn(tab); await app.sleep(300); await grab(tab); }
    await app.click("#tbody tr"); await app.sleep(300); await grab("상세");
    await app.click("#rulesBtn"); await grab("품목별 기준"); await app.click("#rulesClose");
    await app.click("#emailBtn"); await grab("이메일 패널"); await app.eval("document.getElementById('emailClose').click()");
    console.log("== 금지어 ==");
    for (const [label, t] of texts) BANNED.forEach(w => { const n = t.split(w).length - 1; if (n) console.log(label + ": '" + w + "' " + n + "건"); });
    console.log("== 이름 없는 조작 요소 ==", JSON.stringify(await app.eval(P.UNNAMED)));
    console.log("== 키보드로 못 닿는 표 행 ==", await app.eval(P.CLICKABLE_NOT_FOCUSABLE));
    for (const scheme of ["light", "dark"]) {
      await app.colorScheme(scheme); await app.sleep(300);
      console.log("== 대비 부족 (" + scheme + ") ==\n" + (await app.eval(P.CONTRAST)).map(x => JSON.stringify(x)).join("\n"));
    }
  } finally { await app.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
