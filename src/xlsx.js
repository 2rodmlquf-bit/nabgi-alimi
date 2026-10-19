// .xlsx 읽기 (외부 라이브러리 없음). xlsx는 zip 안에 XML을 담은 형식이라 zip을 풀고 필요한 XML만 읽는다.
// 읽는 것: 시트 이름과 순서, 문자열(공유·인라인), 숫자, 날짜(엑셀 날짜 번호 → YYYY-MM-DD), 합친 칸(왼쪽 위 값으로 채움).
// 읽지 않는 것: 수식 계산(저장된 값만 읽음), 서식, 차트, 숨김 여부, 1904 날짜 체계. 메인 프로세스(Node)에서만 쓴다.
const zlib = require("zlib");

const MAX_ENTRY = 40 * 1024 * 1024; // 압축을 풀었을 때 한 파일 최대 크기 (압축 폭탄 방지)
const MAX_ROWS = 5000, MAX_COLS = 80;

class XlsxError extends Error {}

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxError("엑셀(.xlsx) 파일 형식이 아니에요.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("파일이 손상되어 있어요.");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + elen + clen;
    files.set(name, { method, csize, usize, off });
  }
  return {
    has: name => files.has(name),
    names: () => [...files.keys()],
    read(name) {
      const e = files.get(name);
      if (!e) return null;
      if (e.usize > MAX_ENTRY) throw new XlsxError("파일 안의 내용이 너무 커요.");
      const h = e.off;
      if (buf.readUInt32LE(h) !== 0x04034b50) throw new XlsxError("파일이 손상되어 있어요.");
      const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
      const data = buf.slice(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new XlsxError("지원하지 않는 압축 방식이에요.");
    },
  };
}

const unesc = s => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const attr = (tag, name) => { const m = new RegExp("\\b" + name + '="([^"]*)"').exec(tag); return m ? unesc(m[1]) : ""; };
const textOf = xml => { let out = ""; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) out += unesc(m[1]); return out; };

function colIndex(letters) { let n = 0; for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }
function splitRef(ref) { const m = /^([A-Z]+)(\d+)$/i.exec(ref); return m ? { c: colIndex(m[1]), r: +m[2] - 1 } : null; }

function serialToIso(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateFormat(id, code) {
  if (BUILTIN_DATE_IDS.has(id)) return true;
  if (!code) return false;
  const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[ymd]/i.test(c) && !/^[#0.,%\s]+$/.test(c);
}

function readStyles(xml) {
  if (!xml) return [];
  const codes = new Map();
  (xml.match(/<numFmt\b[^>]*>/g) || []).forEach(t => codes.set(+attr(t, "numFmtId"), attr(t, "formatCode")));
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cellXfs) return [];
  return (cellXfs[1].match(/<xf\b[^>]*>/g) || []).map(t => { const id = +attr(t, "numFmtId") || 0; return isDateFormat(id, codes.get(id)); });
}

function readSharedStrings(xml) {
  if (!xml) return [];
  return (xml.match(/<si\b[\s\S]*?<\/si>|<si\s*\/>/g) || []).map(textOf);
}

function readSheet(xml, shared, dateStyles) {
  const grid = [];
  let maxC = 0;
  const cut = { rows: false, cols: false };   // 한도를 넘는 칸이 있었는가 (조용히 버리지 않고 호출자에게 알린다)
  const put = (r, c, v) => {
    if (r >= MAX_ROWS || c >= MAX_COLS) { if (r >= MAX_ROWS) cut.rows = true; else cut.cols = true; return; }
    (grid[r] = grid[r] || [])[c] = v; if (c + 1 > maxC) maxC = c + 1;
  };
  const re = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const ref = splitRef(attr(m[1], "r"));
    if (!ref) continue;
    const t = attr(m[1], "t"), s = attr(m[1], "s");
    const inner = m[2] || "";
    const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
    let val = "";
    if (t === "s") val = shared[+v] != null ? shared[+v] : "";
    else if (t === "inlineStr") val = textOf(inner);
    else if (t === "str" || t === "e") val = v != null ? unesc(v) : "";
    else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
    else if (v != null && v !== "") val = dateStyles[+s] ? serialToIso(parseFloat(v)) : String(parseFloat(v)) === v.trim() ? v.trim() : unesc(v);
    if (val !== "") put(ref.r, ref.c, String(val).trim());
  }
  // 합친 칸: 왼쪽 위 값을 합친 범위의 빈 칸에 채운다 (세로로 합친 공급사 이름 등이 모든 줄에 보이도록)
  (xml.match(/<mergeCell\b[^>]*>/g) || []).forEach(t => {
    const [a, b] = attr(t, "ref").split(":");
    const s = splitRef(a), e = splitRef(b || a);
    if (!s || !e || (e.r - s.r + 1) * (e.c - s.c + 1) > 5000) return;
    const top = (grid[s.r] || [])[s.c];
    if (top == null) return;
    for (let r = s.r; r <= e.r; r++) for (let c = s.c; c <= e.c; c++) if ((grid[r] || [])[c] == null) put(r, c, top);
  });
  const rows = [];
  for (let r = 0; r < grid.length; r++) { const row = grid[r] || []; const out = []; for (let c = 0; c < maxC; c++) out.push(row[c] != null ? row[c] : ""); rows.push(out); }
  while (rows.length && rows[rows.length - 1].every(x => x === "")) rows.pop();
  return { rows, truncated: cut };
}

// 반환: [{ name, rows: string[][], truncated: { rows, cols } }]  (시트 순서대로)
// truncated.rows/cols: 5,000행·80열 한도를 넘는 값이 있어 일부만 읽었다는 뜻.
function readXlsx(buffer) {
  const zip = readZip(Buffer.from(buffer));
  if (!zip.has("xl/workbook.xml")) throw new XlsxError("엑셀(.xlsx) 파일 형식이 아니에요.");
  const text = n => (zip.read(n) ? zip.read(n).toString("utf8") : "");
  const wb = text("xl/workbook.xml");
  const rels = new Map();
  (text("xl/_rels/workbook.xml.rels").match(/<Relationship\b[^>]*>/g) || []).forEach(t => rels.set(attr(t, "Id"), attr(t, "Target")));
  const shared = readSharedStrings(text("xl/sharedStrings.xml"));
  const dateStyles = readStyles(text("xl/styles.xml"));
  const sheets = [];
  (wb.match(/<sheet\b[^>]*>/g) || []).forEach(t => {
    let target = rels.get(attr(t, "r:id")) || "";
    target = target.replace(/^\//, "").replace(/^xl\//, "");
    const xml = target ? text("xl/" + target) : "";
    if (xml) { const sh = readSheet(xml, shared, dateStyles); sheets.push({ name: attr(t, "name"), rows: sh.rows, truncated: sh.truncated }); }
  });
  if (!sheets.length) throw new XlsxError("엑셀 안에서 시트를 찾지 못했어요.");
  return sheets;
}

module.exports = { readXlsx, XlsxError, serialToIso, MAX_ROWS, MAX_COLS };
