// 내 기록을 JSON 파일로 내보낼 내용을 만든다 (FR-S08). 언제든 쓸 수 있고, 로그인·서버와 무관하다 (로컬 기록이 기준).
// 비밀 정보는 넣지 않는다: 클라우드 연결 정보(cloudLink)와 토큰·키는 뺀다. 삭제 표시된 기록도 그대로 넣는다(원본 보존).
const Core = require("../store/core");

function buildExport(state, now = new Date().toISOString()) {
  const s = Core.normalizeState(state);
  const { cloudLink, ...records } = s;
  const counts = {};
  for (const k of ["informLog", "quickNotes", "contactLog", "substChecks", "scheduleEntries", "orderReplies"]) counts[k] = Object.values(records[k]).flat().filter(e => !e.deletedAt).length;
  counts.orderMeta = Object.keys(records.orderMeta).length;
  counts.contactMarks = Object.keys(records.contactMarks).length;
  return { app: "납기 알리미", format: "nabgi-export", exportedAt: now, counts, data: records };
}

function exportFileName(now = new Date()) { return "납기알리미-기록-" + now.toISOString().slice(0, 10) + ".json"; }

module.exports = { buildExport, exportFileName };
