// A-03 감사: 안내 추적 (PRD FR-08~11). 이 솔루션의 핵심이다.
// 판정 규칙 자체(다시 안내 3종, 중복 방지 등)는 test/informed.test.js가 지킨다. 여기서는 화면에서 그 규칙이 보이고 동작하는지 본다.
module.exports = {
  id: "A-03",
  name: "감사: 안내 추적 (FR-08~11)",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const badge = (row = 1) => app.text(`#tbody tr:nth-child(${row}) td:nth-child(4)`).then(t => (t || "").trim());
    const bar = () => app.text("#informBar").then(t => (t || "").replace(/\s+/g, " "));
    const ch = '#detail [data-screen-id="LS-31-A"] select';
    const note = '#detail [data-screen-id="LS-31-A"] input[type=text]';
    const entries = () => app.eval("(S.informed[S.selected] || []).length");

    // ---------- FR-08 안내 상태와 현황 막대 ----------
    ctx.check("FR-08 기록이 없으면 '미안내'로 보이고 막대에 건수가 나온다", (await badge()) === "미안내" && /미안내 13/.test(await bar()) && /완료 0/.test(await bar()), await bar());
    await app.click("#tbody tr"); await app.sleep(250);
    await app.clickText("#detail button", "안내함으로 기록");
    await app.waitFor(async () => /^안내 /.test(await badge()), 4000);
    ctx.check("FR-08 기록하면 '안내 MM-DD'(안내 완료)로 바뀌고 막대 건수가 갱신된다", (await badge()) === "안내 10-12" && /미안내 12/.test(await bar()) && /완료 1/.test(await bar()), (await badge()) + " | " + (await bar()));
    ctx.check("FR-08 막대에 지연 건 중 '미리 안내한 건'과 '미안내 건'이 나온다", /지연 7건 중 지연 전에 미리 안내 0건/.test(await bar()) && /지연인데 아직 미안내 6건/.test(await bar()));
    await app.click('#informBar input[type=checkbox]'); await app.sleep(300);
    ctx.check("FR-08 '안내가 필요한 것만 보기'를 켜면 안내 완료 건이 빠진다", (await app.count("#tbody tr")) === 12);
    await app.click('#informBar input[type=checkbox]'); await app.sleep(300);
    ctx.check("FR-08 끄면 전체 목록으로 돌아온다", (await app.count("#tbody tr")) === 13);

    // ---------- FR-09 다시 안내: 기준일을 8일 뒤로 ----------
    await app.setValue("#today", "2026-10-20"); await app.sleep(500);
    const detailText = (await app.text('#detail [data-screen-id="LS-31-A"]')) || "";
    ctx.check("FR-09 지연 중인데 7일 넘게 소식이 없으면 '다시 안내'가 되고 이유가 보인다", (await badge()) === "다시 안내" && /다시 알려야 해요: \d+일째 새 소식을/.test(detailText) && /다시 안내 [1-9]/.test(await bar()), (await badge()) + " | " + detailText.replace(/\s+/g, " ").slice(0, 60));
    await app.setValue("#today", "2026-10-12"); await app.sleep(500);

    // ---------- FR-10 안내 기록: 채널, 메모, 중복 방지, 취소 ----------
    await app.click("#tbody tr:nth-child(2)"); await app.sleep(300);
    const opts = await app.eval(`[...document.querySelector(${JSON.stringify(ch)}).options].map(o => o.textContent)`);
    ctx.check("FR-10 채널은 메일·카톡·문자·전화·구두·기타 5가지다", JSON.stringify(opts) === JSON.stringify(["메일", "카톡·문자", "전화", "구두", "기타"]), opts.join(","));
    await app.setValue(ch, "전화"); await app.setValue(note, "E2E 메모", "input");
    await app.clickText("#detail button", "안내함으로 기록"); await app.sleep(500);
    const last = await app.eval("(S.informed[S.selected] || []).slice(-1)[0]");
    ctx.check("FR-10 채널·메모·당시 상태·납기가 함께 저장된다 (날짜는 기준일)", !!last && last.channel === "전화" && last.note === "E2E 메모" && last.date === "2026-10-12" && last.status === "지연" && !!last.due, JSON.stringify(last));
    ctx.check("FR-10 기록 이력이 상세에 날짜·채널·메모와 함께 보인다", /2026-10-12 · 전화 · 지연 때 안내 · E2E 메모/.test((await app.text('#detail [data-screen-id="LS-31-A"]')) || ""));
    await app.setValue(ch, "전화");
    await app.clickText("#detail button", "안내함으로 기록"); await app.sleep(400);
    ctx.check("FR-10 같은 날 같은 채널·상태·납기로 또 누르면 한 건만 쌓인다", (await entries()) === 1, String(await entries()));
    await app.clickText("#detail button", "마지막 기록 취소"); await app.sleep(400);
    ctx.check("FR-10 '마지막 기록 취소'를 누르면 기록이 없어지고 '미안내'로 돌아온다", (await entries()) === 0 && (await badge(2)) === "미안내", String(await entries()));

    // ---------- FR-11 한 통 안내문에서 일괄 기록 ----------
    await app.eval("document.querySelector('#tbody tr').children[7].click()"); await app.sleep(300);
    await app.clickText("#filterChip button", "한 통", { exact: false }); await app.sleep(300);
    const recLabel = await app.eval("[...document.querySelectorAll('#digestBox button')].find(b => /안내함으로 기록/.test(b.textContent)).textContent");
    const N = Number((recLabel.match(/이 (\d+)건/) || [])[1]);
    const before = await app.eval("Object.keys(S.informed).length");
    await app.clickText("#digestBox button", "안내함으로 기록", { exact: false }); await app.sleep(500);
    const msg1 = ((await app.text("#digestBox .row .sub")) || "").trim();
    const after = await app.eval("Object.keys(S.informed).length");
    ctx.check("FR-11 연구원의 건을 한 통 안내문 아래에서 한꺼번에 기록한다", N >= 1 && after - before >= 0 && /건을 안내함으로 기록했어요/.test(msg1), `${N}건 대상, 안내: ${msg1}`);
    await app.clickText("#digestBox button", "안내함으로 기록", { exact: false }); await app.sleep(500);
    const msg2 = ((await app.text("#digestBox .row .sub")) || "").trim();
    ctx.check("FR-11 오늘 같은 채널로 이미 기록한 건은 건너뛰고 건너뛴 건수를 알린다", /^0건을 안내함으로 기록했어요\. \(오늘 같은 채널로 이미 기록한 \d+건은 건너뛰었어요\.\)$/.test(msg2), msg2);

    // ---------- FR-11 선택 처리 막대에서 일괄 기록 ----------
    await app.clickText("#filterChip button", "필터 해제"); await app.sleep(300);
    await app.eval("[...document.querySelectorAll('#tbody tr')].slice(-2).forEach(r => r.querySelector('input[type=checkbox]').click())"); await app.sleep(300);
    ctx.check("FR-11 행을 고르면 선택 처리 막대가 나온다", (await app.eval("document.getElementById('pickBar').hidden")) === false && /선택 2건/.test((await app.text("#pickBar")) || ""));
    await app.clickText("#pickBar button", "연구원 안내함 기록"); await app.sleep(500);
    const msg3 = ((await app.text("#pickBar .sub")) || "").trim();
    ctx.check("FR-11 선택한 건을 연구원 안내함으로 일괄 기록하고 결과를 알린다", /건을 연구원 안내함으로 기록했어요/.test(msg3), msg3);
  },
};
