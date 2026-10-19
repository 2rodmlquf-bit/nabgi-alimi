const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { parseDate, isReceived, classify, findExceptions } = require("../src/judge");

const TODAY = "2026-10-12";

test("날짜 형식을 해석한다", () => {
  const iso = parseDate("2026-10-12").getTime();
  assert.equal(parseDate("2026/10/12").getTime(), iso);
  assert.equal(parseDate("2026.10.12").getTime(), iso);
  assert.equal(parseDate("26.10.12").getTime(), iso);
  assert.equal(parseDate("2026-1-5").getTime(), Date.UTC(2026, 0, 5));
});

test("잘못된 날짜는 null", () => {
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("곧 도착"), null);
  assert.equal(parseDate("2026-02-30"), null);
});

test("입고 완료 표기를 알아본다", () => {
  ["Y", "y", "입고", "완료"].forEach(v => assert.equal(isReceived(v), true));
  ["", "N", "대기", undefined].forEach(v => assert.equal(isReceived(v), false));
});

test("경계: 어제 지연, 오늘 임박, 7일 임박, 8일 정상", () => {
  const st = d => classify({ 납기일: d }, TODAY).status;
  assert.equal(st("2026-10-11"), "지연");
  assert.equal(st("2026-10-12"), "임박");
  assert.equal(st("2026-10-19"), "임박");
  assert.equal(st("2026-10-20"), "정상");
});

test("임박 기준 일수를 바꿀 수 있다", () => {
  assert.equal(classify({ 납기일: "2026-10-20" }, TODAY, 3).status, "정상");
  assert.equal(classify({ 납기일: "2026-10-14" }, TODAY, 3).status, "임박");
});

test("입고 완료는 지연이어도 제외, 납기일 오류는 확인필요", () => {
  assert.equal(classify({ 납기일: "2026-10-01", 입고여부: "Y" }, TODAY).status, "입고완료");
  assert.equal(classify({ 납기일: "" }, TODAY).status, "확인필요");
});

test("샘플 CSV에서 예외 목록을 뽑는다", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "샘플주문.csv"), "utf8").replace(/^﻿/, "");
  const lines = text.trim().split(/\r\n/);
  const head = lines[0].split(",");
  const orders = lines.slice(1).map(l => {
    const cells = l.split(",");
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
  const r = findExceptions(orders, TODAY);
  assert.deepEqual(r.counts, { 지연: 7, 임박: 8, 정상: 17, 입고완료: 4, 확인필요: 2, 부분입고: 3 });
  assert.equal(r.exceptions.length, 15);
  assert.equal(r.exceptions[0].daysLeft, -18);                       // 가장 오래 지연된 주문이 맨 위
  assert.ok(r.exceptions.every((o, i, a) => i === 0 || a[i - 1].daysLeft <= o.daysLeft));
  assert.equal(r.needCheck.length, 2);
});
