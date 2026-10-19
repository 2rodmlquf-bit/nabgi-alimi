const test = require("node:test");
const assert = require("node:assert");
const { status } = require("../src/escalate");

const BASE = "2026-10-12";
const att = (date, channel) => ({ date, kind: "attempt", channel });
const keys = s => s.suggestions.map(x => x.key);

test("기록이 없으면 메일로 먼저 문의", () => {
  const s = status([], BASE);
  assert.deepEqual([s.level, s.attempts, keys(s)], [0, 0, ["mail"]]);
  assert.equal(s.headline, "연락 기록 없음");
});

test("무응답이 쌓일수록 단계가 오른다: 재연락 → 전화 → 연구원 알림·상급자 → 대체 검토", () => {
  const l1 = status([att("2026-10-09", "메일")], BASE);
  assert.deepEqual([l1.level, keys(l1)], [1, ["chat"]]);
  assert.ok(l1.suggestions[0].text.includes("카톡·문자") && l1.suggestions[0].text.includes("전화"));   // 아직 안 쓴 채널을 알려 준다
  const l2 = status([att("2026-10-09", "메일"), att("2026-10-10", "카톡·문자")], BASE);
  assert.deepEqual([l2.level, keys(l2)], [2, ["call", "other"]]);
  const l3 = status([att("2026-10-08", "메일"), att("2026-10-09", "카톡·문자"), att("2026-10-10", "전화")], BASE);
  assert.deepEqual([l3.level, keys(l3)], [3, ["headsup", "boss"]]);
  const l4 = status([att("2026-10-07", "메일"), att("2026-10-08", "카톡·문자"), att("2026-10-09", "전화"), att("2026-10-10", "전화")], BASE);
  assert.deepEqual([l4.level, keys(l4)], [4, ["alt", "headsup", "boss"]]);
  assert.equal(status(new Array(9).fill(att("2026-10-09", "메일")), BASE).level, 4);                          // 4단계가 상한
});

test("무응답 횟수·경과일·채널·마지막 연락일", () => {
  const s = status([att("2026-10-08", "메일"), att("2026-10-10", "카톡·문자")], BASE);
  assert.deepEqual([s.attempts, s.daysSilent, s.lastDate, s.channels], [2, 4, "2026-10-10", ["메일", "카톡·문자"]]);
  assert.equal(s.headline, "무응답 2회 · 4일째");
});

test("답변을 받으면 그 뒤부터 다시 센다", () => {
  const s = status([att("2026-10-06", "메일"), att("2026-10-07", "전화"), { date: "2026-10-08", kind: "reply", channel: "전화" }, att("2026-10-11", "메일")], BASE);
  assert.equal(s.attempts, 1);
  assert.equal(s.level, 1);
});

test("구두로 들은 날짜가 지났는데 지연 주문이 남아 있으면 단계가 올라간다", () => {
  const log = [att("2026-10-05", "전화"), { date: "2026-10-06", kind: "reply", channel: "전화", promised: "2026-10-09" }];
  const broken = status(log, BASE, true);
  assert.equal(broken.promiseBroken, true);
  assert.equal(broken.level, 2);                                         // 연락 0회 + 약속 지남 = 전화 재촉
  assert.ok(broken.headline.includes("2026-10-09") && broken.headline.includes("지났는데"));
  assert.equal(status(log, BASE, false).promiseBroken, false);           // 남은 주문이 없으면 어긴 것이 아니다
  assert.equal(status(log, "2026-10-08", true).promiseBroken, false);    // 아직 약속일 전
  assert.equal(status([...log, att("2026-10-10", "메일")], BASE, true).level, 3);   // 약속일이 지난 뒤 다시 연락했는데 응답이 없으면 횟수까지 더해진다
});

test("오늘 이미 연락했는지", () => {
  assert.equal(status([att(BASE, "메일")], BASE).contactedToday, true);
  assert.equal(status([att("2026-10-10", "메일")], BASE).contactedToday, false);
});

test("깨진 이력은 무시한다", () => {
  const s = status([null, {}, { date: "" }, att("2026-10-10", "메일")], BASE);
  assert.equal(s.attempts, 1);
});
