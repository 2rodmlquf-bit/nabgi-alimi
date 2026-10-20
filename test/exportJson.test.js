// JSON 내보내기 (src/sync/exportJson.js): 기록은 빠짐없이, 비밀 정보는 하나도 넣지 않는다.
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../src/store/core");
const { buildExport, exportFileName } = require("../src/sync/exportJson");
const { clean } = require("../src/persist");

const view = { ...clean(null), informed: { A: [{ date: "2026-10-10", channel: "전화", status: "지연", due: "", note: "첫째" }, { date: "2026-10-11", channel: "메일", status: "임박", due: "", note: "둘째" }] },
  contacted: { 가온: "2026-10-12" }, reasons: { A: "통관" }, soonRules: "필터=3" };

test("내보내기: 기록 건수와 내용이 들어가고, 클라우드 연결 정보(cloudLink)는 빠진다", () => {
  let s = Core.fromView(view, null, { now: "2026-10-19T09:00:00.000Z" });
  s = { ...s, cloudLink: { enabled: true, project: "practice", ownerUserId: "비밀-계정-id", linkedAt: "x", lastSyncedAt: "y" } };
  const e = buildExport(s, "2026-10-20T00:00:00.000Z");
  assert.equal(e.format, "nabgi-export"); assert.equal(e.exportedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(e.counts.informLog, 2); assert.equal(e.counts.orderMeta, 1); assert.equal(e.counts.contactMarks, 1);
  assert.equal(e.data.cloudLink, undefined);
  assert.ok(!JSON.stringify(e).includes("비밀-계정-id"));
  assert.equal(e.data.informLog.A[0].note, "첫째");
});

test("내보내기: 삭제 표시된 기록은 건수에서는 빠지지만 데이터에는 남는다 (원본 보존)", () => {
  const s1 = Core.fromView(view, null, { now: "2026-10-19T09:00:00.000Z" });
  const v = Core.toView(s1); v.informed.A.shift();
  const s2 = Core.fromView(v, s1, { now: "2026-10-19T10:00:00.000Z" });
  const e = buildExport(s2);
  assert.equal(e.counts.informLog, 1);
  assert.equal(e.data.informLog.A.length, 2);
  assert.equal(e.data.informLog.A.filter(x => x.deletedAt).length, 1);
});

test("내보내기: 빈 상태도 만들어지고, 같은 상태는 같은 내용이고, 파일 이름에 날짜가 들어간다", () => {
  assert.equal(buildExport(Core.emptyState(), "t").counts.informLog, 0);
  const s = Core.fromView(view, null, { now: "2026-10-19T09:00:00.000Z" });
  assert.deepEqual(buildExport(s, "t"), buildExport(s, "t"));
  assert.match(exportFileName(new Date("2026-10-20T05:00:00Z")), /^납기알리미-기록-2026-10-20\.json$/);
});
