// A-05: '확인 필요' 주문(납기일을 읽을 수 없는 주문)이 예외 목록 표에 나오고 안내 기록·추적 대상이 된다 (결정 G-8, A안).
// 예전에는 카드와 알림 줄에만 있었다 (감사 GAP-1). 샘플의 PO-2026-1037, PO-2026-1038이 해당한다.
const fs = require("fs"), path = require("path");

module.exports = {
  id: "A-05",
  name: "G-8: '확인 필요' 주문을 표에 보이고 안내 기록·추적 대상으로 삼는다",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const NO = "PO-2026-1037";
    const rowIdx = () => app.eval(`[...document.querySelectorAll('#tbody tr')].findIndex(r => r.children[4].innerText.trim() === ${JSON.stringify(NO)}) + 1`);
    const cell = async n => ((await app.text(`#tbody tr:nth-child(${await rowIdx()}) td:nth-child(${n})`)) || "").trim();
    const bar = () => app.text("#informBar").then(t => (t || "").replace(/\s+/g, " "));
    const LS31 = '#detail [data-screen-id="LS-31-A"]', NB = '#detail [data-screen-id="LS-32-A"]';

    // ---------- 표에 나온다 ----------
    ctx.check("표는 지연·임박 13행 + 확인 필요 2행 = 15행이다", (await app.count("#tbody tr")) === 15);
    const order = await app.eval("[...document.querySelectorAll('#tbody tr')].map(r => r.children[1].innerText.trim())");
    const firstCheck = order.indexOf("확인 필요");
    ctx.check("'확인 필요' 행은 모두 지연·임박 행 뒤(맨 아래)에 있다", firstCheck === 13 && order.slice(13).every(s => s === "확인 필요") && order.slice(0, 13).every(s => s !== "확인 필요"), order.slice(11).join(","));
    ctx.check("상태 배지는 '확인 필요'(띄어 씀)이고 남은 일수는 '-'다", (await cell(2)) === "확인 필요" && (await cell(3)) === "-");
    ctx.check("알림 줄이 표 맨 아래에 보인다고 알려 준다", /표 맨 아래에 '확인 필요'로 보여요/.test((await app.text("#notice")) || ""));
    ctx.check("처음에는 '미안내'다. 현황 막대는 확인 필요까지 센다 (미안내 15)", (await cell(4)) === "미안내" && /미안내 15/.test(await bar()), await bar());

    // ---------- 상세 ----------
    await app.click(`#tbody tr:nth-child(${await rowIdx()})`); await app.sleep(300);
    const detail = (await app.text("#detail")) || "";
    ctx.check("눌러서 상세를 열 수 있고 이유가 보인다", new RegExp(NO).test(detail) && /납기일이 비었거나 형식을 해석할 수 없음/.test(detail));
    ctx.check("안내 기록·안내문·대체품 영역은 있고 '지연 원인' 영역은 없다 (지연이 아니므로)", (await app.exists(LS31)) && (await app.exists(NB)) && (await app.exists('#detail [data-screen-id="LS-35-A"]')) && !(await app.exists('#detail [data-screen-id="LS-34-A"]')));
    const text = await app.eval(`document.querySelector(${JSON.stringify(NB + ' textarea[rows="10"]')}).value`);
    ctx.check("기본 템플릿은 '공지형'이고, 납기를 아직 모른다고 쓰며 날짜를 지어내지 않는다", (await app.eval(`document.querySelector(${JSON.stringify(NB + " select")}).value`)) === "공지형" && /납기일을 아직 확인하지 못했습니다\./.test(text) && !/기존 납기일은/.test(text) && !/\d월 \d+일/.test(text), text.split("\n").slice(2, 4).join(" "));

    // ---------- 안내 기록 ----------
    await app.clickText("#detail button", "안내함으로 기록");
    await app.waitFor(async () => /^안내 /.test(await cell(4)), 4000);
    ctx.check("기록하면 '안내 MM-DD'로 바뀌고 현황 막대가 갱신된다", (await cell(4)) === "안내 10-12" && /미안내 14/.test(await bar()) && /완료 1/.test(await bar()), (await cell(4)) + " | " + (await bar()));
    const stateFile = path.join(app.userData, "state.json");
    const saved = await app.waitFor(() => { try { const j = JSON.parse(fs.readFileSync(stateFile, "utf8")); return j.informed && j.informed[NO] ? j : null; } catch (e) { return null; } }, 5000);
    ctx.check("저장된 기록의 상태는 '확인필요'다 (임박으로 잘못 남지 않는다)", !!saved && saved.informed[NO][0].status === "확인필요", saved ? JSON.stringify(saved.informed[NO][0]) : "저장 안 됨");

    // ---------- 연구원별 묶기: 필터 칩과 한 통 안내문 ----------
    await app.eval(`document.querySelector('#tbody tr:nth-child(${await rowIdx()})').children[7].click()`); await app.sleep(300);
    const chip = ((await app.text("#filterChip")) || "").replace(/\s+/g, " ");
    ctx.check("그 연구원으로 거르면 필터 칩에 '확인 필요 N건'이 따로 나온다 (임박에 섞이지 않는다)", /확인 필요 \d+건/.test(chip), chip);
    await app.clickText("#filterChip button", "한 통", { exact: false }); await app.sleep(300);
    const digest = await app.eval("(document.querySelector('#digestBox textarea') || {}).value || ''");
    ctx.check("한 통 안내문에 '납기 확인 중' 구간이 따로 있고 납기를 지어내지 않는다", /■ 납기 확인 중 \d+건/.test(digest) && /납기: 아직 확인하지 못했습니다/.test(digest), digest.split("\n").filter(l => /■/.test(l)).join(" / "));
    await app.clickText("#filterChip button", "필터 해제"); await app.sleep(300);

    // ---------- 다시 안내: 소식 없이 7일 이상 ----------
    await app.setValue("#today", "2026-10-20"); await app.sleep(500);
    await app.click(`#tbody tr:nth-child(${await rowIdx()})`); await app.sleep(300);
    ctx.check("납기를 계속 모르는 채 7일 넘게 소식이 없으면 '다시 안내'가 되고 이유가 보인다", (await cell(4)) === "다시 안내" && /8일째 새 소식을 알리지 않았어요/.test((await app.text(LS31)) || ""), await cell(4));
    await app.setValue("#today", "2026-10-12"); await app.sleep(500);

    // ---------- 보고서 ----------
    await app.click("#tabReport"); await app.sleep(400);
    const report = await app.eval("document.querySelector('#reportView textarea').value");
    ctx.check("보고서의 안내 대상 문구에 '확인 필요'가 들어간다", /연구원 안내: 지연·임박·확인 필요 15건 중 안내 완료 1건/.test(report));
    await app.click("#tabList"); await app.sleep(300);

    // ---------- 재시작 후 복원 ----------
    const dir = app.userData;
    await app.close();
    const app2 = await ctx.launch({ userData: dir });
    await app2.click("#sampleBtn");
    await app2.waitFor(async () => (await app2.count("#tbody tr")) > 0);
    const idx2 = await app2.eval(`[...document.querySelectorAll('#tbody tr')].findIndex(r => r.children[4].innerText.trim() === ${JSON.stringify(NO)}) + 1`);
    const restored = ((await app2.text(`#tbody tr:nth-child(${idx2}) td:nth-child(4)`)) || "").trim();
    ctx.check("앱을 다시 켜고 샘플을 열면 확인 필요 주문의 안내 기록도 복원된다", restored === "안내 10-12", restored);
  },
};
