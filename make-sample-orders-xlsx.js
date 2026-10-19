// 가상 주문 목록 엑셀(.xlsx) 생성기. 샘플주문.csv와 같은 내용을 엑셀로 만들고, 시험용 변형 파일도 만든다.
// 실제 회사·사람이 아닌 임의의 가상 데이터다.
//   사용: node make-sample-orders-xlsx.js   → 샘플주문.xlsx 생성
const fs = require("fs");
const path = require("path");
const { buildXlsx, zip } = require("./make-sample-supplier");
const { parseCsv } = require("./src/csv");

const NUM_COLS = new Set(["주문수량", "입고수량"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function baseTable() {
  const rows = parseCsv(fs.readFileSync(path.join(__dirname, "샘플주문.csv"), "utf8"));
  return { head: rows[0], body: rows.slice(1) };
}

// typed: 숫자·날짜를 엑셀 형식(숫자 칸, 날짜 번호)으로 저장. false면 전부 글자.
function cells(head, row, typed) {
  return row.map((v, i) => {
    if (!typed || v === "") return v;
    if (NUM_COLS.has(head[i]) && /^\d+$/.test(v)) return Number(v);
    if (ISO.test(v)) return { date: v };
    return v;
  });
}

function buildOrderFixtures() {
  const { head, body } = baseTable();
  const typedRows = body.map(r => cells(head, r, true));
  const f = {};
  f["01-정상.xlsx"] = buildXlsx([{ name: "주문", rows: [head, ...typedRows] }]);
  f["02-제목줄과합친칸.xlsx"] = buildXlsx([{ name: "주문", merges: ["A1:F1"], rows: [["연구소 주문 납기 현황 (가상)", "", "", "", "", ""], ["작성: 구매팀 / 2026-10-12 기준"], [], head, ...typedRows] }]);
  f["03-표지시트먼저.xlsx"] = buildXlsx([{ name: "표지", rows: [["주문 현황", ""], ["이 파일은 가상 데이터입니다"]] }, { name: "주문", rows: [head, ...typedRows] }]);
  f["05-날짜글자.xlsx"] = buildXlsx([{ name: "주문", rows: [head, ...body.map(r => cells(head, r, false))] }], true);
  const idCol = head.indexOf("주문번호");
  f["06-주문번호숫자.xlsx"] = buildXlsx([{ name: "주문", rows: [head, ...typedRows.map((r, i) => r.map((v, c) => (c === idCol ? 1001 + i : v)))] }]);
  f["07-뒤에빈줄.xlsx"] = buildXlsx([{ name: "주문", rows: [head, ...typedRows, [], [""], ["", "", ""]] }]);
  const wide = Array.from({ length: 90 }, (_, i) => (i < head.length ? head[i] : "추가열" + (i + 1)));
  f["08-열90개.xlsx"] = buildXlsx([{ name: "주문", rows: [wide, ...typedRows.slice(0, 3).map(r => [...r, ...Array(90 - r.length).fill("x")])] }]);
  const many = [head];
  for (let i = 0; i < 5000; i++) many.push(["PO-9" + String(i).padStart(5, "0"), "품목" + i, "가온산업", "연구1팀", "2026-09-01", "2026-10-30", "", "", "", "", "1", "", ""]);
  f["09-5001줄.xlsx"] = buildXlsx([{ name: "주문", rows: many }]);
  f["10-손상.xlsx"] = f["01-정상.xlsx"].subarray(0, Math.floor(f["01-정상.xlsx"].length / 2));
  f["11-CSV를xlsx로.xlsx"] = Buffer.from(fs.readFileSync(path.join(__dirname, "샘플주문.csv"), "utf8"), "utf8");
  f["12-구형xls.xls"] = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  f["13-시트둘다표.xlsx"] = buildXlsx([{ name: "A동", rows: [head, ...typedRows.slice(0, 3)] }, { name: "B동", rows: [head, ...typedRows.slice(3, 8)] }]);
  f["14-열이름다름.xlsx"] = buildXlsx([{ name: "주문", rows: [["발주번호", "자재", "거래처", "도착예정", "메모"], ["X-1", "베어링", "가온산업", { date: "2026-10-20" }, ""]] }]);
  return f;
}

// 압축 폭탄: 작게 압축되지만 풀면 한도(40MB)를 넘는 xml
function buildZipBomb() {
  const big = "<a>" + " ".repeat(41 * 1024 * 1024) + "</a>";
  return zip([["xl/workbook.xml", big]]);
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, "샘플주문.xlsx"), buildOrderFixtures()["01-정상.xlsx"]);
  console.log("샘플주문.xlsx 생성");
}
module.exports = { buildOrderFixtures, buildZipBomb };
