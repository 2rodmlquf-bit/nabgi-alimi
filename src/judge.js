// 납기 판정 규칙 (기획문서 5장). 화면·파일·Claude와 무관한 순수 함수만 둔다.
// 주문 객체는 표준 열 이름을 쓴다: 주문번호, 납기일, 입고여부 (나머지는 그대로 전달).

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_WORDS = ["y", "yes", "o", "true", "1", "입고", "입고완료", "완료", "예", "검수완료"];

// 날짜 문자열 → UTC 자정 Date. 해석할 수 없으면 null. (가정: 연-월-일 순서, 구분자는 - / . 중 하나)
function parseDate(value) {
  if (value instanceof Date) return isNaN(value) ? null : new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const s = String(value == null ? "" : value).trim();
  const m = s.match(/^(\d{2}|\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})\.?$/);
  if (!m) return null;
  let y = +m[1];
  if (m[1].length === 2) y += 2000;
  const mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

function isReceived(value) {
  return DONE_WORDS.includes(String(value == null ? "" : value).trim().toLowerCase());
}

function toNum(v) {
  const s = String(v == null ? "" : v).replace(/[,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null;
}

// 주문수량과 입고수량이 둘 다 숫자일 때만 수량을 비교한다. 그 밖에는 null (수량 정보 없음).
function quantities(order) {
  const ordered = toNum(order["주문수량"]), received = toNum(order["입고수량"]);
  if (ordered == null || received == null || ordered <= 0) return null;
  return { ordered, received, remaining: Math.max(0, ordered - received), done: received >= ordered };
}

// 품목별 임박 기준. 한 줄에 하나, "키워드=일수" (예: 필터=3). 품목명에 키워드가 들어 있으면 그 일수를 쓴다.
function parseRules(text) {
  const rules = [];
  String(text == null ? "" : text).split(/\r?\n/).forEach(line => {
    const m = line.trim().match(/^(.+?)\s*[=:]\s*(\d{1,3})\s*일?$/);
    if (m && +m[2] >= 1) rules.push({ keyword: m[1].trim(), days: +m[2] });
  });
  return rules;
}

// soonDays는 숫자(모든 품목 같은 기준) 또는 { def, rules }(품목별 기준). 먼저 맞는 규칙을 쓰고, 없으면 기본값.
function limitFor(order, soonDays) {
  if (typeof soonDays === "number" || !soonDays) return { days: soonDays || 7, keyword: null };
  const name = String(order["품목명"] == null ? "" : order["품목명"]);
  const hit = (soonDays.rules || []).find(r => r.keyword && name.includes(r.keyword));
  return hit ? { days: hit.days, keyword: hit.keyword } : { days: soonDays.def || 7, keyword: null };
}

// 한 주문을 판정한다. status: 지연 | 임박 | 정상 | 입고완료 | 확인필요
// 부분 입고(일부만 들어옴)는 입고 완료로 빼지 않고 **남은 수량**을 기준으로 계속 본다. 잔량 납기 열이 있으면 그 날짜로 판정한다.
function classify(order, today, soonDays = 7) {
  const base = parseDate(today);
  if (!base) throw new Error("기준일을 해석할 수 없습니다: " + today);
  const q = quantities(order);
  if (q && q.done) return { status: "입고완료", daysLeft: null, reason: "입고수량이 주문수량 이상이라 입고 완료" };
  if (isReceived(order["입고여부"]) && !q) return { status: "입고완료", daysLeft: null, reason: "입고 완료된 주문은 목록에서 제외" };
  const isPartial = !!q && q.received > 0;                                    // 일부만 들어옴 (입고여부가 Y여도 수량이 모자라면 부분 입고)
  const remainDue = isPartial ? parseDate(order["잔량납기"]) : null;
  const due = remainDue || parseDate(order["납기일"]);
  const partial = isPartial ? { ordered: q.ordered, received: q.received, remaining: q.remaining, remainDue: remainDue ? remainDue.toISOString().slice(0, 10) : "" } : null;
  const tag = partial ? " · 부분 입고 " + q.received + "/" + q.ordered + " (잔량 " + q.remaining + (remainDue ? ", 잔량 납기 기준" : "") + ")" : "";
  if (!due) return { status: "확인필요", daysLeft: null, partial, reason: "납기일이 비었거나 형식을 해석할 수 없음: " + (order["납기일"] || "(빈 값)") + tag };
  const lim = limitFor(order, soonDays);
  const daysLeft = Math.round((due - base) / DAY_MS);
  if (daysLeft < 0) return { status: "지연", daysLeft, partial, reason: "납기일이 " + -daysLeft + "일 지남" + tag };
  const ruleTag = lim.keyword ? " · '" + lim.keyword + "' 품목은 " + lim.days + "일 이내를 임박으로 봄" : "";
  if (daysLeft <= lim.days) return { status: "임박", daysLeft, soonLimit: lim.days, partial, reason: (daysLeft === 0 ? "납기일이 오늘" : "납기일까지 " + daysLeft + "일 남음") + ruleTag + tag };
  return { status: "정상", daysLeft, soonLimit: lim.days, partial, reason: "납기일까지 " + daysLeft + "일 남음" + ruleTag + tag };
}

// 예외 목록: 지연(오래된 순) → 임박(가까운 순). 확인필요는 숨기지 않고 따로 돌려준다.
function findExceptions(orders, today, soonDays = 7) {
  const judged = orders.map(o => ({ ...o, ...classify(o, today, soonDays) }));
  const exceptions = judged.filter(o => o.status === "지연" || o.status === "임박")
    .sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    all: judged,                                   // 판정한 주문 전부 (홈의 회신 늦음처럼 정상 주문도 봐야 하는 곳이 쓴다)
    exceptions,
    needCheck: judged.filter(o => o.status === "확인필요"),
    counts: {
      지연: judged.filter(o => o.status === "지연").length,
      임박: judged.filter(o => o.status === "임박").length,
      정상: judged.filter(o => o.status === "정상").length,
      입고완료: judged.filter(o => o.status === "입고완료").length,
      확인필요: judged.filter(o => o.status === "확인필요").length,
      부분입고: judged.filter(o => o.partial).length,
    },
  };
}

const judgeApi = { parseDate, parseNumber: toNum, isReceived, classify, findExceptions, parseRules, limitFor };
if (typeof module !== "undefined") module.exports = judgeApi; else window.Judge = judgeApi;
