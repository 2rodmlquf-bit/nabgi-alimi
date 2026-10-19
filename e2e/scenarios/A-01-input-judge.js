// A-01 감사: 입력과 판정 (PRD FR-01~04). PRD 5-1절의 수용 기준을 실제 앱에서 하나씩 확인한다.
// 단위 테스트가 이미 지키는 경계값(judge.test.js 등)은 다시 시험하지 않고, 화면에서만 확인되는 것을 본다.
const fs = require("fs"), path = require("path");

const OUT = path.join(__dirname, "..", "out");

module.exports = {
  id: "A-01",
  name: "감사: 입력·판정 (FR-01~04)",
  run: async ctx => {
    // ---------- 샘플로 확인 ----------
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);

    // FR-01: 급한 순서 = 지연(오래된 것부터) → 임박(가까운 것부터)
    const seq = await app.eval("S.result.exceptions.map(o => [o.status, o.daysLeft])");
    let ok = true, seenSoon = false, prev = -Infinity;
    seq.forEach(([st, d]) => {
      if (st === "임박") { if (!seenSoon) { seenSoon = true; prev = -Infinity; } } else if (seenSoon) ok = false;   // 지연은 임박보다 앞에
      if (d < prev) ok = false; prev = d;                                                                              // 남은 일수가 오름차순
    });
    ctx.check("FR-01 지연·임박 주문이 급한 순서(지연 오래된 순 → 임박 가까운 순)로 나온다", ok && seq.length === 13, seq.length + "건");

    // FR-01: 납기일을 읽을 수 없는 주문은 숨기지 않고 "확인 필요"로 남는다
    const nCheck = (await app.text("#nCheck")).trim();
    const notice = (await app.text("#notice")) || "";
    ctx.check("FR-01 읽을 수 없는 납기일 주문이 '확인 필요' 카드와 알림에 나온다", nCheck === "2" && /PO-2026-1037/.test(notice) && /PO-2026-1038/.test(notice), "카드 " + nCheck);
    const inTable = (await app.text("#tbody")) || "";
    // G-8(A안): 읽을 수 없는 납기일 주문은 표 맨 아래에 "확인 필요" 행으로 나온다 (예전에는 카드·알림 줄에만 있었다: GAP-1)
    const last2 = await app.eval("[...document.querySelectorAll('#tbody tr')].slice(-2).map(r => r.children[4].innerText.trim() + '|' + r.children[1].innerText.trim() + '|' + r.children[2].innerText.trim())");
    ctx.check("FR-01 '확인 필요' 주문(PO-2026-1037, 1038)이 예외 목록 표 맨 아래에 '확인 필요' 행으로 나온다", JSON.stringify(last2) === JSON.stringify(["PO-2026-1037|확인 필요|-", "PO-2026-1038|확인 필요|-"]), last2.join(" / "));

    // FR-03: 카드와 표 건수가 일치한다. 부분 입고는 따로 표시된다
    const nums = await app.eval("['nLate','nSoon','nCheck'].map(id => Number(document.getElementById(id).textContent))");
    const rows = await app.count("#tbody tr");
    ctx.check("FR-03 요약 카드의 지연+임박+확인 필요 건수가 표의 행 수와 같다", nums[0] + nums[1] + nums[2] === rows, `${nums[0]}+${nums[1]}+${nums[2]} vs ${rows}행`);
    ctx.check("FR-03 부분 입고 주문에 '부분입고' 표시가 붙는다", /부분입고 \d+\/\d+/.test(inTable));

    // FR-04: 임박 기준 일수를 바꾸면 판정이 바뀐다
    const soon0 = Number((await app.text("#nSoon")).trim());
    await app.setValue("#soon", 3);
    await app.sleep(400);
    const soon3 = Number((await app.text("#nSoon")).trim());
    await app.setValue("#soon", 14);
    await app.sleep(400);
    const soon14 = Number((await app.text("#nSoon")).trim());
    ctx.check("FR-04 임박 기준을 3일로 줄이면 임박이 줄고, 14일로 늘리면 늘어난다", soon3 < soon0 && soon14 >= soon0, `3일 ${soon3} / 7일 ${soon0} / 14일 ${soon14}`);
    await app.setValue("#soon", 7);

    // FR-04: 품목별 임박 기준 패널
    await app.click("#rulesBtn");
    ctx.check("FR-04 '품목별 임박 기준' 패널이 열린다", (await app.eval("document.getElementById('rulePanel').hidden")) === false);
    await app.setValue("#rulesText", "베어링=1\n호스=1", "input");
    await app.click("#rulesApply");
    await app.sleep(400);
    const msg = ((await app.text("#rulesMsg")) || "").trim();
    ctx.check("FR-04 규칙을 적용하면 안내 문구가 나온다", msg.length > 0, msg);
    await app.close();

    // ---------- 열 이름이 맞지 않는 CSV (FR-01 필수 열, FR-02 열 매핑) ----------
    fs.mkdirSync(OUT, { recursive: true });
    const bad = path.join(OUT, "bad-headers.csv");
    fs.writeFileSync(bad, "﻿A,B,C,D\nPO-1,볼트,가온산업,2026-10-01\n", "utf8");
    const app2 = await ctx.launch({ openFile: bad });
    await app2.click("#openBtn");
    const mapShown = await app2.waitFor(async () => (await app2.eval("document.getElementById('mapPanel').hidden")) === false, 5000);
    ctx.check("FR-01 필수 열(주문번호·납기일)을 못 찾으면 열 매핑 화면이 열린다", !!mapShown);
    ctx.check("FR-01 그때 목록 화면은 숨겨져 있다", (await app2.eval("document.getElementById('result').hidden")) === true);

    await app2.click("#applyMap");
    await app2.sleep(300);
    const warn = ((await app2.text("#fileName")) || "").trim();
    ctx.check("FR-02 주문번호·납기일을 연결하지 않고 '적용'하면 진행하지 않고 알린다", /꼭 연결/.test(warn) && (await app2.eval("document.getElementById('mapPanel').hidden")) === false, warn);

    await app2.setValue("#map-주문번호", "A");
    await app2.setValue("#map-품목명", "B");
    await app2.setValue("#map-납기일", "D");
    await app2.click("#applyMap");
    const shown = await app2.waitFor(async () => (await app2.count("#tbody tr")) > 0, 5000);
    ctx.check("FR-02 직접 연결한 뒤 '적용'하면 목록이 나온다", !!shown, shown + "행");
    ctx.check("FR-02 연결한 열의 값이 표에 보인다 (주문번호 PO-1)", /PO-1/.test((await app2.text("#tbody")) || ""));
  },
};
