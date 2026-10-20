// 가상 공급사 엑셀(.xlsx) 생성기. 실제 회사·사람이 아닌 임의의 가상 파일이다.
// 일부러 공급사가 "마음대로 뜯어고친" 모습을 넣었다: 제목 줄 밀림, 열 이름 변경, 합친 칸, 빈칸, 날짜 형식 제각각,
// 두 번째 시트에 표, 같은 주문이 두 줄, 합계 줄, "확인 후 회신" 같은 말만 적은 칸.
//   사용: node make-sample-supplier.js   → 샘플공급사/ 폴더에 .xlsx 생성
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = i => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const serial = iso => { const [y, m, d] = iso.split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

// 간단한 zip 만들기 (deflate)
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  files.forEach(([name, text]) => {
    const nameBuf = Buffer.from(name, "utf8"), data = Buffer.from(text, "utf8"), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0x0021, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0x0021, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// sheets: [{ name, widths?: 열 너비[], boldRow?: 굵게 할 줄 번호(0부터), rows: (string|number|{date:"YYYY-MM-DD"}|null)[][], merges?: ["A1:F1"] }]
// useShared: true면 문자열을 sharedStrings로, 아니면 인라인으로 저장 (두 방식 모두 읽는지 확인하려고)
function buildXlsx(sheets, useShared = false) {
  const shared = [];
  const sIndex = s => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1; } return i; };
  const sheetXml = sh => {
    const rowsXml = sh.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        if (v == null || v === "") return "";
        const ref = colName(c) + (r + 1);
        const bold = r === sh.boldRow ? ' s="2"' : "";
        if (typeof v === "number") return '<c r="' + ref + '"><v>' + v + "</v></c>";
        if (typeof v === "object" && v.date) return '<c r="' + ref + '" s="1"><v>' + serial(v.date) + "</v></c>";
        return useShared ? '<c r="' + ref + '" t="s"' + bold + '><v>' + sIndex(String(v)) + "</v></c>" : '<c r="' + ref + '" t="inlineStr"' + bold + '><is><t>' + esc(v) + "</t></is></c>";
      }).join("");
      return '<row r="' + (r + 1) + '">' + cells + "</row>";
    }).join("");
    const cols = sh.widths ? "<cols>" + sh.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>" : "";
    const merges = (sh.merges || []).length ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(m => '<mergeCell ref="' + m + '"/>').join("") + "</mergeCells>" : "";
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + rowsXml + "</sheetData>" + merges + "</worksheet>";
  };
  const sheetFiles = sheets.map((sh, i) => ["xl/worksheets/sheet" + (i + 1) + ".xml", sheetXml(sh)]); // 문자열 번호를 정하려면 먼저 시트를 만들어야 한다
  const files = [
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((sh, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("")
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + (useShared ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : "") + "</Types>"],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((sh, i) => '<sheet name="' + esc(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets></workbook>"],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((sh, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("")
      + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + (useShared ? '<Relationship Id="rId' + (sheets.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : "") + "</Relationships>"],
    ["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...sheetFiles,
  ];
  if (useShared) files.push(["xl/sharedStrings.xml", '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + shared.map(s => "<si><t>" + esc(s) + "</t></si>").join("") + "</sst>"]);
  return zip(files);
}

function buildSupplierFiles() {
  // 1) 가온산업: 제목이 합쳐져 있고 표가 4번째 줄에서 시작. 열 이름이 우리 것과 다름. 빈칸·말만 적은 칸·합계 줄이 있음
  const gaon = buildXlsx([{
    name: "Sheet1",
    merges: ["A1:G1"],
    rows: [
      ["가온산업 납기 회신 (2026-10-12)"],
      [],
      ["※ 회신 가능한 항목만 기입했습니다."],
      ["No.", "P/O NO", "품명", "규격", "수량", "회신 납기", "비고"],
      [1, "PO-2026-1001", "산업용 베어링 6204", "6204-2RS", 10, { date: "2026-10-23" }, "통관 서류 보완"],      // 규격이 목록(6204ZZ)과 다름 → 대체품 의심
      [2, "PO-2026-1007", "실험용 니트릴 장갑", "M 사이즈", 10, null, ""],
      [3, "PO-2026-1010", "온도 센서 PT100", "PT100 3선식", 10, "10/14", "동급 모델로 대체 발송 예정"],   // 회신 메모에 "대체"
      [4, "PO-2026-1003", "인버터 부품 세트", "SET-A", 10, "확인 후 회신", "재고 확인 중"],
      [5, "PO-2026-9999", "정밀 저울 보정추", "1kg", 1, { date: "2026-11-02" }, ""],
      ["합계", "", "", "", 31],
    ],
  }], false);

  // 2) 나래테크: 첫 시트는 안내문, 표는 두 번째 시트. 공급사 이름이 세로로 합쳐져 있고, 날짜가 문자열·숫자·말로 제각각. 같은 주문이 두 줄
  const narae = buildXlsx([
    { name: "안내", rows: [["회신 양식 안내"], ["두 번째 시트(납기표)를 확인해 주세요."]] },
    {
      name: "납기표",
      merges: ["A3:A9"],
      rows: [
        [],
        ["공급사", "발주번호", "자재명", "수량", "ETA", "메모"],
        ["나래테크", "PO-2026-1006", "광섬유 점퍼 케이블", 10, "2026.10.12", ""],
        [null, "PO-2026-1004", "에어 필터 (FA-130)", 10, 20261030, ""],                       // 품명·모델이 목록(FA-120 에어 필터 카트리지)과 다름 → 대체품 의심
        [null, "PO-2026-1005", "정밀 드라이버 세트", 10, "11월 초", ""],
        [null, "PO-2026-1002", "유압 호스 1/2인치", 10, "다음 주쯤", ""],
        [null, "PO-2026-1008", "윤활 그리스 카트리지", 6, { date: "2026-10-15" }, "1차 분납"],   // 분납: 6 + 4 = 주문수량 10
        [null, "PO-2026-1008", "윤활 그리스 카트리지", 4, { date: "2026-10-20" }, "2차 분납"],
        [null, "PO-2026-1009", "소형 진공 펌프", 10, "-", ""],
      ],
    },
  ], true);

  return [["가온산업_납기회신.xlsx", gaon], ["나래테크_회신.xlsx", narae]];
}

if (require.main === module) {
  const dir = path.join(__dirname, "샘플공급사");
  fs.mkdirSync(dir, { recursive: true });
  buildSupplierFiles().forEach(([name, buf]) => fs.writeFileSync(path.join(dir, name), buf));
  console.log("샘플 공급사 엑셀 " + buildSupplierFiles().length + "개 생성: " + dir);
}
module.exports = { buildXlsx, buildSupplierFiles, zip };
