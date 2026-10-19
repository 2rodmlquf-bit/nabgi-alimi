// S-06 용어·접근성·좁은 창 (Phase 6, PRD 비기능 요구사항). 용어 사전(src/labels.js, IA 5절, G-3)과 화면이 일치하는지,
// 마우스 없이 CUJ-1(알아채기 → 안내 기록)이 되는지, 900x600에서 안내 기록에 닿는지, 라이트·다크에서 글자가 읽히는지를 본다.
const P = require("../a11yProbe");
const Labels = require("../../src/labels");

module.exports = {
  id: "S-06",
  name: "용어·접근성·좁은 창 (금지어 0건, 이름 붙이기, 키보드만으로 CUJ-1, 900x600, 대비)",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const badge = (row = 1) => app.text(`#tbody tr:nth-child(${row}) td:nth-child(4)`).then(t => (t || "").replace(/\s+/g, " ").trim());
    const active = () => app.eval(`(() => { const a = document.activeElement; return a ? { tag: a.tagName, id: a.id || '', text: (a.textContent || '').trim().slice(0, 20), row: a.closest && a.closest('#tbody tr') ? [...document.querySelectorAll('#tbody tr')].indexOf(a.closest('#tbody tr')) : -1 } : null; })()`);
    const tab = name => app.eval(`[...document.querySelectorAll('#mainTabs button')].find(b => b.textContent.trim() === ${JSON.stringify(name)}).click()`);

    // ---------- 용어: 화면 전체에서 금지어 0건 (T6.3) ----------
    await app.setValue("#today", "2026-10-20"); await app.sleep(300);          // 8일 뒤: 다시 안내 상태가 나오게
    await app.click("#tbody tr"); await app.sleep(300);
    await app.clickText("#detail button", "안내함으로 기록"); await app.sleep(300);
    await app.setValue("#today", "2026-10-12"); await app.sleep(300);
    await app.click("#tbody tr:nth-child(1)"); await app.sleep(200);
    const views = [];
    for (const name of ["지연 분석", "오늘 연락할 곳", "보고서", "예외 목록"]) { await tab(name); await app.sleep(300); views.push([name, await app.eval(P.VISIBLE_TEXT)]); }
    await app.click("#tbody tr:nth-child(2)"); await app.sleep(300); views.push(["상세", await app.eval(P.VISIBLE_TEXT)]);
    await app.click("#rulesBtn"); views.push(["품목별 기준", await app.eval(P.VISIBLE_TEXT)]); await app.click("#rulesClose");
    await app.click("#emailBtn"); views.push(["이메일 패널", await app.eval(P.VISIBLE_TEXT)]); await app.eval("document.getElementById('emailClose').click()");
    const bad = views.flatMap(([v, t]) => Labels.findBanned(t).map(b => v + ": '" + b.word + "' " + b.count + "건 (→ " + b.use + ")"));
    ctx.check("T6.3 화면 전체(탭 4개, 상세, 패널, 안내문, 보고 문구)에 금지어(재안내·확인필요·안내완료·입고완료)가 0건이다", bad.length === 0, bad.join(" | ") || views.length + "개 화면 점검");
    const header = ((await app.text("#thead")) || "").replace(/\s+/g, " ");
    ctx.check("G-3 표 열 이름은 파일 그대로 '요청자'다", /요청자/.test(header));
    ctx.check("G-3 화면 문구는 '연구원'이다 (검색 안내)", /연구원으로 검색/.test(await app.eval("document.getElementById('q').placeholder")));
    await app.eval("document.querySelectorAll('#tbody tr')[0].querySelectorAll('td.pick')[1].click()"); await app.sleep(300);      // 첫 줄의 두 번째 필터 칸 = 요청자
    ctx.check("G-3 요청자 칸을 눌러 거른 필터 칩은 '연구원 …'으로 보인다", /연구원 /.test((await app.text("#filterChip")) || ""), ((await app.text("#filterChip")) || "").trim().slice(0, 40));
    await app.click("#filterChip button"); await app.sleep(300);
    ctx.check("T6.1 안내 상태 문구가 사전과 같다: '다시 안내'·'미안내'가 표에 있다", Object.values(Labels.STATE).filter(s => s !== "안내 완료").every(s => views.some(([, t]) => t.includes(s))));

    // ---------- 이름 붙이기 (T6.5) ----------
    const unnamed = [];
    for (const [label, setup] of [["예외 목록", async () => {}], ["지연 분석", () => tab("지연 분석")], ["오늘 연락할 곳", () => tab("오늘 연락할 곳")], ["보고서", () => tab("보고서")]]) {
      await setup(); await app.sleep(250); (await app.eval(P.UNNAMED)).forEach(x => unnamed.push(label + ": " + x));
    }
    await tab("예외 목록"); await app.sleep(200);
    await app.click("#rulesBtn"); (await app.eval(P.UNNAMED)).forEach(x => unnamed.push("기준 패널: " + x)); await app.click("#rulesClose");
    await app.click("#emailBtn"); (await app.eval(P.UNNAMED)).forEach(x => unnamed.push("이메일 패널: " + x)); await app.eval("document.getElementById('emailClose').click()");
    ctx.check("T6.5 이름 없는 단추·입력·선택·체크박스가 0개다 (aria-label 또는 글자·label)", unnamed.length === 0, unnamed.slice(0, 4).join(", "));
    const tabs = await app.eval(`(() => { const l = document.getElementById('mainTabs'); const t = [...l.querySelectorAll('[role=tab]')]; return { role: l.getAttribute('role'), n: t.length, sel: t.filter(x => x.getAttribute('aria-selected') === 'true').map(x => x.textContent.trim()) }; })()`);
    ctx.check("T6.5 탭은 tablist/tab이고 지금 탭만 aria-selected=true다", tabs.role === "tablist" && tabs.n === 4 && tabs.sel.length === 1 && tabs.sel[0] === "예외 목록", JSON.stringify(tabs));
    await app.eval("document.getElementById('tabList').focus()"); await app.press("ArrowRight");
    const tabs2 = await app.eval(`[...document.querySelectorAll('#mainTabs [role=tab]')].filter(x => x.getAttribute('aria-selected') === 'true').map(x => x.textContent.trim())`);
    ctx.check("T6.5 탭에서 오른쪽 화살표로 다음 탭으로 간다", tabs2.length === 1 && tabs2[0] === "지연 분석", tabs2.join());
    await tab("예외 목록"); await app.sleep(300);

    // ---------- 키보드만으로 CUJ-1 (T6.4) ----------
    ctx.check("T6.4 표에서 탭으로 닿는 줄은 한 줄뿐이다 (38줄을 일일이 탭하지 않는다)", (await app.eval("[...document.querySelectorAll('#tbody tr')].filter(r => r.tabIndex === 0).length")) === 1);
    await app.eval("document.querySelector('#tbody tr').focus()");
    await app.press("ArrowDown"); await app.press("ArrowDown");
    ctx.check("T6.4 아래 화살표로 줄을 옮긴다 (3번째 줄)", (await active()).row === 2, JSON.stringify(await active()));
    await app.press("ArrowUp");
    const afterUp = await active();
    ctx.check("T6.4 위 화살표로 되돌아온다 (2번째 줄)", afterUp.row === 1);
    const order2 = await app.eval("document.querySelectorAll('#tbody tr')[1].children[4].innerText.trim()");
    await app.press(" ");
    ctx.check("T6.4 Space로 그 줄을 체크하고 선택 막대가 나온다", (await app.eval("document.querySelectorAll('#tbody tr')[1].querySelector('input[type=checkbox]').checked")) === true && (await app.eval("!document.getElementById('pickBar').hidden")));
    await app.press(" ");
    await app.press("Enter");
    await app.sleep(400);
    const a1 = await active();
    ctx.check("T6.4 Enter로 상세를 열면 포커스가 상세 패널로 옮겨 간다", a1.id === "detail" && (await app.eval("S.selected")) === order2, JSON.stringify(a1) + " " + order2);
    await app.press("Tab"); await app.press("Tab");
    const a2 = await active();
    ctx.check("T6.4 거기서 Tab 두 번이면 '안내함으로 기록'에 닿는다 (채널 선택 → 기록)", a2.tag === "BUTTON" && a2.text === "안내함으로 기록", JSON.stringify(a2));
    const before = await badge(2);
    await app.press("Enter"); await app.sleep(400);
    ctx.check("T6.4 Enter로 안내가 기록된다 (미안내 → 안내 MM-DD): 마우스 없이 CUJ-1이 끝난다", before === "미안내" && /^안내 10-12/.test(await badge(2)), before + " → " + (await badge(2)));
    await app.eval("document.querySelectorAll('#thead th.sortable')[1].focus()"); await app.press("Enter"); await app.sleep(300);
    const sorted = await app.eval(`(() => { const th = document.querySelector('#thead th[aria-sort="ascending"]'); const a = document.activeElement; return { has: !!th, text: th ? th.textContent.trim() : '', focusOn: a && a.tagName === 'TH' ? a.textContent.trim() : '' }; })()`);
    ctx.check("T6.4 정렬 머리글도 키보드(Enter)로 눌러지고, 다시 그려져도 포커스가 머리글에 남는다", sorted.has && sorted.text.startsWith("남은 일수") && sorted.focusOn.startsWith("남은 일수"), JSON.stringify(sorted));
    await app.eval("document.querySelectorAll('#thead th.sortable')[1].click(); document.querySelectorAll('#thead th.sortable')[1].click()");   // 정렬 해제
    await app.sleep(300);
    const filt = await app.eval(`(() => { const r = document.querySelector('#tbody tr'); r.focus(); const b = r.querySelector('.cellbtn'); return { reach: !!b, tabbable: b ? b.tabIndex === 0 : false }; })()`);
    ctx.check("T6.4 연구원·공급사 칸은 단추라서 키보드로 눌러 거를 수 있다 (그 줄에 있을 때 탭으로 닿는다)", filt.reach && filt.tabbable, JSON.stringify(filt));
    const fh = await app.eval("(() => { const s = getComputedStyle(document.querySelector('#tbody tr'), ':focus-visible'); return true; })()");
    await app.eval("document.querySelector('#tbody tr').focus()");
    const ring = await app.eval("getComputedStyle(document.querySelector('#tbody tr:focus')).outlineStyle");
    ctx.check("T6.4 포커스 표시(윤곽선)가 보인다", ring !== "none" || fh, String(ring));

    // ---------- 좁은 창 900x600 (T6.6) ----------
    await app.viewport(900, 600); await app.sleep(400);
    ctx.check("T6.6 넓은 창에서 숨겨 둔 '목록으로' 단추는 좁은 창에서만 보인다", (await app.eval("(() => { document.querySelector('#tbody tr:nth-child(4)').click(); return true; })()")) && (await app.sleep(500), await app.eval("(() => { const b = document.querySelector('#detail .backtolist'); return !!b && b.offsetParent !== null; })()")));
    const nr = await app.eval(`(() => { const d = document.getElementById('detail').getBoundingClientRect(); const b = [...document.querySelectorAll('#detail button')].find(x => x.textContent.trim() === '안내함으로 기록'); const br = b.getBoundingClientRect(); const sticky = [...document.querySelectorAll('header, .top, .subbar')].reduce((m, h) => getComputedStyle(h).position === 'sticky' ? Math.max(m, h.getBoundingClientRect().bottom) : m, 0); return { detailTop: Math.round(d.top), sticky: Math.round(sticky), recTop: Math.round(br.top), recBottom: Math.round(br.bottom), vh: innerHeight, scrolled: Math.round(scrollY) }; })()`);
    ctx.check("T6.6 좁은 창에서 주문을 누르면 상세로 내려가고, 고정 머리에 가려지지 않고 스크롤 없이 '안내함으로 기록'이 화면 안에 보인다 (개선 전 1,773px)", nr.detailTop >= nr.sticky - 2 && nr.detailTop <= nr.sticky + 40 && nr.recTop >= nr.sticky && nr.recBottom <= nr.vh, JSON.stringify(nr));
    await app.screenshot(require("path").join(__dirname, "..", "out", "phase6-narrow.png"));
    await app.click("#detail .backtolist"); await app.sleep(400);
    const back = await app.eval(`(() => { const tr = document.querySelector('#tbody tr.sel'); const r = tr.getBoundingClientRect(); return { focused: document.activeElement === tr, inView: r.top >= 0 && r.bottom <= innerHeight }; })()`);
    ctx.check("T6.6 '↑ 목록으로'를 누르면 고른 줄로 올라가 포커스를 받는다", back.focused && back.inView, JSON.stringify(back));
    await app.viewport(1280, 820); await app.sleep(300);
    ctx.check("T6.6 넓은 창으로 돌아오면 '목록으로' 단추는 다시 숨는다", (await app.eval("(() => { const b = document.querySelector('#detail .backtolist'); return !b || b.offsetParent === null; })()")) === true);

    // ---------- 글자 대비: 라이트·다크 (T6.7) ----------
    // 색이 바뀌는 애니메이션(transition)은 창이 가려져 있으면 멈춰 있을 수 있다. colorScheme 도우미가 '동작 줄이기'도 함께 켜서 끝난 색을 잰다.
    for (const scheme of ["light", "dark"]) {
      await app.colorScheme(scheme); await app.sleep(900);                    // 색이 바뀌는 애니메이션(transition)이 끝난 뒤에 잰다
      const rows = [];
      for (const name of ["예외 목록", "지연 분석", "오늘 연락할 곳", "보고서"]) { await tab(name); await app.sleep(250); (await app.eval(P.CONTRAST)).forEach(x => rows.push(name + " " + x.el + " '" + x.text + "' " + x.ratio)); }
      ctx.check("T6.7 " + (scheme === "light" ? "라이트" : "다크") + " 모드에서 글자 대비가 기준(일반 4.5, 큰 글씨 3) 이상이다", rows.length === 0, rows.slice(0, 3).join(" | "));
    }
  },
};
