// 주문 목록 xlsx 읽기 (PRD FR-07, CUJ-4). 같은 내용이면 CSV와 xlsx가 같은 결과를 내야 한다.
process.env.TZ = "Asia/Seoul";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const O = require("../src/ordersFile");
const { readXlsx, MAX_ROWS, MAX_COLS } = require("../src/xlsx");
const { csvToObjects } = require("../src/csv");
const { guessMapping, STD } = require("../src/columns");
const Judge = require("../src/judge");
const { buildXlsx } = require("../make-sample-supplier");
const { buildOrderFixtures, buildZipBomb } = require("../make-sample-orders-xlsx");

const F = buildOrderFixtures();
const CSV_TEXT = fs.readFileSync(path.join(__dirname, "..", "샘플주문.csv"), "utf8");
const CSV = csvToObjects(CSV_TEXT);
const TODAY = "2026-10-12";

// 화면이 하는 것과 같은 순서: 열 추측 → 표준 열로 → 판정
function judge(table) {
  const m = guessMapping(table.columns);
  const rows = table.rows.map(row => { const o = { _raw: row }; STD.forEach(s => (o[s] = m[s] ? row[m[s]] || "" : "")); if (!m.입고여부) o.입고여부 = ""; return o; });
  const r = Judge.findExceptions(rows, TODAY, { def: 7, rules: [] });
  const pick = list => list.map(o => o.주문번호 + ":" + o.status);
  return { ex: pick(r.exceptions), need: pick(r.needCheck || []), counts: r.counts };
}

test("골든: 샘플주문.csv와 샘플주문.xlsx는 같은 열·같은 행·같은 판정 결과를 낸다", () => {
  const x = O.readOrders("샘플주문.xlsx", fs.readFileSync(path.join(__dirname, "..", "샘플주문.xlsx")));
  assert.equal(x.ok, true);
  assert.deepEqual(x.columns, CSV.columns);
  assert.deepEqual(x.rows, CSV.rows);
  assert.deepEqual(judge(x), judge(CSV));
  assert.ok(judge(x).ex.length > 0);
});

test("골든: 숫자·날짜를 엑셀 형식으로 저장한 것과 모두 글자로 저장한 것도 같은 결과다", () => {
  const typed = O.readOrders("a.xlsx", F["01-정상.xlsx"]), text = O.readOrders("b.xlsx", F["05-날짜글자.xlsx"]);
  assert.deepEqual(typed.rows, CSV.rows);
  assert.deepEqual(text.rows, CSV.rows);
});

test("변형 ②: 위에 제목 두 줄·합친 칸이 있어도 머리글 줄을 찾고 안내한다", () => {
  const r = O.readOrders("a.xlsx", F["02-제목줄과합친칸.xlsx"]);
  assert.equal(r.ok, true);
  assert.equal(r.headerRow, 4);
  assert.deepEqual(r.columns, CSV.columns);
  assert.deepEqual(r.rows, CSV.rows);
  assert.ok(r.notes.some(n => /건너뛰고 4번째 줄/.test(n)));
});

test("변형 ③: 첫 시트가 표지면 표가 있는 시트를 고른다", () => {
  const r = O.readOrders("a.xlsx", F["03-표지시트먼저.xlsx"]);
  assert.equal(r.sheetName, "주문");
  assert.deepEqual(r.rows, CSV.rows);
  assert.ok(r.notes.some(n => /시트 2개 중 '주문'/.test(n)));
  assert.equal(r.choices, undefined);                                     // 후보는 하나뿐이라 선택 칸이 필요 없다
});

test("변형 ⑥: 주문번호가 숫자 칸이면 글자로 바꿔 쓴다", () => {
  const r = O.readOrders("a.xlsx", F["06-주문번호숫자.xlsx"]);
  assert.equal(r.rows[0].주문번호, "1001");
  assert.equal(typeof r.rows[0].주문번호, "string");
  assert.equal(r.rows.length, CSV.rows.length);
});

test("변형 ⑦: 뒤에 빈 줄이 있어도 행 수가 늘지 않는다", () => {
  assert.equal(O.readOrders("a.xlsx", F["07-뒤에빈줄.xlsx"]).rows.length, CSV.rows.length);
});

test("한도 ⑧: 열이 80개를 넘으면 앞의 80열만 읽고 알린다", () => {
  const r = O.readOrders("a.xlsx", F["08-열90개.xlsx"]);
  assert.equal(r.ok, true);
  assert.equal(r.columns.length, MAX_COLS);
  assert.equal(r.truncated.cols, true);
  assert.ok(r.notes.some(n => /열이 많아 앞의 80열/.test(n)));
});

test("한도 ⑨: 5,001줄이면 앞의 5,000줄만 읽고 '일부만 읽었다'고 알린다. 한도 안이면 알리지 않는다", () => {
  const r = O.readOrders("a.xlsx", F["09-5001줄.xlsx"]);
  assert.equal(r.ok, true);
  assert.equal(r.truncated.rows, true);
  assert.equal(r.rows.length, MAX_ROWS - 1);                              // 머리글 1줄 + 데이터 4,999줄
  assert.ok(r.notes.some(n => /앞의 5000줄까지만/.test(n)));
  const ok = O.readOrders("a.xlsx", F["01-정상.xlsx"]);
  assert.equal(ok.truncated.rows, false); assert.equal(ok.truncated.cols, false);
  assert.ok(!ok.notes.some(n => /까지만/.test(n)));
});

test("공급사 경로: readXlsx 결과의 시트 이름·행은 그대로이고 잘림 표시만 덧붙는다", () => {
  const s = readXlsx(F["01-정상.xlsx"]);
  assert.deepEqual(Object.keys(s[0]).sort(), ["name", "rows", "truncated"]);
  assert.deepEqual(s[0].truncated, { rows: false, cols: false });
});

test("오류 ⑩⑪: 손상된 파일은 이유를 알려 주고, 확장자만 xlsx인 CSV는 CSV로 읽는다", () => {
  const bad = O.readOrders("a.xlsx", F["10-손상.xlsx"]);
  assert.equal(bad.ok, false); assert.ok(bad.error.length > 5);
  const csv = O.readOrders("a.xlsx", F["11-CSV를xlsx로.xlsx"]);
  assert.equal(csv.ok, true);
  assert.deepEqual(csv.rows, CSV.rows);
  assert.ok(csv.notes.some(n => /내용이 CSV/.test(n)));
});

test("오류: 구형 .xls·암호 걸린 파일·빈 파일·엉뚱한 파일·너무 큰 파일은 던지지 않고 이유를 알려 준다", () => {
  assert.match(O.readOrders("a.xls", F["12-구형xls.xls"]).error, /\.xls.*\.xlsx나 CSV/);
  assert.match(O.readOrders("a.xlsx", F["12-구형xls.xls"]).error, /암호/);
  assert.match(O.readOrders("a.xlsx", Buffer.alloc(0)).error, /비어/);
  assert.match(O.readOrders("a.xlsx", Buffer.from([1, 2, 0, 0, 5, 6])).error, /엑셀.*CSV/);
  assert.match(O.readOrders("a.xlsx", Buffer.alloc(O.MAX_FILE + 1)).error, /너무 커요/);
  assert.equal(O.readOrders("a.xlsx", buildXlsx([{ name: "빈", rows: [[]] }])).ok, false);
});

test("열 이름이 다른 파일은 머리글을 못 찾아도 첫 줄을 열 이름으로 읽는다 (열 연결 화면에서 사람이 맞춘다)", () => {
  const r = O.readOrders("a.xlsx", F["14-열이름다름.xlsx"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.columns, ["발주번호", "자재", "거래처", "도착예정", "메모"]);
  assert.equal(guessMapping(r.columns).납기일, "");                        // 납기일 열이 자동으로 안 잡히므로 화면이 연결을 요청한다
  assert.equal(guessMapping(r.columns).주문번호, "발주번호");
});

test("시트 둘 다 표이면 점수가 높은 시트를 읽고 선택할 수 있게 후보를 함께 돌려준다", () => {
  const r = O.readOrders("a.xlsx", F["13-시트둘다표.xlsx"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.choices.map(c => c.sheetName), ["A동", "B동"]);
  assert.deepEqual(r.choices.map(c => c.rows.length), [3, 5]);
});

test("보안: 풀면 한도(40MB)를 넘는 압축 폭탄은 거부하고 앱은 멈추지 않는다", () => {
  const bomb = buildZipBomb();
  assert.ok(bomb.length < 200 * 1024);                                    // 작은 파일
  const r = O.readOrders("a.xlsx", bomb);
  assert.equal(r.ok, false);
  assert.match(r.error, /너무 커요|읽지 못했어요/);
});

test("toTable: 빈 머리글은 '열N', 같은 이름은 번호를 붙이고, 끝의 빈 열은 버린다", () => {
  const t = O.toTable([["주문번호", "", "납기일", "납기일", ""], ["A", "x", "d1", "d2", ""]], 0);
  assert.deepEqual(t.columns, ["주문번호", "열2", "납기일", "납기일(2)"]);
  assert.deepEqual(t.rows, [{ 주문번호: "A", 열2: "x", 납기일: "d1", "납기일(2)": "d2" }]);
});

test("detectHeaderRow: 주문번호·납기일이 둘 다 맞는 줄만 머리글이다. 데이터 줄이나 제목 줄은 아니다", () => {
  assert.equal(O.detectHeaderRow([["제목: 납기 현황 주문번호 목록 전체 보고서입니다 오늘"], ["PO-1", "2026-10-01"], ["PO-2", "2026-10-02"]]), null);
  assert.equal(O.detectHeaderRow([["제목"], ["PO번호", "납기일", "품목"], ["PO-1", "2026-10-01", "x"]]).index, 1);
});
