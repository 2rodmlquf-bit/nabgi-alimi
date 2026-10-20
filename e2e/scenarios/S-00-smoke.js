// S-00 스모크: 앱이 뜨고, 샘플을 열고, 안내 기록을 남기고, 앱을 다시 켜도 기록이 복원된다.
// 모든 단계의 종료 조건에 들어가는 가장 기본적인 시험이다 (devpian.md T1.11).
const fs = require("fs"), path = require("path");

module.exports = {
  id: "S-00",
  name: "스모크: 샘플 열기 → 안내 기록 → 재시작 후 복원",
  run: async ctx => {
    const app = await ctx.launch();

    ctx.check("시작 직후 '불러온 파일 없음' 화면이 보인다", (await app.eval("document.getElementById('empty').hidden")) === false);

    await app.click("#sampleBtn");
    const rows = await app.waitFor(async () => { const n = await app.count("#tbody tr"); return n > 0 ? n : null; });
    ctx.check("샘플을 열면 예외 목록이 나온다", !!rows, rows + "행");
    const cards = await app.eval("['nLate','nSoon','nOk','nDone','nCheck'].map(id => document.getElementById(id).textContent).join('/')");
    ctx.check("요약 카드가 샘플(기준일 2026-10-12)과 같다: 지연 7 · 임박 6 · 정상 19 · 입고 완료 4 · 확인 필요 2", cards === "7/6/19/4/2", cards);
    ctx.check("처음에는 첫 주문이 '미안내'다", (await app.text("#tbody tr td:nth-child(4)")).trim() === "미안내");

    await app.click("#tbody tr");
    const orderNo = ((await app.text("#detail h2")) || "").trim();
    ctx.check("주문을 누르면 상세가 열린다", /^PO-/.test(orderNo), orderNo);

    await app.clickText("#detail button", "안내함으로 기록");
    const badge = await app.waitFor(async () => { const t = ((await app.text("#tbody tr td:nth-child(4)")) || "").trim(); return /^안내 \d\d-\d\d$/.test(t) ? t : null; }, 5000);
    ctx.check("안내 기록을 남기면 표에 '안내 MM-DD'가 보인다", badge === "안내 10-12", badge || "(안 바뀜)");
    ctx.check("현황 막대에 '완료 1'이 보인다", /완료 1/.test((await app.text("#informBar")) || ""));

    // 저장은 300ms 디바운스 뒤에 일어난다
    const stateFile = path.join(app.userData, "state.json");
    const saved = await app.waitFor(() => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null), 5000);
    const entries = saved && saved.informLog && saved.informLog[orderNo];   // 저장 모델 v1: informLog
    ctx.check("임시 저장 폴더의 state.json(v2)에 기록이 id·만든 시각과 함께 들어간다", saved && saved.schemaVersion === 2 && Array.isArray(entries) && entries.length === 1 && entries[0].date === "2026-10-12" && entries[0].status === "지연" && !!entries[0].id && !!entries[0].createdAt && !entries[0].deletedAt, entries ? JSON.stringify(entries[0]) : "저장 안 됨");

    // 재시작: 같은 저장 폴더로 다시 켠다
    const dir = app.userData;
    await app.close();
    const app2 = await ctx.launch({ userData: dir });
    await app2.click("#sampleBtn");
    await app2.waitFor(async () => (await app2.count("#tbody tr")) > 0);
    const restored = ((await app2.text("#tbody tr td:nth-child(4)")) || "").trim();
    ctx.check("앱을 다시 켜고 샘플을 열면 기록이 복원된다", restored === "안내 10-12", restored);
  },
};
