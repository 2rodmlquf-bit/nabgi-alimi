// 가짜 샘플 CSV 생성기. 실제 회사·사람·품목 정보가 아닌 임의의 가상 데이터다.
// 기준일(오늘)로부터 납기일을 계산하므로, 기준일을 바꿔서 다시 만들 수 있다.
//   사용: node make-sample.js 2026-10-12
const fs = require("fs");
const path = require("path");

const base = new Date((process.argv[2] || "2026-10-12") + "T00:00:00Z");
const fmt = (offset, style) => {
  if (offset === null) return "";
  const d = new Date(base.getTime() + offset * 86400000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const p = n => String(n).padStart(2, "0");
  if (style === "slash") return y + "/" + m + "/" + day;
  if (style === "dot2") return String(y).slice(2) + "." + p(m) + "." + p(day);
  return y + "-" + p(m) + "-" + p(day);
};

const items = ["산업용 베어링 6204", "유압 호스 1/2인치", "인버터 부품 세트", "에어 필터 카트리지", "정밀 드라이버 세트", "광섬유 점퍼 케이블", "실험용 니트릴 장갑", "윤활 그리스 카트리지", "소형 진공 펌프", "온도 센서 PT100", "스테인리스 볼트 M8", "안전 고글", "열수축 튜브 모음", "정밀 저울 보정추", "냉각 팬 120mm"];
const suppliers = ["가온산업", "나래테크", "다온상사", "라온기계", "마루인더스트리", "바다물산"];
const requesters = ["연구1팀 A연구원", "연구1팀 B연구원", "연구2팀 C연구원", "연구2팀 D연구원", "분석팀 E연구원", "분석팀 F연구원"];
const ship = ["발주확인", "생산중", "선적완료", "통관중", "통관완료", "국내입고대기"];

// [납기까지 남은 일수(음수=지난 날), 선적상태 번호, 입고여부, 날짜형식, 비고]
const spec = [
  [-18, 1, "", "", "공급사 회신 후 한 차례 연기"], [-12, 3, "", "", "통관 서류 보완 중"], [-9, 1, "", "", ""], [-6, 2, "", "slash", ""],
  [-4, 3, "", "", "수입 통관 대기"], [-2, 1, "", "", ""], [-1, 4, "", "dot2", "오전 도착 예정이라 함"],
  [0, 4, "", "", "오늘 납기"], [1, 3, "", "", ""], [2, 2, "", "", ""], [3, 1, "", "slash", ""], [4, 3, "", "", ""], [5, 2, "", "", ""], [6, 1, "", "", "회신 납기 재확인 필요"], [7, 2, "", "", ""],
  [8, 1, "", "", ""], [9, 2, "", "", ""], [10, 1, "", "", ""], [11, 2, "", "", ""], [12, 1, "", "", ""], [14, 0, "", "", ""], [15, 1, "", "", ""], [16, 0, "", "", ""], [18, 1, "", "", ""],
  [20, 0, "", "", ""], [21, 1, "", "", ""], [24, 0, "", "", ""], [25, 1, "", "", ""], [28, 0, "", "", ""], [30, 1, "", "", ""], [32, 0, "", "", ""], [35, 1, "", "", ""],
  [-8, 5, "Y", "", "지연되었으나 입고 완료"], [-3, 4, "Y", "", ""], [2, 4, "Y", "", ""], [-20, 5, "입고", "", ""],
  [null, 1, "", "", "회신 납기 미확인"], [null, 0, "", "", "납기 문의 필요"],
];

const header = ["주문번호", "품목명", "공급사", "요청자", "발주일", "납기일", "선적상태", "통관상태", "입고여부", "비고", "주문수량", "입고수량", "규격"];
const specs = ["6204ZZ", "1/2인치 200mm", "SET-A", "FA-120", "PH-2 세트", "SM 2m", "M 사이즈", "NLGI 2", "1.5L/min", "PT100 3선식", "M8x30", "표준형", "Φ6 10m", "1kg", "120mm"];
// 부분 입고(주문수량보다 적게 들어온 것): PO-2026-1004(지연), 1009(임박), 1016(정상). 입고 완료(Y)인 주문은 입고수량이 주문수량과 같다.
const PARTIAL = { "PO-2026-1004": 4, "PO-2026-1009": 6, "PO-2026-1016": 3 };
const rows = spec.map((s, i) => {
  const [left, shipIdx, got, style, note] = s;
  const status = shipIdx <= 1 ? "해당없음" : shipIdx === 2 ? "해당없음" : shipIdx === 3 ? "통관중" : "통관완료";
  const no = "PO-2026-" + String(1001 + i);
  return [
    no,
    items[i % items.length], suppliers[(i * 5) % suppliers.length], requesters[(i * 7) % requesters.length],
    fmt((left === null ? 20 : left) - 21),
    fmt(left, style), ship[shipIdx], status, got, note,
    10, got ? 10 : PARTIAL[no] || "", specs[i % items.length],
  ];
});

const csv = [header].concat(rows).map(r => r.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(",")).join("\r\n");
fs.writeFileSync(path.join(__dirname, "샘플주문.csv"), "﻿" + csv + "\r\n", "utf8");
console.log("샘플 " + rows.length + "건 생성 (기준일 " + fmt(0) + ")");
