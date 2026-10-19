const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { classifyCause, CATEGORIES } = require("../src/cause");
const { summarize } = require("../src/analyze");
const { renderNotice, honorific, formatDate } = require("../src/notice");
const { findExceptions } = require("../src/judge");

test("원인 분류: 키워드별", () => {
  assert.equal(classifyCause("통관 서류 보완 중"), "통관·서류");
  assert.equal(classifyCause("원자재 수급 문제로 생산 지연"), "생산·재고");
  assert.equal(classifyCause("항공 운송 중 기상 악화"), "운송·선적");
  assert.equal(classifyCause("수량 변경 요청"), "주문 변경");
  assert.equal(classifyCause("회신 납기 재확인 필요"), "공급사 회신 없음");
});

test("원인 분류: 현업에서 자주 본 원인(단종·대체품, 사양·수량 재확인, 해외 제조사 재고·생산)", () => {
  assert.equal(classifyCause("제조사 단종으로 대체품 확인 필요"), "생산·재고");   // 단종은 생산·재고가 우선
  assert.equal(classifyCause("해외 제조사 재고 부족"), "생산·재고");
  assert.equal(classifyCause("제조사 생산 일정 지연"), "생산·재고");
  assert.equal(classifyCause("백오더 상태"), "생산·재고");
  assert.equal(classifyCause("대체 모델 승인 대기"), "주문 변경");
  assert.equal(classifyCause("사양 재확인 중"), "주문 변경");
  assert.equal(classifyCause("수량 불일치로 확인 중"), "주문 변경");
  assert.equal(classifyCause("도면 확인 요청"), "주문 변경");
  assert.equal(classifyCause("원산지 증명서 서류 미비"), "통관·서류");
  assert.equal(classifyCause("공급사 회신 지연"), "공급사 회신 없음");
});

test("원인 분류: '재확인'만 있으면 회신 없음, 사양·수량 재확인이면 주문 변경 (규칙 순서)", () => {
  assert.equal(classifyCause("납기 재확인 필요"), "공급사 회신 없음");
  assert.equal(classifyCause("사양 재확인 필요"), "주문 변경");
});

test("원인 분류: 위에 있는 항목이 우선, 사유가 없거나 모르면 기타·미확인", () => {
  assert.equal(classifyCause("통관 지연으로 선적이 늦어짐"), "통관·서류");
  assert.equal(classifyCause(""), "기타·미확인");
  assert.equal(classifyCause(undefined), "기타·미확인");
  assert.equal(classifyCause("공급사 회신 후 한 차례 연기"), "기타·미확인");
  assert.ok(CATEGORIES.includes(classifyCause("아무 말")));
});

function sampleDelayed() {
  const text = fs.readFileSync(path.join(__dirname, "..", "샘플주문.csv"), "utf8").replace(/^﻿/, "");
  const lines = text.trim().split(/\r\n/);
  const head = lines[0].split(",");
  const orders = lines.slice(1).map(l => { const c = l.split(","); return Object.fromEntries(head.map((h, i) => [h, c[i]])); });
  return findExceptions(orders, "2026-10-12").exceptions.filter(o => o.status === "지연");
}

test("집계: 샘플 지연 7건", () => {
  const s = summarize(sampleDelayed(), o => classifyCause(o["비고"]));
  assert.equal(s.total, 7);
  assert.equal(s.avgDays, 7.4);               // (18+12+9+6+4+2+1)/7
  assert.equal(s.maxDays, 18);
  assert.deepEqual(s.byCause.map(c => [c.name, c.count]), [["기타·미확인", 5], ["통관·서류", 2]]);
  assert.deepEqual([s.bySupplier[0].name, s.bySupplier[0].count, s.bySupplier[0].avg, s.bySupplier[0].max], ["가온산업", 2, 9.5, 18]);
  assert.deepEqual([s.byRequester[0].name, s.byRequester[0].count], ["연구1팀 A연구원", 2]);
});

test("집계: 지연이 없으면 0", () => {
  const s = summarize([], () => "x");
  assert.deepEqual([s.total, s.avgDays, s.maxDays, s.byCause.length], [0, 0, 0, 0]);
});

const base = { researcher: "김연구", item: "산업용 베어링", orderNo: "PO-1", oldDue: "2026-09-24", newDue: "", daysLate: 18, reason: "", alternative: "" };

test("안내문: 새 납기가 없으면 날짜를 지어내지 않고 확인 후 안내한다고 쓴다", () => {
  const t = renderNotice("사과형", base);
  assert.ok(t.includes("기존 납기일은 9월 24일(목)입니다."));
  assert.ok(t.includes("현재 18일이 지났으나 아직 입고되지 않았습니다"));
  assert.ok(t.includes("확인되는 대로 다시 안내드리겠습니다"));
  assert.ok(!t.includes("사유는"));
  assert.ok(t.includes("죄송합니다"));
});

test("안내문: 새 납기와 사유가 있으면 기존·변경 날짜와 사유가 들어가고 확인 문장은 빠진다", () => {
  const t = renderNotice("사과형", { ...base, newDue: "2026-10-23", reason: "통관 서류 보완." });
  assert.ok(t.includes("- 기존: 9월 24일(목)"));
  assert.ok(t.includes("- 변경: 10월 23일(금)"));
  assert.ok(t.includes("사유는 통관 서류 보완입니다."));      // 끝의 마침표는 정리된다
  assert.ok(!t.includes("확인되는 대로"));
});

test("안내문: 연도가 다르면 연도를 붙인다", () => {
  const t = renderNotice("사과형", { ...base, oldDue: "2026-12-28", newDue: "2027-01-05" });
  assert.ok(t.includes("2026년 12월 28일") && t.includes("2027년 1월 5일"));
});

test("안내문: 호칭은 'OO 연구원님'으로 맞춘다", () => {
  assert.equal(honorific("김연구"), "김연구 연구원님");
  assert.equal(honorific("연구1팀 A연구원"), "연구1팀 A연구원님");
  assert.equal(honorific("박 박사"), "박 박사님");
  assert.equal(honorific("이철수님"), "이철수님");
  assert.equal(honorific(""), "담당자님");
  assert.ok(renderNotice("공지형", base).startsWith("안녕하세요, 김연구 연구원님."));
});

test("안내문: 서명은 있을 때만 맨 끝에 붙는다", () => {
  assert.ok(renderNotice("사과형", { ...base, signature: "구매팀 홍길동 드림" }).endsWith("\n\n구매팀 홍길동 드림"));
  assert.ok(!renderNotice("사과형", base).includes("드림"));
});

test("안내문: 공지형은 사과 문장이 없고 감사로 끝난다", () => {
  const t = renderNotice("공지형", base);
  assert.ok(!t.includes("죄송"));
  assert.ok(t.endsWith("감사합니다."));
});

test("안내문: 대안 제시형은 입력한 대안만 넣고, 비어 있으면 대안 문단을 뺀다", () => {
  assert.ok(renderNotice("대안 제시형", { ...base, alternative: "대체품 문의 가능합니다." }).includes("대체품 문의 가능합니다."));
  assert.ok(!renderNotice("대안 제시형", base).includes("제안드립니다"));
});

test("날짜 표기: 해석할 수 없는 값은 그대로 쓴다", () => {
  assert.equal(formatDate("곧 도착"), "곧 도착");
  assert.equal(formatDate("2026-10-23"), "10월 23일(금)");
});

test("한 통 안내문: 지연·임박을 나눠 담고 없는 사유는 줄을 뺀다", () => {
  const N = require("../src/notice");
  const t = N.renderDigest("연구1팀 A연구원", [
    { orderNo: "PO-1", item: "베어링", status: "지연", daysLeft: -18, due: "2026-09-24", reason: "공급사 회신 후 연기.", partial: { received: 4, ordered: 10, remaining: 6 } },
    { orderNo: "PO-2", item: "장갑", status: "임박", daysLeft: 2, due: "2026-10-14", reason: "" },
  ], "구매팀 홍길동");
  assert.match(t, /연구1팀 A연구원님/);
  assert.match(t, /■ 납기 지연 1건[\s\S]*18일 지남[\s\S]*입고: 4\/10 \(잔량 6\)[\s\S]*사유: 공급사 회신 후 연기/);
  assert.match(t, /■ 납기 임박 1건[\s\S]*2일 남음/);
  assert.equal((t.match(/사유:/g) || []).length, 1);
  assert.ok(t.endsWith("구매팀 홍길동"));
  assert.ok(!/■ 납기 임박/.test(N.renderDigest("A", [{ orderNo: "X", status: "지연", daysLeft: -1, due: "2026-10-11" }], "")));
});

test("임박 사전 안내: 남은 일수만 알리고 새 납기·입고 시점은 지어내지 않는다", () => {
  const N = require("../src/notice");
  const v = { researcher: "B연구원", item: "소형 진공 펌프", orderNo: "PO-9", due: "2026-10-13", daysLeft: 1, oldDue: "2026-10-13", signature: "", partial: { received: 6, ordered: 10, remaining: 4 } };
  const t = N.renderNotice("임박 사전 안내", v);
  assert.match(t, /미리 안내/);
  assert.match(t, /10월 13일\(화\)이며, 1일 남았습니다/);
  assert.match(t, /6\/10/);
  assert.ok(!/죄송/.test(t));
  assert.match(N.renderNotice("임박 사전 안내", { ...v, daysLeft: 0 }), /납기일이 오늘, 10월 13일.화.입니다/);
  // 이미 지난 주문에 이 템플릿이 걸려 있으면 사과형으로 돌아간다
  assert.match(N.renderNotice("임박 사전 안내", { ...v, daysLeft: -3, daysLate: 3 }), /죄송/);
});
