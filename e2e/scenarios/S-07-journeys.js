// S-07 여정 통합 (Phase 7, 7-A): CUJ-1 선제 안내와 CUJ-2 다시 안내를 처음부터 끝까지 이어서 확인한다.
// 개별 규칙은 단위 테스트와 A-03이 지킨다. 여기서는 화면들이 이어져서 한 여정이 끝나는지, 껐다 켜도 이어지는지, 외부 통신이 없는지를 본다.
const fs = require("fs"), path = require("path");
const { ROOT } = require("../helpers");

const OUT = path.join(__dirname, "..", "out");

module.exports = {
  id: "S-07",
  name: "여정 통합: CUJ-1 선제 안내 → CUJ-2 다시 안내(3가지 규칙) → 재시작 복원, 외부 통신 0건",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn"); await app.showList();
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const bar = () => app.text("#informBar").then(t => (t || "").replace(/\s+/g, " "));
    const num = async (label) => +((new RegExp(label + " (\\d+)").exec(await bar()) || [])[1] || 0);
    let cur = app;                                                                       // 지금 떠 있는 앱 (껐다 켜면 바뀐다)
    const cell = (row, col = 4) => cur.text(`#tbody tr:nth-child(${row}) td:nth-child(${col})`).then(t => (t || "").replace(/\s+/g, " ").trim());
    await app.eval("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })");   // 복사 권한 창 없이 시험

    // ================= CUJ-1 선제 안내 =================
    const none0 = await num("미안내");
    ctx.check("CUJ-1 ① 샘플을 열면 안내 현황 막대에 미안내 건수가 보인다 (알아채기)", none0 === 15 && /안내가 필요한 것만 보기/.test(await bar()), await bar());
    await app.click("#informBar input[type=checkbox]"); await app.sleep(300);
    ctx.check("CUJ-1 ② '안내가 필요한 것만 보기'를 켜면 안내가 필요한 주문만 남는다", (await app.count("#tbody tr")) === 15);
    await app.eval("document.querySelectorAll('#tbody tr')[0].querySelectorAll('td.pick')[1].click()"); await app.sleep(300);       // 첫 줄 연구원으로 거르기
    const nResearcher = await app.count("#tbody tr");
    ctx.check("CUJ-1 ③ 연구원 칸을 눌러 그 연구원의 주문만 거른다", nResearcher >= 1 && nResearcher < 15 && /연구원 /.test((await app.text("#filterChip")) || ""), nResearcher + "건");
    await app.clickText("#filterChip button", "이 연구원에게 한 통 안내문"); await app.sleep(300);
    const digest = (await app.eval("(document.querySelector('#digestBox textarea') || {}).value")) || "";
    ctx.check("CUJ-1 ④ 한 통 안내문에 그 연구원의 건이 모두 들어 있다", digest.length > 50 && new RegExp("\\(" + "?").test(digest) && (digest.match(/PO-2026-\d+/g) || []).length >= nResearcher, (digest.match(/PO-2026-\d+/g) || []).length + "건 언급");
    await app.clickText("#digestBox button", "복사"); await app.sleep(300);
    const nudged = await app.eval("(() => { const b = [...document.querySelectorAll('#digestBox button')].find(x => /안내함으로 기록/.test(x.textContent)); return !!b && b.classList.contains('nudge') && document.activeElement === b; })()");
    ctx.check("CUJ-1 ⑤ 복사하면 '이 N건 안내함으로 기록'이 강조되고 포커스를 받는다 (FR-19)", nudged === true);
    await app.clickText("#digestBox button", "이 " + nResearcher + "건 안내함으로 기록"); await app.sleep(500);
    const msg = (await app.text("#digestBox")) || "";
    ctx.check("CUJ-1 ⑥ 누르면 N건이 한 번에 기록되고 건수를 알려 준다", new RegExp(nResearcher + "건을 안내함으로 기록했어요").test(msg), msg.replace(/\s+/g, " ").slice(-60));
    await app.click("#filterChip button.quiet"); await app.sleep(300);
    ctx.check("CUJ-1 ⑦ 현황 막대 숫자가 바뀐다 (미안내 " + none0 + " → " + (none0 - nResearcher) + ", 완료 +" + nResearcher + ")", (await num("미안내")) === none0 - nResearcher && (await num("완료")) === nResearcher, await bar());
    const log = await app.eval("Object.values(S.informed).reduce((n, l) => n + l.length, 0)");
    ctx.check("CUJ-1 ⑧ 안내 기록이 주문마다 한 건씩 쌓였다", log === nResearcher, String(log));
    const dir = app.userData;
    await app.close();

    const app2 = await ctx.launch({ userData: dir }); cur = app2;
    await app2.click("#sampleBtn"); await app2.showList(); await app2.waitFor(async () => (await app2.count("#tbody tr")) > 0);
    const bar2 = (await app2.text("#informBar") || "").replace(/\s+/g, " ");
    ctx.check("CUJ-1 ⑨ 앱을 껐다 켜도 안내 기록이 복원되어 막대 숫자가 그대로다", new RegExp("미안내 " + (none0 - nResearcher) + " ").test(bar2) && new RegExp("완료 " + nResearcher + "\\b").test(bar2), bar2);

    // ================= CUJ-2 다시 안내: 규칙 ① 7일 넘게 소식 없음 =================
    const late = await app2.eval("(() => { const o = S.result.exceptions.find(x => x.status === '지연' && !(S.informed[x['주문번호']] || []).length); return o ? { no: o['주문번호'], due: o['납기일'] } : null; })()");
    ctx.check("CUJ-2 준비: 아직 안내하지 않은 지연 주문이 있다", !!late, JSON.stringify(late));
    await app2.eval(`[...document.querySelectorAll('#tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(late.no)})).click()`); await app2.sleep(300);
    await app2.clickText("#detail button", "안내함으로 기록"); await app2.sleep(400);
    const rowOf = no => app2.eval(`[...document.querySelectorAll('#tbody tr')].findIndex(tr => tr.textContent.includes(${JSON.stringify(no)})) + 1`);
    let r = await rowOf(late.no);
    ctx.check("CUJ-2 ⑩ 안내하면 '안내 10-12'(안내 완료)가 된다", /^안내 10-12/.test(await cell(r)), await cell(r));
    await app2.setValue("#today", "2026-10-18"); await app2.sleep(400);          // 6일 뒤: 아직 아님
    r = await rowOf(late.no);
    ctx.check("CUJ-2 ⑪ 6일 뒤(기준일 10-18)는 아직 '안내 완료'다 (경계: 7일이 되는 날부터)", /^안내 10-12/.test(await cell(r)), await cell(r));
    await app2.setValue("#today", "2026-10-19"); await app2.sleep(400);
    r = await rowOf(late.no);
    await app2.eval(`[...document.querySelectorAll('#tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(late.no)})).click()`); await app2.sleep(300);
    const why1 = (await app2.text('#detail [data-screen-id="LS-31-A"]')) || "";
    ctx.check("CUJ-2 ⑫ 7일째(10-19)에는 '다시 안내'가 되고 이유(7일째 새 소식 없음)가 보인다", (await cell(r)) === "다시 안내" && /7일째 새 소식을 알리지 않았어요/.test(why1), (await cell(r)) + " | " + why1.replace(/\s+/g, " ").slice(0, 60));
    await app2.clickText("#detail button", "안내함으로 기록"); await app2.sleep(400);
    r = await rowOf(late.no);
    ctx.check("CUJ-2 ⑬ 다시 안내를 기록하면 '안내 완료'로 돌아온다", /^안내 10-19/.test(await cell(r)), await cell(r));

    // ================= 규칙 ② 임박 안내 뒤 납기를 넘김 =================
    await app2.setValue("#today", "2026-10-12"); await app2.sleep(300);
    const soon = await app2.eval("(() => { const o = S.result.exceptions.find(x => x.status === '임박' && !(S.informed[x['주문번호']] || []).length); return o ? { no: o['주문번호'], due: o['납기일'] } : null; })()");
    await app2.eval(`[...document.querySelectorAll('#tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(soon.no)})).click()`); await app2.sleep(300);
    await app2.clickText("#detail button", "안내함으로 기록"); await app2.sleep(400);
    const d = new Date(soon.due + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
    await app2.setValue("#today", d.toISOString().slice(0, 10)); await app2.sleep(400);
    r = await rowOf(soon.no);
    await app2.eval(`[...document.querySelectorAll('#tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(soon.no)})).click()`); await app2.sleep(300);
    const why2 = (await app2.text('#detail [data-screen-id="LS-31-A"]')) || "";
    ctx.check("CUJ-2 ⑭ 임박이라고 안내한 주문이 지연이 되면 '다시 안내'가 되고 이유가 보인다", (await cell(r)) === "다시 안내" && /임박 안내 뒤 납기를 넘겼어요/.test(why2), (await cell(r)) + " | " + why2.replace(/\s+/g, " ").slice(0, 70));
    const dir2 = app2.userData;
    await app2.close();

    // ================= 규칙 ③ 안내한 뒤 납기가 바뀜: 새 엑셀(CSV)을 올렸더니 납기가 달라짐 =================
    fs.mkdirSync(OUT, { recursive: true });
    const csv = fs.readFileSync(path.join(ROOT, "샘플주문.csv"), "utf8");
    const target = late.no;
    const changed = csv.split(/\r?\n/).map(line => { const c = line.split(","); if (c[0] !== target) return line; c[5] = "2026-10-01"; return c.join(","); }).join("\r\n");
    ctx.check("CUJ-2 준비: 바꿀 주문(" + target + ")의 납기가 실제로 달라졌다 (아직 지연)", changed !== csv);
    const file = path.join(OUT, "s07-납기변경.csv"); fs.writeFileSync(file, changed, "utf8");
    const app3 = await ctx.launch({ userData: dir2, openFile: file });
    await app3.click("#openBtn"); await app3.showList(); await app3.waitFor(async () => (await app3.count("#tbody tr")) > 0);
    await app3.setValue("#today", "2026-10-19"); await app3.sleep(400);
    const row3 = await app3.eval(`[...document.querySelectorAll('#tbody tr')].findIndex(tr => tr.textContent.includes(${JSON.stringify(target)})) + 1`);
    await app3.eval(`[...document.querySelectorAll('#tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(target)})).click()`); await app3.sleep(300);
    const why3 = (await app3.text('#detail [data-screen-id="LS-31-A"]')) || "";
    ctx.check("CUJ-2 ⑮ 새 목록에서 납기가 바뀌었으면, 저장된 안내 기록이 복원되고 '다시 안내'(납기가 바뀌었어요)가 된다", /다시 안내/.test(await app3.text("#tbody tr:nth-child(" + row3 + ") td:nth-child(4)")) && /안내한 뒤 납기가 바뀌었어요/.test(why3), why3.replace(/\s+/g, " ").slice(0, 70));

    // ================= 외부 통신 =================
    const net = await app3.eval("performance.getEntriesByType('resource').filter(e => /^https?:/.test(e.name)).map(e => e.name)");
    ctx.check("외부 통신 0건: 여정 내내 http(s) 요청이 없다 (키를 넣지 않은 기본 상태)", Array.isArray(net) && net.length === 0, JSON.stringify(net));
  },
};
