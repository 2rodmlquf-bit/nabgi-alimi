// 화면 배율(125%·150%·200%) 점검: Windows 배율을 올리면 같은 모니터에서 앱이 쓸 수 있는 창이 작아진다 (1920x1080 기준 125% ≈ 1536x830, 150% ≈ 1280x690, 200% ≈ 960x540→최소 900x600).
// 이 창 크기들에서 가로 넘침·잘림·가려짐이 없는지 본다. 사용: node tools/scale-check.js   (창 크기를 바꿔 가며 주 화면과 클라우드 패널을 본다)
const { launchApp } = require("../e2e/helpers");

const SIZES = [["100% (1920x1080 모니터 전체)", 1536, 864], ["125%", 1536, 830], ["150%", 1280, 690], ["200% (최소 창)", 900, 600]];
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); };

const overflowJs = `(() => {
  const vw = document.documentElement.clientWidth, bad = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') continue;
    let p = e.parentElement, clipped = false;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break; } p = p.parentElement; }
    if (!clipped && r.right > vw + 1) bad.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + (e.className || '').toString().split(' ')[0]) + ' ' + Math.round(r.right - vw) + 'px');
  }
  return { scroll: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 5) };
})()`;

(async () => {
  const app = await launchApp();
  try {
    await app.click("#sampleBtn"); await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    for (const [label, w, h] of SIZES) {
      await app.viewport(w, h); await app.sleep(350);
      const hdr = await app.eval("Math.round(document.querySelector('header.top').getBoundingClientRect().height)");
      const o = await app.eval(overflowJs);
      check(label + " " + w + "x" + h + ": 주 화면에 가로 넘침이 없다", o.scroll <= 0 && o.bad.length === 0, "머리 " + hdr + "px " + (o.bad.join(", ") || ""));
      check(label + ": 머리(고정)가 화면 높이의 40% 이하다 (본문이 가려지지 않는다)", hdr <= h * 0.4, hdr + "/" + h);
      await app.click("#cloudBtn"); await app.sleep(300);
      const o2 = await app.eval(overflowJs);
      const ok = await app.eval("(() => { const b = document.getElementById('cloudConfigSave').getBoundingClientRect(); return b.right <= document.documentElement.clientWidth && b.left >= 0; })()");
      check(label + ": 클라우드 패널도 가로 넘침이 없고 '저장' 단추가 화면 안에 있다", o2.scroll <= 0 && o2.bad.length === 0 && ok, o2.bad.join(", "));
      await app.click("#cloudClose"); await app.sleep(200);
    }
  } finally { await app.close(); }
  console.log("\n" + (failed ? failed + "개 실패" : "모두 통과"));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
