// 실제 앱(main.js)을 임시 저장 폴더로 띄워 화면을 캡처한다. 사용자의 state.json은 건드리지 않는다.
// 사용 (Electron으로 실행해야 한다):
//   APP_ROOT=<앱 폴더 절대 경로> OUT_DIR=<저장할 폴더 절대 경로> node_modules/electron/dist/electron.exe tools/capture.js
// README용 캡처 8~14번 화면을 만든다. 샘플 기준일(2026-10-12)과 샘플 주문의 판정 결과에 맞춰 쓴 흐름이다.
const { app, BrowserWindow } = require("electron");
const path = require("path"), fs = require("fs"), os = require("os");
const ROOT = process.env.APP_ROOT, OUT = process.env.OUT_DIR;
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-cap-")));
require(path.join(ROOT, "main.js"));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let win;
const js = code => win.webContents.executeJavaScript(code);
async function shot(name) {
  const h = await js("Math.max(document.documentElement.scrollHeight, 900)");
  win.setContentSize(1266, Math.min(h, 2600));
  await sleep(400);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + ".png"), img.toPNG());
  console.log("saved", name, img.getSize());
}
// 높이를 고정해 찍는다: 페이지를 scrollY까지 내리고, 오른쪽 상세 칸은 selector 요소가 보이게 내린다
async function shotFixed(name, h, scrollY, selector) {
  win.setContentSize(1266, h); await sleep(400);
  await js(`window.scrollTo(0, ${scrollY})`); await sleep(200);
  if (selector) await js(`(()=>{const d=document.getElementById('detail'), e=d.querySelector(${JSON.stringify(selector)}); d.scrollTop += e.getBoundingClientRect().top - d.getBoundingClientRect().top - 12})()`);
  await sleep(300);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + ".png"), img.toPNG());
  console.log("saved", name, img.getSize());
}
// 주문번호가 들어 있는 줄을 누른다
const pickRow = no => js(`(()=>{const r=[...document.querySelectorAll('#tbody tr')].find(r=>r.innerText.includes(${JSON.stringify(no)})); r.click(); return !!r})()`);
const clickBtn = (scope, text) => js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.textContent.includes(${JSON.stringify(text)})); if(!b) return false; b.click(); return true})()`);
const setDate = async d => { await js(`(()=>{const t=document.getElementById('today'); t.value=${JSON.stringify(d)}; t.dispatchEvent(new Event('change'))})()`); await sleep(700); console.log("date", await js("document.getElementById('today').value")); };
const resetView = async () => { await js(`(()=>{document.getElementById('q').value=''; document.getElementById('q').dispatchEvent(new Event('input'))})()`); await sleep(150); await clickBtn("#filterChip button", "필터 해제"); await sleep(150); };

app.whenReady().then(async () => {
  await sleep(1500);
  win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(1266, 900);
  await js("document.getElementById('sampleBtn').click()");
  await sleep(800);

  // 1) 연구원 안내 기록: 1001은 10-12에, 1003은 10-14에 기록하고 10-19로 넘기면 안내 완료·다시 안내·미안내가 모두 보인다
  await pickRow("PO-2026-1001"); await sleep(200);
  await clickBtn("#detail button", "안내함으로 기록"); await sleep(500);
  await setDate("2026-10-14"); await sleep(400);
  await pickRow("PO-2026-1003"); await sleep(200);
  await clickBtn("#detail button", "안내함으로 기록"); await sleep(500);
  await setDate("2026-10-19"); await sleep(400);
  await pickRow("PO-2026-1001"); await sleep(300);
  await shotFixed("08-안내기록", 1000, 470, ".informbox");

  // 이후 화면은 샘플 기준일(10-12)로 돌려서 찍는다
  await setDate("2026-10-12"); await sleep(400);
  await js("window.scrollTo(0,0)");

  // 2) 사람별 보기·한 통 안내문
  const req = await js(`(()=>{const c=[...document.querySelectorAll('#tbody tr')][1].children[7]; c.click(); return c.innerText})()`); await sleep(300);
  console.log("requester", req);
  await clickBtn("#filterChip button", "한 통"); await sleep(400);
  await shot("09-한통안내문");
  await clickBtn("#filterChip button", "필터 해제"); await sleep(300);

  // 3) 정렬·검색: 납기일 정렬 + 검색
  await js(`(()=>{const th=[...document.querySelectorAll('#thead th')].find(t=>t.textContent.startsWith('납기일')); th.click()})()`); await sleep(300);
  await js(`(()=>{const q=document.getElementById('q'); q.value='산업'; q.dispatchEvent(new Event('input'))})()`); await sleep(400);
  await shotFixed("10-정렬검색", 900, 0, null);
  await resetView();
  await js(`(()=>{const th=[...document.querySelectorAll('#thead th')].find(t=>t.textContent.startsWith('납기일')); th.click(); th.click()})()`); await sleep(200);
  await js(`(()=>{const th=[...document.querySelectorAll('#thead th')].find(t=>t.textContent.startsWith('납기일')); if(th.textContent.includes('▲')||th.textContent.includes('▼')) th.click()})()`); await sleep(200);

  // 4) 여러 건 한꺼번에 처리
  await js(`(()=>{[...document.querySelectorAll('#tbody tr')].slice(0,3).forEach(r=>r.querySelector('input[type=checkbox]').click())})()`); await sleep(400);
  await shot("11-여러건처리");
  await js(`(()=>{document.querySelector('#pickBar button.quiet').click()})()`); await sleep(300);

  // 5) 임박 주문 사전 안내문
  await pickRow("PO-2026-1008"); await sleep(300);
  await shotFixed("12-임박사전안내", 1000, 470, ".noticebox");

  // 6) 품목별 임박 기준
  await js(`(()=>{const a=[...document.querySelectorAll('a,button')].find(x=>x.textContent.includes('품목별 임박 기준')); a.click()})()`); await sleep(400);
  await shotFixed("13-품목별임박기준", 900, 0, null);
  await js(`(()=>{const a=[...document.querySelectorAll('a,button')].find(x=>x.textContent.includes('품목별 임박 기준')); a.click()})()`); await sleep(300);

  // 7) 부분 납품
  const partNo = await js(`(()=>{const r=[...document.querySelectorAll('#tbody tr')].find(r=>r.innerText.includes('부분입고')); r.click(); return r.innerText})()`); await sleep(300);
  console.log("partial row", partNo.replace(/\s+/g, " "));
  await js(`(()=>{const s=document.querySelector('.noticebox select'); s.value='부분 납품 안내'; s.dispatchEvent(new Event('change'))})()`); await sleep(400);
  await shotFixed("14-부분납품", 1000, 470, ".noticebox");

  app.quit();
});
