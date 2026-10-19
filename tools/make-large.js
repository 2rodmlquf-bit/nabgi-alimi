// 큰 주문 목록 CSV 생성기 (성능 측정용). 시드가 고정이라 같은 입력이면 항상 같은 파일이 나온다. 모두 가상 데이터다.
//   사용: node tools/make-large.js <행 수> [출력 경로]   (출력 경로를 안 주면 e2e/out/large-<행 수>.csv)
// 판정 비율은 샘플과 비슷하게 맞춘다: 지연 약 18%, 임박 약 16%, 확인 필요 약 5%, 입고 완료 약 10%, 나머지 정상.
const fs = require("fs"), path = require("path");

function rng(seed) {                                     // mulberry32: 같은 시드 → 같은 수열
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const ITEMS = ["산업용 베어링 6204", "유압 호스 1/2인치", "인버터 부품 세트", "에어 필터 카트리지", "정밀 드라이버 세트", "광섬유 점퍼 케이블", "실험용 니트릴 장갑", "윤활 그리스 카트리지", "소형 진공 펌프", "온도 센서 PT100"];
const SUPPLIERS = ["가온산업", "나래테크", "다온상사", "라온기계", "마루인더스트리", "바다물산", "사랑물산", "아름상사"];
const REQUESTERS = Array.from({ length: 24 }, (_, i) => "연구" + (1 + (i % 4)) + "팀 " + String.fromCharCode(65 + i) + "연구원");

// 기준일 2026-10-12. rows행의 CSV 글자를 돌려준다.
function buildCsv(rows, seed = 20261012) {
  const r = rng(seed), base = Date.UTC(2026, 9, 12), day = 86400000;
  const iso = off => new Date(base + off * day).toISOString().slice(0, 10);
  const pick = a => a[Math.floor(r() * a.length)];
  const lines = ["주문번호,품목명,공급사,요청자,발주일,납기일,선적상태,통관상태,입고여부,비고,주문수량,입고수량,규격"];
  for (let i = 0; i < rows; i++) {
    const roll = r();
    let due, recv = "", note = "";
    if (roll < 0.18) due = iso(-1 - Math.floor(r() * 20));                       // 지연
    else if (roll < 0.34) due = iso(Math.floor(r() * 7));                        // 임박
    else if (roll < 0.39) due = "";                                              // 확인 필요 (납기일 없음)
    else if (roll < 0.49) { due = iso(-5 - Math.floor(r() * 10)); recv = "Y"; }  // 입고 완료
    else due = iso(8 + Math.floor(r() * 60));                                    // 정상
    if (roll < 0.18 && r() < 0.5) note = pick(["통관 서류 보완 중", "선적 지연", "생산 지연", "재고 부족", ""]);
    const qty = 5 + Math.floor(r() * 50);
    lines.push([
      "PO-L-" + String(i + 1).padStart(6, "0"), pick(ITEMS), pick(SUPPLIERS), pick(REQUESTERS), iso(-30 - Math.floor(r() * 30)), due,
      pick(["생산중", "선적완료", "통관중", ""]), pick(["해당없음", "통관중", ""]), recv, note, String(qty), recv ? String(qty) : "", "규격" + (1 + Math.floor(r() * 9)),
    ].join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

if (require.main === module) {
  const n = parseInt(process.argv[2], 10);
  if (!(n > 0)) { console.error("사용: node tools/make-large.js <행 수> [출력 경로]"); process.exit(2); }
  const out = process.argv[3] || path.join(__dirname, "..", "e2e", "out", "large-" + n + ".csv");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildCsv(n), "utf8");
  console.log(out + " (" + n + "행, " + Math.round(fs.statSync(out).size / 1024) + "KB)");
}
module.exports = { buildCsv };
