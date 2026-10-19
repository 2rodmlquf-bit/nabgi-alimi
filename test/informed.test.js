const test = require("node:test");
const assert = require("node:assert");
const I = require("../src/informed");
const { clean, mergeState } = require("../src/persist");

const late = { status: "지연", due: "2026-10-05" };
const soon = { status: "임박", due: "2026-10-14" };

test("기록이 없으면 미안내", () => {
  assert.equal(I.stateOf(late, [], "2026-10-12").state, "미안내");
  assert.equal(I.stateOf(late, undefined, "2026-10-12").state, "미안내");
});

test("안내한 뒤 바뀐 게 없으면 안내완료", () => {
  const e = [{ date: "2026-10-10", channel: "메일", status: "지연", due: "2026-10-05", note: "" }];
  const st = I.stateOf(late, e, "2026-10-12");
  assert.equal(st.state, "안내완료");
  assert.equal(st.ago, 2);
});

test("납기가 바뀌면 재안내필요 (표기가 달라도 같은 날짜면 바뀐 게 아니다)", () => {
  const e = [{ date: "2026-10-10", channel: "메일", status: "지연", due: "2026-10-05", note: "" }];
  assert.equal(I.stateOf({ status: "지연", due: "2026-10-20" }, e, "2026-10-12").state, "재안내필요");
  assert.equal(I.stateOf({ status: "지연", due: "2026.10.05" }, e, "2026-10-12").state, "안내완료");
});

test("임박으로 안내했는데 지연이 되면 재안내필요", () => {
  const e = [{ date: "2026-10-08", channel: "메일", status: "임박", due: "2026-10-10", note: "" }];
  const st = I.stateOf({ status: "지연", due: "2026-10-10" }, e, "2026-10-12");
  assert.equal(st.state, "재안내필요");
  assert.match(st.reason, /임박/);
});

test("지연 중인데 7일 넘게 소식이 없으면 재안내필요, 임박은 해당 없음", () => {
  const e = [{ date: "2026-10-01", channel: "전화", status: "지연", due: "2026-10-05", note: "" }];
  assert.equal(I.stateOf(late, e, "2026-10-07").state, "안내완료");   // 6일
  assert.equal(I.stateOf(late, e, "2026-10-08").state, "재안내필요"); // 7일
  const e2 = [{ date: "2026-10-01", channel: "전화", status: "임박", due: "2026-10-14", note: "" }];
  assert.equal(I.stateOf(soon, e2, "2026-10-12").state, "안내완료");
});

test("기록 만들기·중복 방지·되돌리기", () => {
  const log = {};
  const e = I.makeEntry({ status: "지연", due: "2026-10-05" }, "2026-10-12", "전화", "구두로 설명");
  assert.equal(I.append(log, "A", e), true);
  assert.equal(I.append(log, "A", { ...e }), false);                         // 같은 날 같은 채널 중복
  assert.equal(I.append(log, "A", { ...e, channel: "메일" }), true);          // 채널이 다르면 별도 기록
  assert.equal(log.A.length, 2);
  assert.equal(I.undo(log, "A"), true);
  assert.equal(I.undo(log, "A"), true);
  assert.equal(log.A, undefined);                                            // 다 지우면 키도 사라진다
  assert.equal(I.undo(log, "A"), false);
  assert.equal(I.makeEntry({ status: "임박", due: "x" }, "2026-10-12", "이상한채널").channel, "기타");
});

test("요약: 미안내·재안내·선제 안내를 센다", () => {
  const ent = (status, date, due) => [{ date, channel: "메일", status, due, note: "" }];
  const items = [
    { order: { status: "지연", due: "2026-10-05" }, entries: [] },                                          // 지연·미안내
    { order: { status: "지연", due: "2026-10-05" }, entries: ent("임박", "2026-10-02", "2026-10-05") },     // 지연이지만 미리 안내함 → 임박 안내 뒤 지연이라 재안내 필요
    { order: { status: "지연", due: "2026-10-07" }, entries: ent("지연", "2026-10-10", "2026-10-07") },     // 사후 안내 완료
    { order: { status: "임박", due: "2026-10-14" }, entries: [] },                                          // 임박·미안내
    { order: { status: "임박", due: "2026-10-15" }, entries: ent("임박", "2026-10-11", "2026-10-15") },     // 임박·안내완료
  ];
  const s = I.summary(items, "2026-10-12");
  assert.equal(s.total, 5);
  assert.equal(s.지연, 3); assert.equal(s.임박, 2);
  assert.equal(s.미안내, 2); assert.equal(s.재안내필요, 1); assert.equal(s.안내완료, 2);
  assert.equal(s.lateNone, 1);
  assert.equal(s.preempt, 1);
  assert.equal(s.needAction, 3);
});

test("저장본: 안내 기록은 깨진 값을 걸러 읽고, 현재 목록 주문만 현재 상태로 합친다", () => {
  const c = clean({ informed: {
    A: [{ date: "2026-10-10", channel: "전화", status: "지연", due: "2026-10-05", note: "x" }, { date: "bad", status: "지연" }, { date: "2026-10-11", status: "엉뚱" }],
    B: "x", C: [{ date: "2026-10-10", channel: "비둘기", status: "임박" }],
  } });
  assert.equal(c.informed.A.length, 1);
  assert.equal(c.informed.B, undefined);
  assert.equal(c.informed.C[0].channel, "기타");
  assert.deepEqual(clean({ informed: [1] }).informed, {});

  const saved = { informed: { OLD: [{ date: "2026-10-01", channel: "메일", status: "지연", due: "d", note: "" }], A: [{ date: "2026-10-01", channel: "메일", status: "지연", due: "d", note: "" }] } };
  const m = mergeState(saved, { informed: {} }, ["A"]);   // A의 기록을 모두 지웠다
  assert.equal(m.informed.A, undefined);
  assert.equal(m.informed.OLD.length, 1);                  // 다른 목록의 기록은 남는다
});

// ---- FR-18 다시 안내 기준 일수 ----
test("기준 일수 입력 검사: 1~30의 정수만 받고, 아닌 것은 이유와 함께 거부한다 (글자 숫자는 받는다)", () => {
  assert.equal(I.MIN_STALE_DAYS, 1); assert.equal(I.MAX_STALE_DAYS, 30); assert.equal(I.STALE_DAYS, 7);
  [["1", 1], ["7", 7], [" 30 ", 30], [3, 3], ["03", 3]].forEach(([v, d]) => assert.deepEqual(I.parseDays(v), { ok: true, days: d }, String(v)));
  [["0", /1~30/], ["31", /1~30/], [-3, /1~30/], ["", /입력/], [null, /입력/], ["abc", /숫자/], ["7.5", /정수|숫자/], [NaN, /숫자/], [Infinity, /숫자/]].forEach(([v, re]) => {
    const r = I.parseDays(v);
    assert.equal(r.ok, false, String(v)); assert.match(r.reason, re, String(v));
  });
});

test("저장된 값 정리: 1~30의 정수가 아니면 기본값(null)으로 본다", () => {
  assert.equal(I.cleanDays(5), 5);
  [0, 31, "7", 7.5, NaN, null, undefined, {}].forEach(v => assert.equal(I.cleanDays(v), null, String(v)));
});

test("다시 안내 경계: 마지막 안내 뒤 N일이 되는 날부터 재안내필요, N-1일은 아직 안내완료 (N=1, 7, 30)", () => {
  const base = "2026-10-31";
  const iso = ago => { const d = new Date(Date.UTC(2026, 9, 31) - ago * 86400000); return d.toISOString().slice(0, 10); };
  [1, 7, 30].forEach(N => {
    const at = ago => [{ date: iso(ago), channel: "메일", status: "지연", due: late.due, note: "" }];
    const on = I.stateOf(late, at(N), base, N), before = I.stateOf(late, at(N - 1), base, N);
    assert.equal(on.state, "재안내필요", "N=" + N); assert.match(on.reason, new RegExp(N + "일째"));
    assert.equal(before.state, "안내완료", "N=" + N + " 하루 전");
  });
});

test("기준 일수를 안 넘기면 7일이고, 넘기면 현황 집계도 그 기준으로 바뀐다", () => {
  const e = [{ date: "2026-10-09", channel: "메일", status: "지연", due: late.due, note: "" }];   // 3일 전 안내
  assert.equal(I.stateOf(late, e, "2026-10-12").state, "안내완료");
  assert.equal(I.stateOf(late, e, "2026-10-12", 3).state, "재안내필요");
  assert.equal(I.summary([{ order: late, entries: e }], "2026-10-12").재안내필요, 0);
  assert.equal(I.summary([{ order: late, entries: e }], "2026-10-12", 3).재안내필요, 1);
  assert.equal(I.stateOf(soon, [{ date: "2026-10-01", channel: "메일", status: "임박", due: soon.due, note: "" }], "2026-10-12", 1).state, "안내완료");   // 임박은 일수로 다시 안내하지 않는다
});
