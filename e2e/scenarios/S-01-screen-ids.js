// S-01 화면 ID 점검: IA의 화면 ID(docs/screens.json)가 실제 화면(data-screen-id)에 붙어 있는지 확인한다 (devpian.md T1.8).
// - 상태가 신규가 아닌 화면은 앱을 이리저리 조작하는 동안 한 번은 화면에 나타나야 한다.
// - 상태가 신규인 화면은 아직 없어야 한다. 이미 있다면 docs/screens.json의 상태를 고쳐야 한다는 뜻이다.
// - screens.json에 없는 ID가 화면에 붙어 있으면 오타다.
const fs = require("fs"), path = require("path");
const { ROOT } = require("../helpers");

module.exports = {
  id: "S-01",
  name: "화면 ID: IA의 화면 ID가 실제 화면에 붙어 있다",
  run: async ctx => {
    const { screens } = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "screens.json"), "utf8"));
    const app = await ctx.launch();
    const seen = new Set();
    const collect = async () => (await app.eval("[...new Set([...document.querySelectorAll('[data-screen-id]')].map(e => e.getAttribute('data-screen-id')))]")).forEach(i => seen.add(i));
    const rowsReady = () => app.waitFor(async () => (await app.count("#tbody tr")) > 0);

    await collect();                                  // 시작 직후: 고정 화면(빈 화면, 패널, 탭 내용)
    await app.click("#sampleBtn"); await app.showList(); await rowsReady(); await collect();
    await app.click("#tbody tr"); await app.sleep(300); await collect();        // 주문 상세 안의 영역들
    // 분납 일정 영역은 분납 일정이 있는 주문에만 나온다. 샘플에는 없어서 화면 상태에 직접 넣어 본다.
    await app.eval("S.schedule[S.selected] = [{ date: '2026-10-30', qty: '5' }]; render(); 1"); await app.sleep(200); await collect();
    await app.eval("document.querySelector('#tbody tr').children[7].click()"); await app.sleep(300);   // 요청자 칸: 연구원 필터
    await app.clickText("#filterChip button", "한 통", { exact: false }); await app.sleep(300); await collect();
    await app.click("#tabAna"); await app.sleep(300); await collect();
    await app.clickText("#analysis button", "안내문 만들기"); await app.sleep(300); await collect();
    await app.click("#tabContact"); await app.sleep(300); await collect();
    await app.click("#tabReport"); await app.sleep(300); await collect();
    await app.click("#emailBtn"); await app.sleep(300); await collect();

    const known = new Set(screens.map(s => s.id));
    const expected = screens.filter(s => s.status !== "신규");
    const planned = screens.filter(s => s.status === "신규");
    const missing = expected.filter(s => !seen.has(s.id)).map(s => s.id);
    ctx.check(`IA의 기존 화면 ${expected.length}개가 모두 화면에 붙어 있다`, missing.length === 0, missing.length ? "없음: " + missing.join(", ") : "");
    const inScope = expected.filter(s => s.scope === "in");
    ctx.check(`그중 S1 범위 안 화면 ${inScope.length}개`, inScope.every(s => seen.has(s.id)));
    const unknown = [...seen].filter(i => !known.has(i));
    ctx.check("screens.json에 없는 화면 ID가 붙어 있지 않다 (오타 방지)", unknown.length === 0, unknown.join(", "));
    const early = planned.filter(s => seen.has(s.id)).map(s => s.id);
    ctx.check("'신규'로 적힌 화면이 아직 없다 (이미 만들었다면 screens.json의 상태를 고친다)", early.length === 0, early.join(", "));
    ctx.note("아직 없는 신규 화면(예정): " + planned.map(s => s.id + " " + s.name).join(", "));
  },
};
