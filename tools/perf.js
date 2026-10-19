// 성능 측정: 큰 주문 목록(1,000 / 5,000 / 10,000행)에서 화면이 얼마나 걸리는지 잰다. 사용: node tools/perf.js [반복 횟수=3]
// 앱을 임시 저장 폴더로 띄우므로 실제 데이터는 건드리지 않는다. 결과(중앙값, ms)를 docs/PERF.md에 옮겨 적는다.
// 측정 방법: 화면 안에서 performance.now()로 잰다. "불러오기" = 열기 단추를 누른 뒤 표의 첫 행이 그려질 때까지.
const fs = require("fs"), path = require("path");
const { launchApp, sleep } = require("../e2e/helpers");
const { buildCsv } = require("./make-large");

const SIZES = [1000, 5000, 10000];
const REPEAT = Math.max(1, parseInt(process.argv[2], 10) || 3);
const OUT = path.join(__dirname, "..", "e2e", "out");
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function runOnce(rows) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "perf-" + rows + ".csv");
  fs.writeFileSync(file, buildCsv(rows), "utf8");
  const app = await launchApp({ openFile: file });
  try {
    const m = { rows };
    // 불러오기: 단추 클릭 → 첫 행이 보일 때까지 (IPC로 파일 읽기 + 파싱 + 판정 + 표 그리기)
    m.load = await app.eval(`(async () => {
      const t0 = performance.now();
      document.getElementById('openBtn').click();
      while (!document.querySelector('#tbody tr')) await new Promise(r => setTimeout(r, 5));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));            // 실제로 그려진 뒤
      return performance.now() - t0;
    })()`);
    m.shown = await app.count("#tbody tr");
    // 정렬: 머리글 클릭 → 표가 다시 그려질 때까지
    m.sort = await app.eval(`(async () => { const th = document.querySelectorAll('#thead th.sortable')[1]; const t0 = performance.now(); th.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; })()`);
    // 검색: 한 글자씩 입력하는 것과 같은 input 이벤트
    m.search = await app.eval(`(async () => { const q = document.getElementById('q'); const t0 = performance.now(); q.value = 'PO-L-00'; q.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const t = performance.now() - t0; q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); return t; })()`);
    // 안내 기록 한 번: 상세 열기 → 기록 단추 → 표·막대가 갱신될 때까지
    m.record = await app.eval(`(async () => {
      document.querySelector('#tbody tr').click();
      await new Promise(r => setTimeout(r, 50));
      const btn = [...document.querySelectorAll('#detail button')].find(b => b.textContent.trim() === '안내함으로 기록');
      const t0 = performance.now(); btn.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0;
    })()`);
    // 행을 눌러 상세 열기
    m.select = await app.eval(`(async () => { const tr = document.querySelectorAll('#tbody tr')[3]; const t0 = performance.now(); tr.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; })()`);
    m.heapMB = Math.round((await app.eval("performance.memory ? performance.memory.usedJSHeapSize : 0")) / 1048576);
    m.errors = app.errors.length;
    return m;
  } finally { await app.close(); }
}

(async () => {
  console.log("| 행 수 | 표에 나온 행 | 불러오기 | 정렬 | 검색 | 안내 기록 | 상세 열기 | JS 메모리 |\n|---|---|---|---|---|---|---|---|");
  for (const rows of SIZES) {
    const runs = [];
    for (let i = 0; i < REPEAT; i++) runs.push(await runOnce(rows));
    const f = k => Math.round(median(runs.map(r => r[k])));
    console.log("| " + rows.toLocaleString("en-US") + " | " + runs[0].shown + " | " + f("load") + "ms | " + f("sort") + "ms | " + f("search") + "ms | " + f("record") + "ms | " + f("select") + "ms | " + f("heapMB") + "MB |" + (runs.some(r => r.errors) ? " 오류 있음" : ""));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
