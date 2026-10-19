// 화면 배치를 두 가지 창 크기에서 재서 표로 출력한다. 사용: node tools/measure-layout.js
// 개선 전·후 값을 docs/AUDIT.md에 옮겨 적는다. 앱을 임시 저장 폴더로 띄우므로 실제 데이터는 건드리지 않는다.
const { launchApp } = require("../e2e/helpers");
const { measureAt } = require("../e2e/layoutMetrics");

(async () => {
  const app = await launchApp();
  try {
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    for (const [w, h] of [[1280, 820], [900, 600]]) console.log(JSON.stringify(await measureAt(app, w, h)));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });
