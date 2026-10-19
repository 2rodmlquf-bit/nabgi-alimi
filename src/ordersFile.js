// 주문 목록 파일(.xlsx / 확장자만 틀린 CSV)을 앱이 쓰는 표 { columns, rows }로 바꾼다 (PRD FR-07, CUJ-4).
// 화면과 무관한 순수 함수. 열 이름 추측은 src/columns.js를 그대로 쓴다 (CSV와 같은 기준).
// 지키는 것: 값을 지어내지 않는다 / 한도로 잘렸으면 반드시 알린다 / 읽을 수 없으면 이유를 말한다.
const { guessMapping } = require("./columns");
const { parseCsv } = require("./csv");
const { readXlsx, MAX_ROWS, MAX_COLS } = require("./xlsx");

const MAX_FILE = 20 * 1024 * 1024;   // 읽기 전 파일 크기 한도 (공급사 경로와 같다)
const SCAN = 40;                      // 머리글을 찾을 앞쪽 줄 수

const cellText = v => String(v == null ? "" : v).trim();

// 머리글 줄 찾기: 앞쪽 40줄 중 주문번호·납기일 열이 둘 다 맞고 연결되는 표준 열이 가장 많은 줄. 없으면 null.
// 짧은 칸만 본다 (제목 줄이나 데이터 줄의 긴 글이 머리글로 오인되지 않게).
function detectHeaderRow(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, SCAN); i++) {
    const cells = (rows[i] || []).map(c => { const t = cellText(c); return t.length <= 24 ? t : ""; });
    if (cells.filter(Boolean).length < 2) continue;
    const m = guessMapping(cells);
    if (!m.주문번호 || !m.납기일) continue;
    const score = Object.values(m).filter(Boolean).length;
    if (!best || score > best.score) best = { index: i, score };
  }
  return best;
}

// 머리글 줄 아래를 객체 배열로. 빈 머리글은 "열N", 같은 이름은 "이름(2)"로 구분하고, 끝의 빈 열과 빈 줄은 버린다.
function toTable(rows, headerIdx) {
  const head = (rows[headerIdx] || []).map(cellText);
  let width = head.length;
  const body = rows.slice(headerIdx + 1).map(r => (r || []).map(cellText)).filter(r => r.some(v => v !== ""));
  while (width > 0 && head[width - 1] === "" && body.every(r => !r[width - 1])) width--;
  const seen = new Map();
  const columns = [];
  for (let i = 0; i < width; i++) {
    let name = head[i] || "열" + (i + 1);
    const n = (seen.get(name) || 0) + 1; seen.set(name, n);
    columns.push(n > 1 ? name + "(" + n + ")" : name);
  }
  return { columns, rows: body.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i] || ""]))) };
}

// 시트 고르기. 머리글(주문번호·납기일)이 있는 시트가 후보이고 그중 점수가 높은 첫 시트를 쓴다.
// 후보가 없으면 내용이 있는 첫 시트(열 연결 화면에서 사람이 맞춘다). 내용이 없으면 null.
function pickSheet(sheets) {
  const info = sheets.map((sh, i) => ({ i, sh, head: detectHeaderRow(sh.rows) }));
  const cands = info.filter(x => x.head);
  if (cands.length) {
    const best = cands.reduce((a, b) => (b.head.score > a.head.score ? b : a));
    return { index: best.i, headerIdx: best.head.index, candidates: cands.map(x => x.i) };
  }
  const first = info.find(x => x.sh.rows.length);
  return first ? { index: first.i, headerIdx: 0, candidates: [] } : null;
}

// 시트 하나를 표로. notes에는 사용자가 알아야 할 것(건너뛴 줄, 잘림)을 담는다.
function tableOf(sheet, headerIdx, sheetCount) {
  const t = toTable(sheet.rows, headerIdx);
  const truncated = sheet.truncated || { rows: false, cols: false }, notes = [];
  if (sheetCount > 1) notes.push("시트 " + sheetCount + "개 중 '" + sheet.name + "' 시트를 읽었어요.");
  if (headerIdx > 0) notes.push("표 위의 " + headerIdx + "줄(제목 등)은 건너뛰고 " + (headerIdx + 1) + "번째 줄을 열 이름으로 읽었어요.");
  if (truncated.rows) notes.push("행이 많아 앞의 " + MAX_ROWS + "줄까지만 읽었어요. 뒤의 주문은 이 목록에 없어요.");
  if (truncated.cols) notes.push("열이 많아 앞의 " + MAX_COLS + "열까지만 읽었어요.");
  return { sheetName: sheet.name, headerRow: headerIdx + 1, columns: t.columns, rows: t.rows, truncated, notes };
}

const looksText = buf => { const n = Math.min(buf.length, 2048); for (let i = 0; i < n; i++) if (buf[i] === 0) return false; return true; };
const isZip = b => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
const isOle = b => b.length > 7 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
const fail = error => ({ ok: false, error });

// 파일 하나를 읽는다. opts.decode(buf) → 글자 (CSV용, 없으면 UTF-8).
// 성공: { ok, name, columns, rows, sheetName?, headerRow?, truncated?, notes, choices? }
// 실패: { ok: false, error }  (앱이 멈추지 않도록 던지지 않는다)
function readOrders(name, buf, opts = {}) {
  const decode = opts.decode || (b => b.toString("utf8"));
  if (!buf || !buf.length) return fail("비어 있는 파일이에요.");
  if (buf.length > MAX_FILE) return fail("파일이 너무 커요 (20MB 이하만 읽어요).");
  try {
    if (isOle(buf)) return fail(/\.xls$/i.test(name)
      ? ".xls(구형 엑셀)는 열 수 없어요. 엑셀에서 '다른 이름으로 저장'으로 .xlsx나 CSV로 저장한 뒤 열어 주세요."
      : "암호가 걸린 파일이거나 구형 엑셀 형식이에요. 암호를 풀고 .xlsx나 CSV로 저장한 뒤 열어 주세요.");
    if (!isZip(buf)) {
      if (!looksText(buf)) return fail("엑셀(.xlsx)이나 CSV 파일이 아니에요.");
      const notes = /\.xlsx$/i.test(name) ? ["확장자는 .xlsx지만 내용이 CSV라서 CSV로 읽었어요."] : [];
      const rows = parseCsv(decode(buf)).map(r => r.map(cellText));
      const h = detectHeaderRow(rows);
      const t = toTable(rows, h ? h.index : 0);
      if (!t.columns.length || !t.rows.length) return fail("읽을 수 있는 행이 없어요. 주문 목록 파일이 맞는지 확인해 주세요.");
      return { ok: true, name, columns: t.columns, rows: t.rows, notes };
    }
    const sheets = readXlsx(buf);
    const pick = pickSheet(sheets);
    if (!pick) return fail("엑셀 안에 내용이 있는 시트가 없어요.");
    const main = tableOf(sheets[pick.index], pick.headerIdx, sheets.length);
    if (!main.columns.length || !main.rows.length) return fail("읽을 수 있는 행이 없어요. 주문 목록 파일이 맞는지 확인해 주세요.");
    const out = { ok: true, name, ...main };
    if (pick.candidates.length > 1) out.choices = pick.candidates.map(i => tableOf(sheets[i], detectHeaderRow(sheets[i].rows).index, sheets.length)).filter(t => t.rows.length);
    return out;
  } catch (e) {
    return fail(e && e.constructor && e.constructor.name === "XlsxError" ? e.message : "파일을 읽지 못했어요. 엑셀(.xlsx)이나 CSV가 맞는지 확인해 주세요.");
  }
}

module.exports = { MAX_FILE, detectHeaderRow, toTable, pickSheet, readOrders };
