// 수용 기준 점검표 만들기 (Phase 9). 사용: node tools/acceptance-report.js <E2E 출력 로그> [단위 시험 로그]
// E2E 출력(npm run test:e2e > 로그)에서 PASS/FAIL 줄을 읽어 FR-01~19별로 모아 표(마크다운)로 출력한다.
// 연결 규칙: ① 줄에 "FR-NN"이 있으면 그 FR ② S-03은 FR-12, S-04는 FR-07 ③ S-07의 "CUJ-1 …"은 FR-08·10·11·14, "CUJ-2 …"는 FR-09.
// 이 연결은 사람이 정한 것이다(아래 SCEN, UNIT). 표의 "단위 시험"은 그 요구사항을 지키는 시험 파일이다.
const fs = require("fs");

const PRIORITY = { "01": "Must", "02": "Must", "03": "Must", "04": "Must", "05": "Should", "06": "Should", "07": "Should", "08": "Must", "09": "Must", "10": "Must", "11": "Must", "12": "Should", "13": "Must", "14": "Must", "15": "Should", "16": "Must", "17": "Should", "18": "Could", "19": "Could" };
const TITLE = { "01": "CSV 읽기", "02": "열 매핑", "03": "상태 판정", "04": "임박 기준", "05": "정렬·검색·필터", "06": "원인 비중", "07": "xlsx 읽기", "08": "안내 상태", "09": "다시 안내", "10": "안내 기록", "11": "일괄 기록", "12": "빠른 메모", "13": "안내문", "14": "한 통 안내문", "15": "보고·CSV", "16": "저장·복원", "17": "영역 순서", "18": "기준 설정", "19": "복사 후 기록 유도" };
const UNIT = {
  "01": "judge, needCheck, columns", "02": "mapping, columns", "03": "judge, partial, needCheck", "04": "rules, judge", "05": "(화면 동작이라 E2E)", "06": "phase2 (원인·분석), contact", "07": "ordersFile",
  "08": "informed, informedReport, labels", "09": "informed", "10": "informed, persist", "11": "informed", "12": "quickNote, storeCore", "13": "phase2 (안내문), needCheck, emailRules", "14": "needCheck, phase2", "15": "report, informedReport, security",
  "16": "store.contract, storeCore, localFileStore, stability, persist", "17": "(화면 배치라 E2E 측정)", "18": "informed, persist, storeCore", "19": "(화면 동작이라 E2E)",
};

const e2eLog = process.argv[2];
if (!e2eLog) { console.error("사용: node tools/acceptance-report.js <E2E 출력 로그> [단위 시험 로그]"); process.exit(2); }
const lines = fs.readFileSync(e2eLog, "utf8").split(/\r?\n/);
const by = {}; Object.keys(PRIORITY).forEach(k => (by[k] = { pass: 0, fail: 0, fails: [] }));
let scen = "";
lines.forEach(l => {
  const s = /^\[(\S+)\]/.exec(l); if (s) { scen = s[1]; return; }
  const m = /^  (PASS|FAIL) (.*)$/.exec(l); if (!m || /^(콘솔 오류|시나리오가 끝까지)/.test(m[2])) return;
  const text = m[2]; const keys = new Set();
  [...text.matchAll(/FR-(\d\d)/g)].forEach(x => keys.add(x[1]));
  if (scen === "S-03") keys.add("12");
  if (scen === "S-04") keys.add("07");
  if (scen === "S-07" && /^CUJ-1/.test(text)) ["08", "10", "11", "14"].forEach(k => keys.add(k));
  if (scen === "S-07" && /^CUJ-2/.test(text)) keys.add("09");
  keys.forEach(k => { if (!by[k]) return; if (m[1] === "PASS") by[k].pass++; else { by[k].fail++; by[k].fails.push(text.slice(0, 60)); } });
});
const unit = process.argv[3] && fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], "utf8") : "";
const um = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(unit);

console.log("| FR | 요구사항 | 우선순위 | E2E 확인 (통과/전체) | 지키는 단위 시험 | 결과 |\n|---|---|---|---|---|---|");
let must = 0, mustOk = 0, bad = 0;
Object.keys(PRIORITY).sort().forEach(k => {
  const r = by[k], total = r.pass + r.fail, ok = total > 0 && r.fail === 0;
  if (PRIORITY[k] === "Must") { must++; if (ok) mustOk++; }
  if (!ok) bad++;
  console.log("| FR-" + k + " | " + TITLE[k] + " | " + PRIORITY[k] + " | " + r.pass + "/" + total + " | " + UNIT[k] + " | " + (total === 0 ? "**E2E 확인 없음**" : ok ? "충족" : "**미충족** " + r.fails.join("; ")) + " |");
});
console.log("\nMust " + mustOk + "/" + must + " 충족, 전체 " + (19 - bad) + "/19 충족" + (um ? " · 단위 시험 " + um[2] + "/" + um[1] + " 통과 (실패 " + um[3] + ")" : ""));
process.exit(bad ? 1 : 0);
