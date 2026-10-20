// 여정 워크스루 (Phase 9, 9.4): CUJ-1~4를 처음부터 끝까지 따라 하며 "조작 횟수"와 "화면 반응 시간"을 잰다.
// 사용: node tools/walkthrough.js            (개발용 Electron)
//       NABGI_E2E_EXE="<...>\\납기 알리미.exe" node tools/walkthrough.js   (설치 파일이 만든 패키지된 앱)
// 주의: 사람이 한 것이 아니라 **스크립트가 한 것**이다. 시간은 화면이 반응하는 기계 시간이라 uj.md의 "건당 소요 시간"(사람이 읽고 판단하는 시간 포함)이 아니다.
//       의미 있는 숫자는 "조작 횟수"(클릭·키 입력 수)다. 사용자 조사가 아니다.
const path = require("path");
const { launchApp, PACKED_EXE } = require("../e2e/helpers");
const { measure } = require("../e2e/layoutMetrics");

const rows = [];
async function journey(name, app, steps) {
  const t0 = Date.now(); let n = 0;
  for (const [label, fn] of steps) { await fn(); n++; }
  rows.push({ name, actions: n, ms: Date.now() - t0, labels: steps.map(s => s[0]).join(" → ") });
}

(async () => {
  console.log("대상: " + (PACKED_EXE ? "패키지된 앱 " + path.basename(PACKED_EXE) : "개발용 Electron") + "\n");
  const app = await launchApp();
  try {
    await app.eval("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })");
    const wait = () => app.sleep(250);
    await app.click("#sampleBtn"); await app.showList(); await app.waitFor(async () => (await app.count("#tbody tr")) > 0);

    // CUJ-1 ① 한 건씩 (마우스)
    await journey("CUJ-1 한 건 안내 기록 (마우스)", app, [["주문 선택", async () => { await app.click("#tbody tr"); await wait(); }], ["안내함으로 기록", async () => { await app.clickText("#detail button", "안내함으로 기록"); await wait(); }]]);
    // CUJ-1 ② 한 건씩 (키보드만)
    await journey("CUJ-1 한 건 안내 기록 (키보드만)", app, [
      ["표에 포커스", async () => { await app.eval("document.querySelectorAll('#tbody tr')[1].focus()"); }],
      ["Enter(상세로)", async () => { await app.press("Enter"); await wait(); }], ["Tab", () => app.press("Tab")], ["Tab", () => app.press("Tab")],
      ["Enter(기록)", async () => { await app.press("Enter"); await wait(); }],
    ]);
    // CUJ-1 ③ 연구원 한 명의 건을 한 통으로
    const before = await app.eval("S.result.exceptions.length");
    await journey("CUJ-1 한 연구원 건을 한 통으로 (건수 N)", app, [
      ["연구원 칸 클릭", async () => { await app.eval("document.querySelectorAll('#tbody tr')[3].querySelectorAll('td.pick')[1].click()"); await wait(); }],
      ["한 통 안내문 열기", async () => { await app.clickText("#filterChip button", "이 연구원에게 한 통 안내문"); await wait(); }],
      ["복사", async () => { await app.clickText("#digestBox button", "복사"); await wait(); }],
      ["N건 안내함으로 기록", async () => { await app.eval("[...document.querySelectorAll('#digestBox button')].find(b => /안내함으로 기록/.test(b.textContent)).click()"); await wait(); }],
    ]);
    const nBatch = await app.eval("(/\\((\\d+)건\\)/.exec(document.querySelector('#digestBox h2').textContent) || [])[1]");
    rows[rows.length - 1].name = rows[rows.length - 1].name.replace("N", nBatch);
    rows[rows.length - 1].perOrder = (4 / +nBatch).toFixed(1);
    await app.click("#filterChip button.quiet"); await wait();

    // CUJ-2 다시 안내
    await journey("CUJ-2 다시 안내 확인 후 기록", app, [
      ["기준일 변경(8일 뒤)", async () => { await app.setValue("#today", "2026-10-20"); await app.sleep(400); }],
      ["다시 안내 주문 선택", async () => { await app.eval("[...document.querySelectorAll('#tbody tr')].find(tr => /다시 안내/.test(tr.textContent)).click()"); await wait(); }],
      ["안내함으로 기록", async () => { await app.clickText("#detail button", "안내함으로 기록"); await wait(); }],
    ]);
    await app.setValue("#today", "2026-10-12"); await app.sleep(300);

    // CUJ-3 빠른 메모
    await journey("CUJ-3 전화 소식 메모", app, [
      ["검색", async () => { await app.setValue("#q", "1005", "input"); await app.sleep(300); }], ["주문 선택", async () => { await app.click("#tbody tr"); await wait(); }],
      ["메모 입력", async () => { await app.setValue('#detail [data-screen-id="LS-33-A"] textarea', "통관 중이라고 들음", "input"); }],
      ["Ctrl+Enter로 남기기", async () => { await app.eval("document.querySelector('#detail [data-screen-id=\"LS-33-A\"] textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))"); await wait(); }],
    ]);

    const m = await measure(app);
    console.log("| 여정 | 조작 횟수 | 건당 조작 | 화면 반응 시간(기계) | 순서 |\n|---|---|---|---|---|");
    rows.forEach(r => console.log("| " + r.name + " | " + r.actions + " | " + (r.perOrder || r.actions) + " | " + r.ms + "ms | " + r.labels + " |"));
    console.log("\n(CUJ-4는 파일을 여는 대화상자가 자동화되지 않아 E2E S-04가 같은 경로로 확인한다: 열기 1회 + 필요하면 열 연결 확인.)");
    console.log("안내 기록 버튼이 보이려면 더 내려야 하는 양(1280x820 기준, 마지막 연 주문): " + m.recordBtnNeedsScroll + "px");
  } finally { await app.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
