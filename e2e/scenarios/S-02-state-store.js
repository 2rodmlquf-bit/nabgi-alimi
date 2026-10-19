// S-02 저장소: 실제 앱이 예전 형식 저장 파일을 잃지 않고 새 형식으로 바꾸는지, 손상·새 버전 파일을 어떻게 다루는지, 안내 기록 취소가 삭제 표시로 남는지 확인한다 (Phase 2).
// 단위·계약 테스트가 저장소 로직을 지키고, 여기서는 앱 전체(메인 프로세스 + 화면)가 이어지는지 본다.
const fs = require("fs"), path = require("path");
const { ROOT } = require("../helpers");

const newDir = () => fs.mkdtempSync(path.join(ROOT, ".e2e-userdata-"));
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));

// 2026-10-19 실제 저장 파일(안내 기록 기능 이전 버전)과 같은 모양 + 안내 기록과 사유가 있는 예전 파일
const V0 = {
  edited: {}, reasons: { "PO-2026-1002": "E2E 사유: 통관 서류 보완" }, causeOverride: {},
  notice: { template: "공지형", alt: "", signature: "E2E서명" },
  contacted: { 가온산업: "2026-10-12", 바다물산: "2026-10-12" },
  contactLog: { 가온산업: [{ date: "2026-10-12", kind: "attempt", channel: "메일", promised: "", note: "" }] },
  subst: {}, schedule: {}, soonRules: "필터=3\n그리스=3",
  informed: { "PO-2026-1001": [{ date: "2026-10-12", channel: "전화", status: "지연", due: "2026-09-24", note: "E2E 전화 설명" }] },
};

module.exports = {
  id: "S-02",
  name: "저장소: 예전 형식 이전, 삭제 표시, 손상·새 버전 파일",
  run: async ctx => {
    const info = app => app.text("#savedInfo").then(t => (t || "").replace(/\s+/g, " "));
    const rowsReady = app => app.waitFor(async () => (await app.count("#tbody tr")) > 0);
    const badge1 = app => app.text("#tbody tr td:nth-child(4)").then(t => (t || "").trim());

    // ---------- 1. 예전(v0) 형식 파일 ----------
    const dir1 = newDir();
    const original = JSON.stringify(V0);
    fs.writeFileSync(path.join(dir1, "state.json"), original, "utf8");
    let app = await ctx.launch({ userData: dir1 });
    const note1 = await app.waitFor(async () => { const t = await info(app); return /새 형식으로 바꿨어요/.test(t) ? t : null; }, 5000);
    ctx.check("앱을 열면 예전 저장 파일을 새 형식으로 바꿨다고 화면에 알려 준다 (백업 파일 이름 포함)", !!note1 && /state\.v0\.bak\.json/.test(note1), note1 || (await info(app)));
    ctx.check("디스크: 백업은 예전 파일과 똑같고, state.json은 v1이며, 임시 파일은 남지 않는다", fs.readFileSync(path.join(dir1, "state.v0.bak.json"), "utf8") === original && readJson(path.join(dir1, "state.json")).schemaVersion === 1 && !fs.existsSync(path.join(dir1, "state.json.tmp")));
    const v1 = readJson(path.join(dir1, "state.json"));
    const e0 = (v1.informLog["PO-2026-1001"] || [])[0] || {};
    ctx.check("예전 안내 기록이 id·만든 시각이 붙어 새 형식에 들어갔다 (내용은 그대로)", e0.channel === "전화" && e0.note === "E2E 전화 설명" && e0.status === "지연" && !!e0.id && e0.createdAt === "2026-10-12T12:00:00.000Z", JSON.stringify(e0));
    ctx.check("사유·안내문 선택·서명·공급사 연락 기록도 잃지 않았다", v1.orderMeta["PO-2026-1002"].reason === "E2E 사유: 통관 서류 보완" && v1.settings.notice.signature === "E2E서명" && v1.settings.soonRules === "필터=3\n그리스=3" && Object.keys(v1.legacy.contacted).length === 2 && v1.legacy.contactLog["가온산업"].length === 1);

    await app.click("#sampleBtn"); await rowsReady(app);
    ctx.check("화면에서도 예전 안내 기록이 보인다: 첫 주문이 '안내 10-12'", (await badge1(app)) === "안내 10-12", await badge1(app));
    await app.click("#tbody tr:nth-child(2)"); await app.sleep(300);
    ctx.check("화면에서도 예전 사유가 보인다 (PO-2026-1002)", /E2E 사유: 통관 서류 보완/.test((await app.text("#detail")) || ""));

    // ---------- 2. 안내 기록 취소 -> 삭제 표시 ----------
    await app.click("#tbody tr:nth-child(1)"); await app.sleep(300);
    await app.clickText("#detail button", "마지막 기록 취소");
    await app.waitFor(async () => (await badge1(app)) === "미안내", 4000);
    const afterUndo = await app.waitFor(() => { const e = (readJson(path.join(dir1, "state.json")).informLog["PO-2026-1001"] || [])[0]; return e && e.deletedAt ? e : null; }, 5000);
    ctx.check("기록을 취소하면 화면에서는 사라지고 파일에는 삭제 표시(deletedAt)가 남는다 (기록 자체는 지우지 않는다)", !!afterUndo && readJson(path.join(dir1, "state.json")).informLog["PO-2026-1001"].length === 1 && afterUndo.id === e0.id, afterUndo ? "deletedAt " + afterUndo.deletedAt : "삭제 표시 없음");

    await app.close();
    app = await ctx.launch({ userData: dir1 });
    await app.click("#sampleBtn"); await rowsReady(app);
    ctx.check("앱을 다시 켜도 취소한 기록은 보이지 않는다 (삭제 표시가 복원 때 살아나지 않는다)", (await badge1(app)) === "미안내");
    ctx.check("두 번째 실행에서는 '새 형식' 알림이 다시 뜨지 않는다 (이전은 한 번만)", !/새 형식으로 바꿨어요/.test(await info(app)), await info(app));
    ctx.check("백업은 처음 그대로이고 다른 백업 파일이 늘지 않았다", fs.readdirSync(dir1).filter(n => /^state\.v0\.bak/.test(n)).length === 1 && fs.readFileSync(path.join(dir1, "state.v0.bak.json"), "utf8") === original);
    await app.close();

    // ---------- 3. 손상된 파일 ----------
    const dir2 = newDir();
    fs.writeFileSync(path.join(dir2, "state.json"), '{ "informed": ', "utf8");
    app = await ctx.launch({ userData: dir2 });
    const note2 = await app.waitFor(async () => { const t = await info(app); return /새로 시작했어요/.test(t) ? t : null; }, 5000);
    ctx.check("손상된 저장 파일이면 새로 시작했다고, 손상 파일은 보관했다고 화면에 알려 준다", !!note2 && /그대로 보관했어요: state\.corrupt-/.test(note2), note2 || "");
    const kept = fs.readdirSync(dir2).filter(n => /^state\.corrupt-.*\.json$/.test(n));
    ctx.check("손상 파일은 지워지지 않고 내용 그대로 보관된다", kept.length === 1 && fs.readFileSync(path.join(dir2, kept[0]), "utf8") === '{ "informed": ');
    await app.click("#sampleBtn"); await rowsReady(app);
    await app.click("#tbody tr"); await app.sleep(250);
    await app.clickText("#detail button", "안내함으로 기록");
    const fresh = await app.waitFor(() => { try { const j = readJson(path.join(dir2, "state.json")); return j && j.informLog && Object.keys(j.informLog).length >= 1 ? j : null; } catch (e) { return null; } }, 12000);   // 기록이 들어간 파일을 기다린다 (먼저 쓰인 빈 파일을 읽고 실패하던 경쟁 상태를 없앰)
    ctx.check("그 뒤에는 평소처럼 쓸 수 있다: 안내 기록이 새 v1 파일에 저장된다", !!fresh && fresh.schemaVersion === 1 && Object.keys(fresh.informLog).length === 1);
    await app.close();

    // ---------- 4. 이 앱보다 새로운 버전의 파일 ----------
    const dir3 = newDir();
    const future = JSON.stringify({ schemaVersion: 2, 새로운: "필드" });
    fs.writeFileSync(path.join(dir3, "state.json"), future, "utf8");
    app = await ctx.launch({ userData: dir3 });
    const note3 = await app.waitFor(async () => { const t = await info(app); return /새로운 버전/.test(t) ? t : null; }, 5000);
    ctx.check("더 새로운 버전의 파일이면 읽기만 한다고 화면에 알려 준다", !!note3 && /저장하지 않고 읽기만 해요/.test(note3), note3 || "");
    await app.click("#sampleBtn"); await rowsReady(app);
    await app.click("#tbody tr"); await app.sleep(250);
    await app.clickText("#detail button", "안내함으로 기록");
    const err = await app.waitFor(async () => { const t = await info(app); return /저장하지 않았어요/.test(t) ? t : null; }, 5000);
    ctx.check("그 상태에서 기록하면 저장 실패 이유를 화면에 보여 준다", !!err, err || (await info(app)));
    ctx.check("파일은 한 글자도 바뀌지 않았고 보관·백업 파일도 만들지 않았다", fs.readFileSync(path.join(dir3, "state.json"), "utf8") === future && JSON.stringify(fs.readdirSync(dir3).filter(n => /^state/.test(n))) === JSON.stringify(["state.json"]));   // 폴더에는 Electron의 캐시 파일도 생기므로 저장 파일(state*)만 본다
    await app.close();
  },
};
