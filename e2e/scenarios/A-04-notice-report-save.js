// A-04 감사: 안내문, 보고서, 저장 (PRD FR-13~16).
// 안내문 문장 규칙(지어내지 않음, 호칭, 서명 등)은 test/phase2.test.js가 지킨다. 여기서는 화면에서 연결이 되는지 본다.
const fs = require("fs"), path = require("path");

module.exports = {
  id: "A-04",
  name: "감사: 안내문·보고서·저장 (FR-13~16)",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn");
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const NB = '#detail [data-screen-id="LS-32-A"]';
    const out = () => app.eval(`document.querySelector(${JSON.stringify(NB)} + ' textarea[rows="10"]').value`);

    // ---------- FR-13 안내문 ----------
    await app.click("#tbody tr"); await app.sleep(300);       // 첫 주문: 지연
    const tpl = await app.eval(`[...document.querySelector(${JSON.stringify(NB + " select")}).options].map(o => o.textContent)`);
    ctx.check("FR-13 템플릿이 5종이다 (사과형·공지형·대안 제시형·부분 납품 안내·임박 사전 안내)", JSON.stringify(tpl) === JSON.stringify(["사과형", "공지형", "대안 제시형", "부분 납품 안내", "임박 사전 안내"]), tpl.join(","));
    const text = await out();
    ctx.check("FR-13 지연 주문의 초안이 만들어진다 (호칭·주문번호 포함)", /^안녕하세요, .+연구원님\./.test(text) && /PO-2026-1001/.test(text));
    ctx.check("FR-13 새 납기가 없으면 날짜를 지어내지 않고 '확인되는 대로 다시 안내'라고 쓴다", !/변경:/.test(text) && /확인되는 대로 다시 안내/.test(text));
    ctx.check("FR-13 '이 앱은 메시지를 보내지 않아요'라는 안내가 있다", /메시지를 보내지 않아요/.test((await app.text(NB)) || ""));
    ctx.check("FR-13 복사 버튼이 있다", await app.eval(`[...document.querySelectorAll(${JSON.stringify(NB + " button")})].some(b => b.textContent.trim() === '복사')`));

    // 서명은 한 번 적으면 모든 안내문에 붙는다
    await app.setValue('#detail textarea[placeholder^="예: 구매팀"]', "E2E서명 드림", "input"); await app.sleep(300);
    ctx.check("FR-13 서명을 적으면 초안 끝에 붙는다", /E2E서명 드림$/.test((await out()).trim()));
    await app.click("#tbody tr:nth-child(2)"); await app.sleep(300);
    ctx.check("FR-13 다른 주문의 초안에도 같은 서명이 붙는다", /E2E서명 드림$/.test((await out()).trim()));

    // 임박 주문은 사과형 대신 사전 안내가 기본
    const soonRow = await app.eval("[...document.querySelectorAll('#tbody tr')].findIndex(r => r.innerText.includes('임박')) + 1");
    await app.click(`#tbody tr:nth-child(${soonRow})`); await app.sleep(300);
    ctx.check("FR-13 임박 주문의 기본 템플릿은 '임박 사전 안내'다", (await app.eval(`document.querySelector(${JSON.stringify(NB + " select")}).value`)) === "임박 사전 안내");

    // ---------- FR-14 한 통 안내문 ----------
    const both = await app.eval(`(() => { const m = {}; S.result.exceptions.forEach(o => { const k = (o['요청자'] || '').trim(); (m[k] = m[k] || new Set()).add(o.status); }); return Object.keys(m).find(k => m[k].has('지연') && m[k].has('임박')) || ''; })()`);
    await app.eval(`S.filter = { requester: ${JSON.stringify(both)} }; S.digestOpen = true; S.selected = null; render(); 1`); await app.sleep(400);
    const digest = await app.eval("(document.querySelector('#digestBox textarea') || {}).value || ''");
    ctx.check("FR-14 지연과 임박을 나눠 한 통에 담는다", /■ 납기 지연 \d+건/.test(digest) && /■ 납기 임박 \d+건/.test(digest), both);
    const lateDays = [...digest.matchAll(/· (\d+)일 지남/g)].map(m => Number(m[1]));
    const soonDays = [...digest.matchAll(/· (?:오늘|(\d+)일 남음)/g)].map(m => Number(m[1] || 0));
    const mono = (a, d) => a.every((v, i) => i === 0 || (d === "desc" ? a[i - 1] >= v : a[i - 1] <= v));
    ctx.check("FR-14 지연은 오래된 순, 임박은 가까운 순으로 정렬된다", mono(lateDays, "desc") && mono(soonDays, "asc"), `지연 ${lateDays} / 임박 ${soonDays}`);
    await app.eval("S.filter = {}; S.digestOpen = false; render(); 1"); await app.sleep(300);

    // ---------- FR-15 보고서와 CSV ----------
    await app.click("#tbody tr"); await app.sleep(250);
    await app.clickText("#detail button", "안내함으로 기록"); await app.sleep(500);
    await app.click("#tabReport"); await app.sleep(400);
    const report = await app.eval("document.querySelector('#reportView textarea').value");
    ctx.check("FR-15 보고서에 안내 완료·미안내·다시 안내 건수가 나온다", /연구원 안내: 지연·임박·확인 필요 15건 중 안내 완료 1건, 안내 안 함 14건, 다시 알려야 할 건 0건/.test(report));
    ctx.check("FR-15 보고서에 지연 중 선제 안내 건수와 미안내 건수가 나온다", /지연 7건 중 지연되기 전에 미리 안내한 건 0건, 지연 중인데 아직 안내하지 못한 건 6건/.test(report));
    const csv = await app.eval("({ head: Report.EXC_HEAD[10], first: Report.exceptionRows(S.result.exceptions, S.result.needCheck, causeOf, reasonOf, S.contacted, informedLabel).map(r => r[10]) })");
    ctx.check("FR-15 예외 목록 CSV에 '연구원 안내' 열이 있고 상태가 들어간다", csv.head === "연구원 안내" && /^안내 완료\(2026-10-12\)$/.test(csv.first[0]) && csv.first[1] === "미안내" && csv.first.length === 15 && csv.first.slice(-2).every(v => v === "미안내"), csv.first.length + "줄, 앞 2줄: " + csv.first.slice(0, 2).join(" / "));
    ctx.check("FR-15 CSV·보고 문구를 저장하는 버튼이 있다 (저장 창은 사람이 고른다)", (await app.eval("[...document.querySelectorAll('#reportView button')].map(b => b.textContent.trim())")).filter(t => /저장/.test(t)).length === 3);

    // ---------- FR-16 저장과 복원 ----------
    const stateFile = path.join(app.userData, "state.json");
    const saved = await app.waitFor(() => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null), 5000);
    ctx.check("FR-16 기록이 이 컴퓨터의 저장 폴더에 자동 저장된다 (재시작 후 복원은 S-00이 확인)", !!saved && saved.schemaVersion === 1 && Object.keys(saved.informLog || {}).length === 1);
    const r = await app.eval("window.app.saveState({ reasons: { X: 'a'.repeat(2100000) } })");
    ctx.check("FR-16 저장 내용이 2MB를 넘으면 저장을 거부하고 이유를 돌려준다", r && r.ok === false && /너무 큽니다/.test(r.error || ""), JSON.stringify(r));
    const still = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    ctx.check("FR-16 거부된 뒤에도 기존 저장 내용은 그대로다", Object.keys(still.informLog || {}).length === 1);
  },
};
