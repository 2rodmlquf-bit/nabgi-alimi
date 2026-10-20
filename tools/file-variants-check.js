// 실제 회사 파일에서 흔한 모양을 흉내 낸 가짜 파일로 앱을 열어 본다 (실제 파일이 없어서 하는 대리 점검).
// 사용: node tools/file-variants-check.js   (Windows 전용: CP949 파일을 PowerShell로 만든다)
//  1) CP949(EUC-KR) 한글 CSV + 우리와 다른 열 이름(발주번호·품명·공급업체·연구원·납기) + 같은 주문번호가 여러 줄
//  2) UTF-8 BOM CSV (엑셀의 "CSV UTF-8" 저장)
//  3) 열 순서가 다르고 필요 없는 열이 많은 파일
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const { launchApp } = require("../e2e/helpers");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nabgi-variants-"));

const cp949 = (file, text) => {
  const tmp = file + ".utf8"; fs.writeFileSync(tmp, text, "utf8");
  cp.execFileSync("powershell", ["-NoProfile", "-Command", `[IO.File]::WriteAllBytes('${file}', [Text.Encoding]::GetEncoding(949).GetBytes([IO.File]::ReadAllText('${tmp}', [Text.Encoding]::UTF8)))`]);
  fs.unlinkSync(tmp);
};

const A = dir + "\case1-cp949.csv";
cp949(A, ["발주번호,품명,공급업체,연구원,발주일,납기,비고",
  "PO-9001,유압 호스,가온산업,김연구,2026-09-01,2026-10-05,통관 서류 보완중", "PO-9001,유압 호스 부속,가온산업,김연구,2026-09-01,2026-10-20,",
  "PO-9002,베어링,바다물산,이연구,2026-09-03,2026-10-30,", "PO-9003,그리스,바다물산,이연구,2026-09-03,2026-10-01,선적 지연"].join("\r\n") + "\r\n");
const B = dir + "\case2-bom.csv";
fs.writeFileSync(B, "﻿" + ["주문번호,품목명,공급사,요청자,발주일,납기일", "PO-9101,필터,가온산업,김연구,2026-09-01,2026-10-03", "PO-9102,장갑,나래테크,박연구,2026-09-02,2026-10-25"].join("\n") + "\n", "utf8");
const C = dir + "\case3-shuffled.csv";
fs.writeFileSync(C, ["비고,무관한열1,납기일,무관한열2,요청자,공급사,품목명,주문번호,무관한열3", ",x,2026-10-02,y,김연구,가온산업,케이블,PO-9201,z", "급함,x,2026-11-20,y,박연구,바다물산,밸브,PO-9202,z"].join("\n") + "\n", "utf8");

(async () => {
  for (const [name, file, expect] of [
    ["CP949 한글 CSV + 다른 열 이름 + 같은 주문번호 여러 줄", A, { rows: 4, no: "발주번호", due: "납기", sup: "공급업체", dupNote: true, korean: "유압 호스" }],
    ["UTF-8 BOM CSV", B, { rows: 2, no: "주문번호", due: "납기일", sup: "공급사", dupNote: false, korean: "필터" }],
    ["열 순서가 다르고 필요 없는 열이 섞인 CSV", C, { rows: 2, no: "주문번호", due: "납기일", sup: "공급사", dupNote: false, korean: "케이블" }],
  ]) {
    console.log("\n== " + name);
    const app = await launchApp({ openFile: file });
    try {
      await app.click("#openBtn"); await app.showList();
      await app.waitFor(async () => (await app.eval("S.rows ? S.rows.length : 0")) > 0, 8000);
      const info = await app.eval("({ rows: S.rows.length, m: S.mapping, text: document.body.innerText, note: document.getElementById('fileNote').innerText })");
      check("행 수가 맞게 읽힌다", info.rows === expect.rows, info.rows + "행");
      check("한글이 깨지지 않는다", info.text.includes(expect.korean) && !info.text.includes("�"));
      check("주문번호·납기일·공급사 열을 자동으로 연결한다", info.m["주문번호"] === expect.no && info.m["납기일"] === expect.due && info.m["공급사"] === expect.sup, JSON.stringify([info.m["주문번호"], info.m["납기일"], info.m["공급사"]]));
      check(expect.dupNote ? "같은 주문번호가 여러 줄이라는 경고가 나온다" : "경고가 없다 (겹치는 번호 없음)", /같은 주문번호가 여러 줄/.test(info.note) === expect.dupNote, info.note.slice(0, 80));
      check("표가 나온다 (판정 결과 행이 1개 이상)", (await app.count("#tbody tr")) > 0);
    } finally { await app.close(); }
    check("콘솔 오류 0건", app.errors.length === 0, app.errors.slice(0, 2).join(" | "));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("\n" + (failed ? failed + "개 실패" : "모두 통과"));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
