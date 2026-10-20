// S-11 공급사 회신·약속일 (PRD FR-21·23·24, CUJ-5): 주문 상세에서 회신을 기록하고, 한눈에로 바로 보고, 답변 초안을 만든다.
// 회신 늦음 판정 규칙 자체는 단위 시험(test/replies.test.js)이 고정한다. 여기서는 화면이 그 결과를 제대로 보여 주는지, 저장·복원되는지 본다.
const fs = require("fs"), path = require("path");

module.exports = {
  id: "S-11",
  name: "공급사 회신·약속일 (CUJ-5): 기록 → 한눈에 → 답변 초안 → 취소 → 재시작 복원",
  run: async ctx => {
    const app = await ctx.launch();
    await app.click("#sampleBtn"); await app.showList();
    await app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const NO = "PO-2026-1002";
    const REPLY = '#detail [data-screen-id="LS-37-A"]', GLANCE = '#detail [data-screen-id="LS-38-A"]', DRAFT = '#detail [data-screen-id="LS-39-A"]';
    const txt = async sel => ((await app.text(sel)) || "").replace(/\s+/g, " ").trim();
    const open = async () => { await app.setValue("#q", "1002", "input"); await app.sleep(300); await app.click("#tbody tr"); await app.sleep(300); };
    const stateFile = () => path.join(app.userData, "state.json");
    const readState = () => JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const fill = (label, value) => app.setValue(`${REPLY} input[aria-label="${label}"]`, value, "input");

    await open();
    ctx.check("상세에 한눈에(LS-38-A)·공급사 회신(LS-37-A)·답변 초안(LS-39-A) 영역이 있다", (await app.exists(GLANCE)) && (await app.exists(REPLY)) && (await app.exists(DRAFT)));
    ctx.check("한눈에는 상세 맨 위(제목·상태 줄 바로 아래, 안내 기록보다 위)에 있다", await app.eval(`(() => { const d = document.getElementById('detail'); const g = d.querySelector('[data-screen-id="LS-38-A"]'), i = d.querySelector('[data-screen-id="LS-31-A"]'); return !!(g.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
    const g0 = await txt(GLANCE);
    ctx.check("처음에는 '공급사 회신 없음'이고 파일 납기와 약속일 없음이 보인다", /공급사 회신 없음/.test(g0) && /약속일 없음/.test(g0) && /납기 /.test(g0), g0);

    // ---------- 입력 검증 ----------
    await fill("회신 받은 날", "");
    await app.click(`${REPLY} button.primary`); await app.sleep(250);
    ctx.check("회신 받은 날을 비우고 기록하면 이유를 알려 주고 기록하지 않는다", /회신 받은 날/.test(await txt(`${REPLY} p[role="status"]`)) && !(fs.existsSync(stateFile()) && Object.keys(readState().orderReplies || {}).length), await txt(`${REPLY} p[role="status"]`));

    // ---------- 기록: 기준일 2026-10-12, 약속일 10-09 → 회신 늦음 3일째 ----------
    await fill("회신 받은 날", "2026-10-05"); await fill("약속일 (선택)", "2026-10-09"); await fill("회신 메모", "통관 서류 보완 후 출고");
    await app.click(`${REPLY} button.primary`); await app.sleep(400);
    const g1 = await txt(GLANCE);
    ctx.check("기록하면 한눈에에 약속일과 마지막 회신이 보인다", /약속일 2026-10-09/.test(g1) && /회신 2026-10-05/.test(g1) && /통관 서류 보완/.test(g1), g1);
    ctx.check("기준일(10-12)이 약속일(10-09)보다 3일 지나서 '회신 늦음 3일째'가 보인다", /회신 늦음 3일째/.test(g1), g1);
    const hist = await txt(`${REPLY} ul.hist`);
    ctx.check("이력에 회신 날짜·방법·약속일·메모가 남는다", /2026-10-05/.test(hist) && /약속일 2026-10-09/.test(hist), hist);

    await app.setValue("#today", "2026-10-09", "change"); await app.sleep(400);
    ctx.check("기준일을 약속일 당일로 바꾸면 '약속일 오늘'이고 늦음은 사라진다 (즉시 다시 계산)", /약속일 오늘/.test(await txt(GLANCE)) && !/회신 늦음/.test(await txt(GLANCE)), await txt(GLANCE));
    await app.setValue("#today", "2026-10-12", "change"); await app.sleep(400);

    // ---------- 저장 ----------
    const saved = await app.waitFor(() => { try { const j = readState(); const l = j.orderReplies && j.orderReplies[NO]; return l && l.length === 1 ? j : null; } catch (e) { return null; } }, 12000);
    ctx.check("저장 파일(v3)에 회신 한 건이 id·만든 시각과 함께 들어간다", !!saved && saved.schemaVersion === 3 && !!saved.orderReplies[NO][0].id && saved.orderReplies[NO][0].promised === "2026-10-09" && saved.orderReplies[NO][0].supplier !== undefined);

    // ---------- 답변 초안 ----------
    await app.eval(`document.querySelector('#detail [data-screen-id="LS-39-A"]').open = true`); await app.sleep(150);
    const mail = await app.eval(`document.querySelector('#detail [data-screen-id="LS-39-A"] textarea[aria-label="이메일 답변 초안"]').value`);
    const call = await app.eval(`document.querySelector('#detail [data-screen-id="LS-39-A"] textarea[aria-label="전화 요점"]').value`);
    ctx.check("이메일 초안에 주문번호·현재 상태·공급사 회신·약속일·다음 조치가 들어 있다", mail.includes(NO) && /현재 상태: /.test(mail) && /2026-10-05에 /.test(mail) && /약속일 2026-10-09/.test(mail) && /다음 조치: 약속일이 지나/.test(mail), mail.slice(0, 120));
    ctx.check("전화 요점은 3줄이고 약속일이 3일 지났다고 말한다", call.split("\n").length === 3 && /3일 지남/.test(call), call);
    ctx.check("초안을 복사하는 단추가 둘 있다 (이메일, 전화 요점). 이 앱은 보내지 않는다", (await app.count(`${DRAFT} button`)) === 2);

    // ---------- 재시작 복원 ----------
    await app.close();
    const app2 = await ctx.launch({ userData: app.userData });
    await app2.click("#sampleBtn"); await app2.showList(); await app2.waitFor(async () => (await app2.count("#tbody tr")) > 0);
    await app2.setValue("#q", "1002", "input"); await app2.sleep(300); await app2.click("#tbody tr"); await app2.sleep(300);
    const g2 = ((await app2.text(GLANCE)) || "").replace(/\s+/g, " ");
    ctx.check("앱을 껐다 켜도 회신 기록이 복원되어 한눈에에 보인다", /회신 2026-10-05/.test(g2) && /약속일 2026-10-09/.test(g2), g2);

    // ---------- 취소 ----------
    await app2.click(`${REPLY} button.quiet`); await app2.sleep(400);
    ctx.check("마지막 기록을 취소하면 한눈에가 '공급사 회신 없음'으로 돌아간다", /공급사 회신 없음/.test(((await app2.text(GLANCE)) || "")), (await app2.text(GLANCE)) || "");
    const after = await app2.waitFor(() => { try { const j = JSON.parse(fs.readFileSync(path.join(app2.userData, "state.json"), "utf8")); const l = j.orderReplies && j.orderReplies[NO]; return l && l.length === 1 && l[0].deletedAt ? j : null; } catch (e) { return null; } }, 12000);
    ctx.check("취소해도 파일에는 삭제 표시(user)로 남는다 (기록은 지우지 않는다)", !!after && after.orderReplies[NO][0].deletedReason === "user");
  },
};
