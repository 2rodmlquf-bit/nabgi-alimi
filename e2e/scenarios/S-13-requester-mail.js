// S-13 연구원 문의 요약 + 메일에서 회신 기록 제안 (PRD FR-23·25, SC-06·07, CUJ-5): 판정은 단위 시험이 고정하고, 여기서는 화면이 그 결과를 보여 주고 눌렀을 때 기록되는지 본다.
module.exports = {
  id: "S-13",
  name: "연구원 문의 요약 한 줄, 메일 폴더에서 '공급사 회신으로 기록' 제안과 기록",
  run: async ctx => {
    const txt = async (app, sel) => ((await app.text(sel)) || "").replace(/\s+/g, " ").trim();
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => !(await app.eval("document.getElementById('mainTabs').hidden")), 8000);
    await app.click("#tabList"); await app.sleep(300);

    // ---------- 1. 연구원으로 거르면 위에 요약 한 줄 ----------
    ctx.check("필터가 없으면 연구원 문의 요약(LS-27-A)은 숨겨져 있다", await app.eval("document.getElementById('askBox').hidden"));
    await app.eval("document.querySelector('#tbody tr').children[7].click()"); await app.sleep(300);
    const ask = await txt(app, "#askBox");
    ctx.check("연구원을 누르면 '열린 주문 N건(지연·임박·확인 필요) · 안내할 것 N건' 요약이 보인다", !(await app.eval("document.getElementById('askBox').hidden")) && /연구원 문의 요약/.test(ask) && /열린 주문 \d+건 \(지연 \d+ · 임박 \d+ · 확인 필요 \d+\) · 안내할 것 \d+건/.test(ask), ask);
    ctx.check("요약에 금지어(재안내·확인필요·안내완료·입고완료)가 없다", !/재안내|확인필요|안내완료|입고완료/.test(ask));
    await app.clickText("#filterChip button", "필터 해제"); await app.sleep(250);
    ctx.check("필터를 풀면 요약이 사라진다", await app.eval("document.getElementById('askBox').hidden"));

    // ---------- 2. 샘플 메일 폴더: 근거가 확인된 메일에 회신 기록 제안 ----------
    await app.click("#emailBtn"); await app.sleep(300);
    await app.click("#srcFolder"); await app.click("#folderSample"); await app.sleep(1500);
    await app.click("#presetAll"); await app.click("#folderRun");
    await app.waitFor(async () => (await app.count("#emailResult .replysuggest button")) > 0, 8000); await app.sleep(300);
    const before = await app.count("#emailResult .replysuggest button");
    ctx.check("샘플 메일 폴더를 읽으면 '공급사 회신으로 기록' 제안이 1개 이상 뜬다", before > 0, before + "개");
    ctx.check("제안 문구에 회신 받은 날이 들어 있다", /회신 받은 날 \d{4}-\d{2}-\d{2}/.test(await txt(app, "#emailResult .replysuggest")));

    // ---------- 3. 누르면 기록되고 같은 제안은 사라진다 ----------
    const repliesBefore = await app.eval("Object.values(S.replies).reduce((n, a) => n + a.length, 0)");
    await app.click("#emailResult .replysuggest button"); await app.sleep(400);
    const after = await app.count("#emailResult .replysuggest button");
    const repliesAfter = await app.eval("Object.values(S.replies).reduce((n, a) => n + a.length, 0)");
    ctx.check("누르면 회신 이력이 1건 늘고 출처가 이메일이다", repliesAfter === repliesBefore + 1 && (await app.eval("Object.values(S.replies).flat().some(r => r.source === 'email')")), repliesBefore + "→" + repliesAfter);
    ctx.check("기록한 주문의 제안은 사라진다 (같은 메일 중복 제안 없음)", after === before - 1, before + "→" + after);
  },
};
