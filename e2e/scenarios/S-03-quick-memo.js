// S-03 빠른 메모 (PRD FR-12, 사용자 여정 CUJ-3): 전화로 들은 지연 소식을 잊기 전에 주문에 남긴다.
// 여정: 주문을 찾는다 -> 메모를 적는다 -> (표에서) 메모가 남았음을 본다 -> 안내가 필요한지 판단한다.
// 메모는 안내 상태·판정에 영향을 주지 않는다.
const fs = require("fs"), path = require("path");

module.exports = {
  id: "S-03",
  name: "빠른 메모 (CUJ-3): 찾기 → 적기 → 확인 → 안내 판단",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn"); await app.showList();
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const NO = "PO-2026-1002";
    const BOX = '#detail [data-screen-id="LS-33-A"]', TA = BOX + " textarea";
    const find = async q => { await app.setValue("#q", q, "input"); await app.sleep(300); };
    const openOrder = async () => { await find("1002"); await app.click("#tbody tr"); await app.sleep(300); };
    const cell4 = async () => ((await app.text("#tbody tr:nth-child(1) td:nth-child(4)")) || "").replace(/\s+/g, " ").trim();
    const items = () => app.eval(`[...document.querySelectorAll(${JSON.stringify(BOX + " li")})].map(li => li.querySelector('.ntext').innerText)`);
    const type = async text => { await app.setValue(TA, text, "input"); };
    const ctrlEnter = () => app.eval(`document.querySelector(${JSON.stringify(TA)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))`);
    const bar = () => app.text("#informBar").then(t => (t || "").replace(/\s+/g, " "));

    // ---------- 1. 주문 찾기 ----------
    await openOrder();
    ctx.check("검색으로 주문을 찾아 상세를 연다 (CUJ-3 1단계)", ((await app.text("#detail h2")) || "").trim() === NO);
    ctx.check("상세에 '빠른 메모' 영역이 있고, 아직 메모가 없다는 안내와 '안내 상태에는 영향이 없어요'가 보인다", (await app.exists(BOX)) && /빠른 메모$/.test(((await app.text(BOX + " h3")) || "").trim()) && /안내 상태에는 영향이 없어요/.test((await app.text(BOX)) || ""));
    ctx.check("입력은 글 하나뿐이다: 입력 칸 하나와 '메모 남기기' 버튼 하나, 채널·분류 선택이 없다", (await app.count(BOX + " textarea")) === 1 && (await app.count(BOX + " select")) === 0 && (await app.count(BOX + " button")) === 1);
    const barBefore = await bar();

    // ---------- 2. 메모 적기: Ctrl+Enter ----------
    await type("통화: 통관 서류 보완 중, 10월 말 예상");
    await ctrlEnter(); await app.sleep(400);
    ctx.check("Ctrl+Enter로 메모가 남고 제목에 건수가 보인다 (CUJ-3 2단계)", (await items()).length === 1 && /통관 서류 보완 중/.test((await items())[0]) && /빠른 메모 \(1\)/.test((await app.text(BOX + " h3")) || ""));
    ctx.check("남긴 시각이 자동으로 붙는다 (월-일 시:분)", /^\d\d-\d\d \d\d:\d\d$/.test(((await app.text(BOX + " li .nt")) || "").trim()));
    const focus = await app.eval(`(() => { const a = document.activeElement; return a && a.tagName === 'TEXTAREA' && a.getAttribute('aria-label') === '빠른 메모' && a.value === '' })()`);
    ctx.check("남긴 뒤 입력 칸이 비워지고 포커스가 돌아와 이어서 바로 적을 수 있다", focus === true);

    // ---------- 3. 표에서 확인 ----------
    ctx.check("표의 안내 칸에 '메모 1'이 붙고 안내 상태는 그대로 '미안내'다 (CUJ-3 3단계)", /^미안내 메모 1$/.test(await cell4()), await cell4());
    ctx.check("메모는 안내 현황 막대의 숫자를 바꾸지 않는다", (await bar()) === barBefore, await bar());

    // ---------- 4. 두 번째 메모: 버튼, 줄바꿈 ----------
    await type("두 번째 메모\n(줄바꿈 포함) 😀");
    await app.clickText(BOX + " button", "메모 남기기"); await app.sleep(400);
    const l2 = await items();
    ctx.check("버튼으로도 남기고, 목록은 최신순이며 줄바꿈이 보존된다", l2.length === 2 && l2[0] === "두 번째 메모\n(줄바꿈 포함) 😀" && /통관/.test(l2[1]), JSON.stringify(l2[0]));
    ctx.check("표의 배지가 '메모 2'로 늘어난다", /^미안내 메모 2$/.test(await cell4()));

    // ---------- 5. 빈 글, 글자 수 제한, HTML 같은 글 ----------
    await app.clickText(BOX + " button", "메모 남기기"); await app.sleep(300);
    ctx.check("빈 글이면 저장하지 않고 '메모를 적어 주세요'라고 알린다", (await items()).length === 2 && /메모를 적어 주세요/.test((await app.text(BOX)) || ""));
    const html = "<b>굵게</b> & <img src=x onerror=alert(1)> <script>alert(1)</script>";
    await type(html); await ctrlEnter(); await app.sleep(400);
    ctx.check("HTML처럼 보이는 글도 글자 그대로 보이고, 화면 요소로 해석되지 않는다", (await items())[0] === html && (await app.count(BOX + " b, " + BOX + " img, " + BOX + " script")) === 0);
    await type("가".repeat(350)); await ctrlEnter(); await app.sleep(400);
    const lenNow = await app.eval(`S.quickNotes[${JSON.stringify(NO)}].slice(-1)[0].text.length`);
    ctx.check("300자를 넘으면 300자로 저장하고 알려 준다", lenNow === 300 && /300자까지만 저장했어요/.test((await app.text(BOX)) || ""), String(lenNow));

    // ---------- 6. 삭제는 두 번 눌러야 한다 ----------
    await app.click(BOX + " li button"); await app.sleep(200);
    ctx.check("삭제를 한 번 누르면 '정말 삭제?'로 바뀌고 아직 지워지지 않는다", ((await app.text(BOX + " li button")) || "").trim() === "정말 삭제?" && (await items()).length === 4);
    await app.click(BOX + " li button"); await app.sleep(400);
    ctx.check("한 번 더 누르면 그 메모(가장 최근 것)만 지워진다", (await items()).length === 3 && !(await items()).some(t => t.startsWith("가가가")) && /^미안내 메모 3$/.test(await cell4()));

    // ---------- 7. 저장: id·시각, 삭제 표시 ----------
    const stateFile = path.join(app.userData, "state.json");
    const saved = await app.waitFor(() => { try { const j = JSON.parse(fs.readFileSync(stateFile, "utf8")); const l = j.quickNotes && j.quickNotes[NO]; return l && l.some(n => n.deletedAt) ? j : null; } catch (e) { return null; } }, 12000);
    const notes = saved && saved.quickNotes[NO];
    ctx.check("저장 파일(v3)에 메모 4건이 id·만든 시각과 함께 있고, 지운 1건에는 삭제 표시가 남는다", !!saved && saved.schemaVersion === 3 && notes.length === 4 && notes.every(n => n.id && n.createdAt) && notes.filter(n => n.deletedAt).length === 1, notes ? notes.length + "건, 삭제 표시 " + notes.filter(n => n.deletedAt).length : "저장 안 됨");
    ctx.check("메모를 남겨도 안내 기록은 하나도 생기지 않는다", !saved || !saved.informLog || Object.keys(saved.informLog).length === 0);

    // ---------- 8. 다른 주문에는 섞이지 않는다 ----------
    await find("1003"); await app.click("#tbody tr"); await app.sleep(300);
    ctx.check("다른 주문(PO-2026-1003)에는 메모가 없고 배지도 없다", (await items()).length === 0 && !/메모/.test(await cell4()), await cell4());

    // ---------- 9. 껐다 켜도 남아 있다 ----------
    const dir = app.userData;
    await app.close();
    const app2 = await ctx.launch({ userData: dir });
    await app2.click("#sampleBtn"); await app2.showList(); await app2.waitFor(async () => (await app2.count("#tbody tr")) > 0);
    await app2.setValue("#q", "1002", "input"); await app2.sleep(300);
    const c2 = ((await app2.text("#tbody tr:nth-child(1) td:nth-child(4)")) || "").replace(/\s+/g, " ").trim();
    await app2.click("#tbody tr"); await app2.sleep(300);
    const l3 = await app2.eval(`[...document.querySelectorAll(${JSON.stringify(BOX + " li .ntext")})].map(e => e.innerText)`);
    ctx.check("앱을 다시 켜면 메모 3건이 그대로 있고(지운 것은 보이지 않고), 배지도 '메모 3'이다 (CUJ-3 영속)", l3.length === 3 && c2 === "미안내 메모 3" && l3[2].includes("통관 서류 보완 중"), c2 + " | " + l3.length + "건");

    // ---------- 10. 안내 판단: 메모를 보고 안내하기로 했다 ----------
    await app2.clickText("#detail button", "안내함으로 기록"); await app2.sleep(500);
    const c3 = ((await app2.text("#tbody tr:nth-child(1) td:nth-child(4)")) || "").replace(/\s+/g, " ").trim();
    ctx.check("안내를 기록하면 안내 상태는 바뀌고(안내 10-12) 메모는 그대로다 (CUJ-3 3단계: 같은 화면에서 안내까지)", c3 === "안내 10-12 메모 3", c3);
    ctx.check("안내문과 안내 기록 영역이 같은 상세 화면에 함께 있다", (await app2.exists('#detail [data-screen-id="LS-31-A"]')) && (await app2.exists('#detail [data-screen-id="LS-32-A"]')) && (await app2.exists('#detail [data-screen-id="LS-33-A"]')));
  },
};
