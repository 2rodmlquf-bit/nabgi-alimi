process.env.TZ = "Asia/Seoul";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { readXlsx } = require("../src/xlsx");
const S = require("../src/supplier");
const { renderReask } = require("../src/reask");
const { csvToObjects } = require("../src/csv");
const { buildXlsx, buildSupplierFiles } = require("../make-sample-supplier");

const BASE = "2026-10-12";
const files = Object.fromEntries(buildSupplierFiles());
const list = csvToObjects(fs.readFileSync(path.join(__dirname, "..", "샘플주문.csv"), "utf8")).rows;
const COLS = { id: "주문번호", due: "납기일", supplier: "공급사", item: "품목명", qty: "주문수량", spec: "규격" };

function analyze(buf) {
  const sheets = readXlsx(buf);
  let best = null;
  sheets.forEach(sh => { const h = S.findHeader(sh.rows); if (h && (!best || h.score > best.h.score)) best = { sh, h }; });
  const { entries, skipped } = S.buildEntries(best.sh.rows, best.h.index, best.h.columns);
  return { sheets, ...best, entries, skipped, result: S.compare(list, COLS, entries, BASE) };
}

test("xlsx 읽기: 시트 이름·순서, 인라인/공유 문자열, 숫자, 날짜 번호", () => {
  const a = readXlsx(buildXlsx([{ name: "A", rows: [["가", 12.5, { date: "2026-10-23" }]] }, { name: "B", rows: [["나"]] }], false));
  assert.deepEqual(a.map(s => s.name), ["A", "B"]);
  assert.deepEqual(a[0].rows[0], ["가", "12.5", "2026-10-23"]);
  const b = readXlsx(buildXlsx([{ name: "A", rows: [["가", "가", "나"]] }], true));   // 공유 문자열
  assert.deepEqual(b[0].rows[0], ["가", "가", "나"]);
});

test("xlsx 읽기: 합친 칸은 왼쪽 위 값으로 채우고, 형식이 아니면 오류", () => {
  const a = readXlsx(buildXlsx([{ name: "A", merges: ["A1:A3"], rows: [["공급사", "x"], [null, "y"], [null, "z"]] }]));
  assert.deepEqual(a[0].rows.map(r => r[0]), ["공급사", "공급사", "공급사"]);
  assert.throws(() => readXlsx(Buffer.from("이건 엑셀이 아닙니다 ".repeat(10))), /엑셀/);
});

test("머리글 줄 찾기: 제목이 밀려도, 열 이름이 달라도 찾는다", () => {
  const g = readXlsx(files["가온산업_납기회신.xlsx"])[0];
  const h = S.findHeader(g.rows);
  assert.equal(h.index, 3);                                                        // 4번째 줄
  assert.deepEqual([h.columns.주문번호, h.columns.품목명, h.columns.규격, h.columns.수량, h.columns.납기일, h.columns.비고], [1, 2, 3, 4, 5, 6]);
  const n = readXlsx(files["나래테크_회신.xlsx"]);
  assert.equal(S.findHeader(n[0].rows), null);                                     // 안내 시트에는 표가 없다
  const h2 = S.findHeader(n[1].rows);
  assert.equal(h2.index, 1);
  assert.deepEqual([h2.columns.공급사, h2.columns.주문번호, h2.columns.수량, h2.columns.납기일], [0, 1, 3, 4]);   // 발주번호, 수량, ETA
});

test("납기 칸 분류: 날짜 / 빈칸 / 말만 / 애매함", () => {
  const k = s => S.classifyDue(s, BASE);
  assert.deepEqual([k("2026-10-23").kind, k("2026-10-23").date], ["date", "2026-10-23"]);
  assert.deepEqual([k("2026.10.12").date, k("20261030").date, k("10/14").date, k("10월 23일").date], ["2026-10-12", "2026-10-30", "2026-10-14", "2026-10-23"]);
  assert.equal(k("").kind, "blank");
  assert.equal(k("-").kind, "blank");
  assert.equal(k("TBD").kind, "blank");
  assert.equal(k("확인 후 회신").kind, "unclear");
  assert.equal(k("추후 안내").kind, "unclear");
  assert.equal(k("11월 초").kind, "vague");
  assert.equal(k("다음 주쯤").kind, "vague");
  assert.equal(k("10/20~10/23").kind, "vague");
});

test("가온산업 파일: 변경·미회신·동일·목록에 없음, 합계 줄은 건너뜀", () => {
  const r = analyze(files["가온산업_납기회신.xlsx"]);
  assert.deepEqual(r.result.changed.map(x => [x.orderNo, x.from, x.to]), [["PO-2026-1001", "2026-09-24", "2026-10-23"]]);
  assert.deepEqual(r.result.noReply.map(x => x.orderNo).sort(), ["PO-2026-1003", "PO-2026-1007"]);
  assert.equal(r.result.noReply.find(x => x.orderNo === "PO-2026-1003").reply, "확인 후 회신");   // 공급사가 적은 말을 남긴다
  assert.deepEqual(r.result.same.map(x => x.orderNo), ["PO-2026-1010"]);
  assert.deepEqual(r.result.notInList.map(x => x.orderNo), ["PO-2026-9999"]);
  assert.equal(r.skipped.length, 1);                                                // "합계" 줄
});

test("나래테크 파일: 두 번째 시트, 합친 공급사 칸, 제각각인 날짜, 같은 주문 두 줄", () => {
  const r = analyze(files["나래테크_회신.xlsx"]);
  assert.equal(r.sh.name, "납기표");
  assert.deepEqual(r.result.changed.map(x => [x.orderNo, x.to]).sort(), [["PO-2026-1004", "2026-10-30"], ["PO-2026-1006", "2026-10-12"]]);
  assert.deepEqual(r.result.vague.map(x => x.orderNo).sort(), ["PO-2026-1002", "PO-2026-1005"]);   // "11월 초", "다음 주쯤"
  assert.deepEqual(r.result.noReply.map(x => x.orderNo), ["PO-2026-1009"]);                        // "-"
  assert.equal(r.result.multi.length, 1);                                                          // 1008: 분납 두 줄(날짜가 다름)
  assert.deepEqual(r.result.multi[0].dates, ["2026-10-15", "2026-10-20"]);
  assert.ok(r.entries.every(e => e.supplier === "나래테크"));                                      // 세로로 합친 칸이 모든 줄에 채워짐
});

test("재문의 문구: 공급사별 한 통, 공급사가 적은 말과 현재 납기를 함께 적는다", () => {
  const t = renderReask("가온산업", [
    { orderNo: "PO-2026-1007", item: "실험용 니트릴 장갑", from: "26.10.11" },
    { orderNo: "PO-2026-1003", item: "인버터 부품 세트", from: "2026-10-03", reply: "확인 후 회신" },
  ], "구매팀 홍길동 드림");
  assert.ok(t.startsWith("안녕하세요, 가온산업 담당자님."));
  assert.ok(t.includes("- PO-2026-1007 실험용 니트릴 장갑 (현재 납기 10월 11일(일))"));
  assert.ok(t.includes("회신 내용: 확인 후 회신"));
  assert.ok(t.endsWith("구매팀 홍길동 드림"));
  assert.ok(renderReask("", [{ orderNo: "A", from: "" }]).includes("납기 미확인"));
});

test("대체품 의심: 규격·품명이 목록과 다르거나, 회신에 '대체·동급' 같은 말이 있으면 날짜와 별개로 알린다", () => {
  const g = analyze(files["가온산업_납기회신.xlsx"]).result.subst;
  assert.deepEqual(g.map(x => x.orderNo).sort(), ["PO-2026-1001", "PO-2026-1010"]);
  const a = g.find(x => x.orderNo === "PO-2026-1001");
  assert.deepEqual([a.listSpec, a.supSpec, a.reasons], ["6204ZZ", "6204-2RS", ["규격이 달라요"]]);
  assert.ok(g.find(x => x.orderNo === "PO-2026-1010").reasons[0].includes("'동급'"));          // 날짜가 같아도(동일) 대체품 말이 있으면 표시
  const n = analyze(files["나래테크_회신.xlsx"]).result.subst;
  assert.deepEqual(n.map(x => [x.orderNo, x.reasons[0]]), [["PO-2026-1004", "품목명이 달라요"]]);
  assert.equal(n[0].listItem, "에어 필터 카트리지");
  assert.equal(n[0].supItem, "에어 필터 (FA-130)");
});

test("대체품 판정이 너무 민감하지 않다: 같은 품목을 조금 다르게 적은 것은 의심하지 않는다", () => {
  assert.equal(S.differs("산업용 베어링 6204", "베어링 6204"), false);       // 한쪽이 다른 쪽을 포함
  assert.equal(S.differs("6204ZZ", "6204 ZZ"), false);                        // 공백 차이
  assert.equal(S.differs("PT100 3선식", "pt100 3선식"), false);               // 대소문자
  assert.equal(S.differs("", "6204ZZ"), false);                               // 한쪽이 비어 있으면 비교하지 않는다
  assert.equal(S.differs("6204ZZ", "6204-2RS"), true);
  assert.equal(S.differs("에어 필터 카트리지", "에어 필터 (FA-130)"), true);
  ["동급으로 대체 발송", "호환 모델로 변경", "단종되어 후속 모델", "다른 모델"].forEach(t => assert.ok(S.SUBST_WORDS.test(t), t));
  assert.ok(!S.SUBST_WORDS.test("통관 서류 보완 중"));
});

test("분납 일정: 같은 주문이 여러 줄이면 날짜순 일정으로 묶고, 수량 합계가 주문수량과 맞는지 알린다", () => {
  const m = analyze(files["나래테크_회신.xlsx"]).result.multi[0];
  assert.equal(m.orderNo, "PO-2026-1008");
  assert.deepEqual(m.schedule.map(x => [x.date, x.qty]), [["2026-10-15", "6"], ["2026-10-20", "4"]]);
  assert.deepEqual([m.qtySum, m.listQty, m.qtyMatch], [10, 10, true]);
  // 합계가 맞지 않으면 알린다 (6 + 3 = 9 ≠ 10)
  const entries = [{ line: 2, orderNo: "PO-2026-1008", supplier: "", item: "", dueRaw: "2026-10-15", note: "", qty: "6", spec: "" }, { line: 3, orderNo: "PO-2026-1008", supplier: "", item: "", dueRaw: "2026-10-20", note: "", qty: "3", spec: "" }];
  const r = S.compare(list, COLS, entries, BASE).multi[0];
  assert.deepEqual([r.qtySum, r.qtyMatch], [9, false]);
});
