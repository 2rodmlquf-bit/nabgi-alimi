// 아주 작은 CSV 읽기. 따옴표 안의 쉼표·줄바꿈, CRLF, 맨 앞 BOM을 처리한다.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(v => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v !== "")) rows.push(row);
  return rows;
}

// 첫 줄을 열 이름으로 보고 객체 배열로 바꾼다.
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { columns: [], rows: [] };
  const columns = rows[0].map(h => h.trim());
  return { columns, rows: rows.slice(1).map(r => Object.fromEntries(columns.map((h, i) => [h, (r[i] || "").trim()]))) };
}

const csvApi = { parseCsv, csvToObjects };
if (typeof module !== "undefined") module.exports = csvApi; else window.Csv = csvApi;
