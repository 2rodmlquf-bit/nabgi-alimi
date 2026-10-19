const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const R = require("../src/report");
const { findExceptions } = require("../src/judge");
const { summarize } = require("../src/analyze");
const { plan } = require("../src/contact");
const { classifyCause } = require("../src/cause");
const { csvToObjects, parseCsv } = require("../src/csv");

const rows = csvToObjects(fs.readFileSync(path.join(__dirname, "..", "샘플주문.csv"), "utf8")).rows;
const res = findExceptions(rows, "2026-10-12");
const causeOf = o => classifyCause(o["비고"]);
const groups = plan({ exceptions: res.exceptions, needCheck: res.needCheck, causeOf });
const delay = summarize(res.exceptions.filter(o => o.status === "지연"), causeOf);

test("CSV 칸: 수식으로 실행될 수 있는 글자는 막고, 숫자는 그대로 둔다", () => {
  assert.equal(R.csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(R.csvCell("+1+2"), "'+1+2");
  assert.equal(R.csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(R.csvCell("-cmd"), "'-cmd");
  assert.equal(R.csvCell(-18), "-18");                 // 숫자 칸은 앞에 ' 를 붙이지 않는다
  assert.equal(R.csvCell("가,나"), '"가,나"');
  assert.equal(R.csvCell(null), "");
});

test("CSV: BOM으로 시작하고 줄바꿈은 CRLF, 다시 읽으면 같은 값", () => {
  const csv = R.toCsv(["a", "b"], [["가,나", 1], ['"인용"', "줄\n바꿈"]]);
  assert.ok(csv.startsWith("﻿"));
  const back = parseCsv(csv);
  assert.deepEqual(back, [["a", "b"], ["가,나", "1"], ['"인용"', "줄\n바꿈"]]);
});

test("저장 이름: 경로 문자를 없애고 csv/txt만 허용", () => {
  assert.equal(R.safeFileName("../../evil:name", "csv"), "_.._evil_name.csv");   // 경로 문자(/ \\ :)는 _로 바뀌고 앞의 점은 사라진다
  assert.ok(!/[\\/:*?"<>|]/.test(R.safeFileName("a/b\\c:d", "csv")));
  assert.equal(R.safeFileName("납기보고", "exe"), "납기보고.txt");     // 허용되지 않은 확장자는 txt로
  assert.equal(R.safeFileName("", "csv"), "납기보고.csv");
  assert.equal(R.safeFileName("보고.csv", "csv"), "보고.csv");          // 확장자 중복 방지
});

test("보고 문구: 샘플 숫자가 그대로 들어간다", () => {
  const t = R.buildReport({ base: "2026-10-12", fileName: "샘플주문.csv", total: 38, counts: res.counts, delay, groups, contacted: 0, editedCount: 1 });
  assert.ok(t.startsWith("납기 현황 보고 (기준일 2026-10-12)"));
  assert.ok(t.includes("- 납기 지연 7건 (평균 7.4일, 최장 18일)"));
  assert.ok(t.includes("- 납기 임박 8건"));
  assert.ok(t.includes("- 납기일 확인 필요 2건"));
  assert.ok(t.includes("- 기타·미확인 5건 (71%)"));
  assert.ok(t.includes("※ 기타·미확인 비중이 높아 원인 파악이 더 필요합니다."));
  assert.ok(t.includes("- 가온산업 2건 (평균 9.5일, 최장 18일)"));
  assert.ok(t.includes("납기를 변경 반영한 주문 1건"));
  assert.ok(t.includes("공급사 연락: 완료 0곳 / 남음 6곳"));
  assert.ok(t.includes("1. 가온산업 (지연 2, 임박 1, 확인 필요 1)"));
});

test("보고 문구: 지연이 없으면 원인·공급사 구간을 빼고, 연락 완료를 반영한다", () => {
  const t = R.buildReport({ base: "2026-10-12", fileName: "", total: 3, counts: { 지연: 0, 임박: 1, 정상: 2, 입고완료: 0, 확인필요: 0 }, delay: summarize([], causeOf), groups: [], contacted: 0, editedCount: 0 });
  assert.ok(!t.includes("■ 지연 원인"));
  assert.ok(!t.includes("■ 우선 연락할 업체"));
  assert.ok(t.includes("파일: (파일 없음)"));
  const t2 = R.buildReport({ base: "x", total: 1, counts: res.counts, delay, groups, contacted: 2, editedCount: 0 });
  assert.ok(t2.includes("완료 2곳 / 남음 4곳"));
});

test("예외 목록 CSV: 지연·임박·확인 필요가 모두 들어가고, 지연에만 원인이 붙는다", () => {
  const out = R.exceptionRows(res.exceptions, res.needCheck, causeOf, o => o["비고"] || "", { 가온산업: "2026-10-12" });
  assert.equal(out.length, 17);                                             // 7 + 8 + 2
  const first = out[0];
  assert.deepEqual(first.slice(0, 3), ["지연", -18, "PO-2026-1001"]);       // 남은일수는 숫자(음수=지연)
  assert.equal(first[9], "2026-10-12");                                    // 가온산업은 연락함
  assert.equal(out.find(r => r[2] === "PO-2026-1008")[7], "");              // 임박에는 원인이 없다
  assert.equal(out.filter(r => r[0] === "확인 필요").length, 2);
  const csv = R.toCsv(R.EXC_HEAD, out);
  assert.equal(parseCsv(csv).length, 18);                                   // 머리글 + 17건
});

test("연락할 곳 CSV: 순위·경과일 부호·회신 내용", () => {
  const out = R.contactRows(plan({ exceptions: res.exceptions, needCheck: res.needCheck, noReply: [{ orderNo: "PO-2026-1001", supplier: "가온산업", item: "", from: "2026-09-24", reply: "확인 후 회신" }], causeOf }), {});
  assert.equal(out[0][0], 1);
  assert.equal(out[0][1], "가온산업");
  const late = out.find(r => r[3] === "PO-2026-1001");
  assert.deepEqual([late[2], late[6], late[8]], ["지연", 18, "확인 후 회신"]);
  assert.equal(out.find(r => r[3] === "PO-2026-1013")[6], -5);               // 임박 5일 남음 = -5
});
