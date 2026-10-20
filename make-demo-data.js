// 데모용 가상 주문 엑셀(.xlsx) 생성기. 실제 회사·사람·주문이 아닌 임의의 가상 데이터다.
// 샘플주문.csv(앱 안 "샘플 불러오기")와 달리, 회사 시스템에서 내보낸 것처럼 보이게 만든 별도 파일이다:
//   제목 줄과 작성 정보 줄이 앞에 있고, 열 이름이 우리 표준과 다르며(발주번호·거래처·신청자·납기예정일 …), 날짜 모양이 섞여 있고,
//   납기를 읽을 수 없는 칸("10월 말", "미정")과 일부만 입고된 주문이 들어 있다.
// 같은 시드면 항상 같은 파일이 나온다(시험·소개 페이지 캡처가 흔들리지 않게).
//   사용: node make-demo-data.js   → 데모데이터/가상주문_연구소_2026-10.xlsx 생성
const fs = require("fs");
const path = require("path");
const { buildXlsx } = require("./make-sample-supplier");

const BASE = "2026-10-12";                                   // 기준일: 이 날짜로 지연·임박을 판정하면 아래 시나리오 수가 나온다
const SUPPLIERS = ["가온산업", "바다물산", "마루인더스트리", "라온기계", "다온상사", "나래테크", "하늘정밀", "새솔케미칼"];
const REQUESTERS = ["연구1팀 A연구원", "연구1팀 B연구원", "연구2팀 C연구원", "연구2팀 D연구원", "분석팀 E연구원", "분석팀 F연구원", "소재팀 G연구원", "소재팀 H연구원"];
const ITEMS = [
  ["산업용 베어링 6204", "6204ZZ"], ["유압 호스 1/2인치", "200mm"], ["인버터 부품 세트", "SET-A"], ["에어 필터 카트리지", "FA-120"], ["정밀 드라이버 세트", "PH-2"],
  ["광섬유 점퍼 케이블", "SM 2m"], ["실험용 니트릴 장갑", "M"], ["윤활 그리스 카트리지", "NLGI 2"], ["소형 진공 펌프", "1.5L/min"], ["온도 센서 PT100", "3선식"],
  ["스테인리스 볼트 M8", "M8x30"], ["안전 고글", "표준형"], ["열수축 튜브 모음", "Φ6"], ["정밀 저울 보정추", "1kg"], ["냉각 팬 120mm", "120mm"],
  ["시약병 250ml", "갈색"], ["파이펫 팁 1000ul", "멸균"], ["아르곤 레귤레이터", "CGA580"], ["PTFE 필터 0.22um", "25mm"], ["고순도 에탄올", "99.9%"],
  ["실리콘 튜빙", "ID 4mm"], ["데이터 로거", "4ch"], ["스테핑 모터 드라이버", "TB6600"], ["알루미늄 프로파일", "2020"], ["LED 광원 모듈", "450nm"],
];
const DELAY_NOTES = ["공급사 회신 후 한 차례 연기", "통관 서류 보완 중", "원자재 수급 지연", "회신 납기 재확인 필요", "납기 문의 필요", "수입 통관 대기", "생산 일정 재조정"];

// 시드 고정 난수 (재현 가능). 암호용이 아니다.
let seed = 20261012;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// 시나리오별 개수: 지연 14 · 임박 9 · 정상 40 · 입고 완료 14 · 일부 입고 5 · 납기 읽을 수 없음 4 = 86건
const PLAN = [["late", 14], ["soon", 9], ["normal", 40], ["received", 14], ["partial", 5], ["unclear", 4]];

function makeOrder(kind, n) {
  const [item, spec] = pick(ITEMS), supplier = pick(SUPPLIERS), requester = pick(REQUESTERS);
  const qty = pick([5, 10, 20, 50, 100]);
  let due, ordered, ship = "생산중", customs = "해당없음", got = "", note = "", recv = "";
  if (kind === "late") { due = addDays(BASE, -(1 + Math.floor(rnd() * 20))); note = pick(DELAY_NOTES); ship = pick(["생산중", "통관중", "선적완료"]); }
  else if (kind === "soon") { due = addDays(BASE, 1 + Math.floor(rnd() * 7)); ship = pick(["선적완료", "통관중", "생산중"]); }
  else if (kind === "normal") { due = addDays(BASE, 8 + Math.floor(rnd() * 50)); ship = pick(["발주확인", "생산중", "발주확인"]); }
  else if (kind === "received") { due = addDays(BASE, -(2 + Math.floor(rnd() * 15))); ship = "국내입고대기"; customs = "통관완료"; recv = "Y"; got = qty; }
  else if (kind === "partial") { due = addDays(BASE, -(1 + Math.floor(rnd() * 8))); ship = "선적완료"; got = Math.max(1, Math.floor(qty * (0.3 + rnd() * 0.4))); note = "나머지는 분납 예정"; }
  else { due = pick(["10월 말", "미정", "협의중", "다음 주 중"]); note = "공급사에 납기 확인 요청"; }
  ordered = addDays(/^\d{4}/.test(due) ? due : BASE, -(14 + Math.floor(rnd() * 21)));
  if (ship === "통관중") customs = "통관중";
  return { no: "PO-2026-" + (2001 + n), item, supplier, requester, ordered, due, ship, customs, qty, got, recv, note, spec };
}

// 날짜 칸: 대부분 엑셀 날짜, 일부는 사람이 손으로 친 글자 모양(2026/10/6, 26.10.11)이라 읽기 어려운 상황을 만든다
function dateCell(iso, i) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  if (i % 11 === 5) return y + "/" + Number(m) + "/" + Number(d);
  if (i % 17 === 8) return y.slice(2) + "." + m + "." + d;
  return { date: iso };
}

function buildDemo() {
  seed = 20261012;
  const orders = [];
  PLAN.forEach(([kind, count]) => { for (let i = 0; i < count; i++) orders.push(makeOrder(kind, orders.length)); });
  orders.sort((a, b) => (a.no < b.no ? -1 : 1));                  // 시나리오 순서대로 모여 있지 않게 섞은 것처럼 번호순으로
  const shuffled = orders.map((o, i) => ({ o, k: (i * 37) % orders.length })).sort((a, b) => a.k - b.k).map(x => x.o).map((o, i) => ({ ...o, no: "PO-2026-" + (2001 + i) }));
  const head = ["발주번호", "품명", "거래처", "신청자", "발주일", "납기예정일", "선적", "통관", "발주수량", "누적입고", "입고확인", "모델/규격", "비고"];
  const rows = shuffled.map((o, i) => [o.no, o.item, o.supplier, o.requester, dateCell(o.ordered, i + 2), dateCell(o.due, i), o.ship, o.customs, o.qty, o.got === "" ? "" : Number(o.got), o.recv, o.spec, o.note]);
  const sheet = {
    name: "발주현황",
    merges: ["A1:M1"],
    boldRow: 2,                                                    // 머리글 줄(3번째)을 굵게
    widths: [14, 22, 16, 16, 12, 14, 12, 12, 10, 10, 10, 14, 26],
    rows: [
      ["연구소 구매 발주 현황 (가상 데이터)", ...Array(12).fill("")],
      ["작성: 구매팀 · 2026-10-12 기준 · 이 파일의 회사·사람·주문은 모두 임의로 만든 가상 데이터입니다", ...Array(12).fill("")],
      head, ...rows,
    ],
  };
  return { buf: buildXlsx([sheet]), count: rows.length };
}

const README = `# 데모 데이터 (가상)

이 폴더의 파일은 앱을 직접 눌러 보기 위한 **가상 데이터**입니다. 실제 회사·사람·주문이 아닙니다.

## 가상주문_연구소_2026-10.xlsx
회사 시스템에서 내보낸 엑셀처럼 만들었습니다. \`node make-demo-data.js\`로 다시 만들 수 있고, 항상 같은 내용입니다.

| 일부러 넣은 것 | 왜 |
|---|---|
| 위에 제목 줄·작성 정보 줄, 합친 칸 | 실제 엑셀은 표가 첫 줄에서 시작하지 않는 경우가 많음 |
| 열 이름이 다름 (발주번호, 거래처, 신청자, 납기예정일 …) | 앱이 열을 자동으로 연결하는지 확인 |
| 날짜 모양이 섞임 (엑셀 날짜, 2026/10/6, 26.10.11) | 사람이 손으로 친 날짜도 읽는지 확인 |
| 납기가 "10월 말", "미정" | 읽을 수 없는 값은 지어내지 않고 '확인 필요'로 |
| 일부만 입고된 주문 | 남은 수량 기준으로 판정 |

기준일 **2026-10-12**에서 86건: **지연 19**(그중 일부만 입고된 5건 포함) · 임박 9 · 정상 40 · 입고 완료 14 · 확인 필요 4 (단위 시험 test/demoData.test.js가 이 수를 확인합니다).

## 써 보는 순서
1. 앱에서 **목록 열기** → 이 엑셀 선택 (열이 자동 연결됩니다)
2. 홈에서 안내할 것·회신 늦음 확인 → 예외 목록에서 주문을 눌러 **안내함으로 기록**
3. **이메일 납기 추출 → 메일 폴더에서 읽기**에서 \`샘플메일/\` 폴더 선택, 공급사 엑셀은 \`샘플공급사/\`
`;

if (require.main === module) {
  const dir = path.join(__dirname, "데모데이터");
  fs.mkdirSync(dir, { recursive: true });
  const { buf, count } = buildDemo();
  fs.writeFileSync(path.join(dir, "가상주문_연구소_2026-10.xlsx"), buf);
  fs.writeFileSync(path.join(dir, "설명.md"), README, "utf8");
  console.log("데모데이터/가상주문_연구소_2026-10.xlsx " + count + "건 (" + buf.length + " bytes)");
}

module.exports = { buildDemo };
