// A-02 감사: 예외 목록 탐색과 원인 분석 (PRD FR-05, FR-06). 이 두 요구사항은 renderer.js 안에 있어 단위 테스트가 없었다.
module.exports = {
  id: "A-02",
  name: "감사: 정렬·검색·필터, 원인 비중 (FR-05·06)",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);

    const col = i => app.eval(`[...document.querySelectorAll('#tbody tr')].map(r => r.children[${i}].innerText.trim())`);
    const dueTimes = () => app.eval("[...document.querySelectorAll('#tbody tr')].map(r => (Judge.parseDate(r.children[8].innerText.trim()) || { getTime: () => Number.MAX_SAFE_INTEGER }).getTime())");   // 읽을 수 없는 납기일은 오름차순에서 맨 뒤 (Infinity는 CDP를 거치며 null이 되어 유한한 큰 수를 쓴다)
    const head = () => app.eval("[...document.querySelectorAll('#thead th')].find(t => t.textContent.startsWith('납기일')).textContent");
    const sorted = (a, dir) => a.every((v, i) => i === 0 || (dir === "asc" ? a[i - 1] <= v : a[i - 1] >= v));

    // ---------- FR-05 정렬: 같은 머리글을 누를 때마다 오름차순 → 내림차순 → 원래 순서 ----------
    const original = await col(4);
    await app.clickText("#thead th", "납기일", { exact: false }); await app.sleep(250);
    const h1 = await head(), asc = await dueTimes();
    ctx.check("FR-05 머리글을 한 번 누르면 오름차순(▲)으로 정렬된다", /▲/.test(h1) && sorted(asc, "asc"), h1.trim());
    await app.clickText("#thead th", "납기일", { exact: false }); await app.sleep(250);
    const h2 = await head(), desc = await dueTimes();
    ctx.check("FR-05 두 번 누르면 내림차순(▼)으로 정렬된다", /▼/.test(h2) && sorted(desc, "desc"), h2.trim());
    await app.clickText("#thead th", "납기일", { exact: false }); await app.sleep(250);
    const h3 = await head(), back = await col(4);
    ctx.check("FR-05 세 번 누르면 표시가 사라지고 원래 순서로 돌아온다", !/[▲▼]/.test(h3) && JSON.stringify(back) === JSON.stringify(original), h3.trim());

    // ---------- FR-05 검색 ----------
    await app.setValue("#q", "산업", "input"); await app.sleep(300);
    const found = await app.eval("[...document.querySelectorAll('#tbody tr')].map(r => r.innerText)");
    ctx.check("FR-05 '산업'으로 검색하면 일치하는 주문만 남는다", found.length > 0 && found.length < 15 && found.every(t => t.includes("산업")), found.length + "건");
    ctx.check("FR-05 검색 결과 안내 문구가 나온다", /검색 결과 \d+건/.test((await app.text("#qInfo")) || ""));
    await app.setValue("#q", "", "input"); await app.sleep(250);
    ctx.check("FR-05 검색어를 지우면 전체 목록으로 돌아온다", (await app.count("#tbody tr")) === 15);

    // ---------- FR-05 필터: 요청자, 공급사, 원인 ----------
    await app.eval("document.querySelector('#tbody tr').children[7].click()"); await app.sleep(300);
    let chip = ((await app.text("#filterChip")) || "").trim();
    const reqs = await col(7);
    ctx.check("FR-05 요청자 칸을 누르면 그 요청자의 주문만 남는다", /^요청자 /.test(chip) && reqs.length > 0 && new Set(reqs).size === 1, chip.split("\n")[0]);
    await app.clickText("#filterChip button", "필터 해제"); await app.sleep(250);
    ctx.check("FR-05 '필터 해제'를 누르면 전체 목록으로 돌아온다", (await app.count("#tbody tr")) === 15);

    await app.eval("document.querySelector('#tbody tr').children[6].click()"); await app.sleep(300);
    chip = ((await app.text("#filterChip")) || "").trim();
    const sups = await col(6);
    ctx.check("FR-05 공급사 칸을 누르면 그 공급사의 주문만 남는다", /^공급사 /.test(chip) && sups.length > 0 && new Set(sups).size === 1, chip.split("\n")[0]);
    await app.clickText("#filterChip button", "필터 해제"); await app.sleep(250);

    // ---------- FR-06 원인 비중: 지연 분석 탭 ----------
    await app.click("#tabAna"); await app.sleep(400);
    const heads = await app.eval("[...document.querySelectorAll('#analysis h3')].map(h => h.textContent)");
    ctx.check("FR-06 지연 분석 탭에 원인별·공급사별·연구원별 구간이 있다", ["원인별 건수", "공급사별 지연", "연구원별 영향"].every(k => heads.some(h => h.includes(k))), heads.map(h => h.slice(0, 8)).join(" / "));
    const sum = (await app.text("#analysis .sumline")) || "";
    ctx.check("FR-06 지연 건수와 평균·최장 지연 일수가 나온다", /7건/.test(sum) && /평균 지연/.test(sum) && /가장 오래 지연/.test(sum), sum.replace(/\s+/g, " "));

    // 원인 막대를 누르면 그 원인의 주문만 목록에 보인다 (FR-05 원인 필터)
    await app.eval("document.querySelector('#analysis .barrow').click()"); await app.sleep(400);
    chip = ((await app.text("#filterChip")) || "").trim();
    const nCause = await app.count("#tbody tr");
    ctx.check("FR-05 원인 막대를 누르면 그 원인의 지연 주문만 목록에 남는다", /^원인 /.test(chip) && nCause > 0 && nCause <= 7, chip.split("\n")[0] + ", " + nCause + "건");
    await app.clickText("#filterChip button", "필터 해제"); await app.sleep(250);

    // 원인 직접 지정
    await app.click("#tbody tr"); await app.sleep(300);
    const sel = '#detail [data-screen-id="LS-34-A"] select';
    const opts = await app.eval(`[...document.querySelector(${JSON.stringify(sel)}).options].map(o => o.value)`);
    ctx.check("FR-06 지연 주문 상세에 원인 선택 칸이 있다 ('자동 (규칙)' + 분류 항목들)", opts.length > 2 && opts[0] === "", opts.length + "개");
    await app.setValue(sel, opts[1]); await app.sleep(400);
    const causeBox = (await app.text('#detail [data-screen-id="LS-34-A"]')) || "";
    const direct = await app.eval("S.causeOverride[S.selected]");
    ctx.check("FR-06 원인을 직접 지정하면 '직접 지정'으로 표시되고 저장 대상이 된다", /직접 지정/.test(causeBox) && direct === opts[1], String(direct));
  },
};
