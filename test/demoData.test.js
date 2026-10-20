// 데모 데이터(가상 주문 엑셀): 앱이 회사 시스템 엑셀처럼 생긴 파일을 열 수 있고, 만든 시나리오 수가 판정 결과와 맞는다.
process.env.TZ = "Asia/Seoul";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const O = require("../src/ordersFile");
const Judge = require("../src/judge");
const { guessMapping, STD } = require("../src/columns");
const { buildDemo } = require("../make-demo-data");

const FILE = path.join(__dirname, "..", "데모데이터", "가상주문_연구소_2026-10.xlsx");

function judgeDemo(buf) {
  const t = O.readOrders("데모.xlsx", buf);
  const m = guessMapping(t.columns);
  const rows = t.rows.map(row => { const o = { _raw: row }; STD.forEach(s => (o[s] = m[s] ? row[m[s]] || "" : "")); return o; });
  return { t, m, r: Judge.findExceptions(rows, "2026-10-12", { def: 7, rules: [] }) };
}

test("저장소의 데모 엑셀은 생성기가 만든 것과 같다 (손으로 고치지 않았다)", () => {
  assert.ok(buildDemo().buf.equals(fs.readFileSync(FILE)));
});

test("제목 2줄을 건너뛰고 열 이름이 다른 표를 자동으로 연결해 86건을 읽는다", () => {
  const { t, m } = judgeDemo(fs.readFileSync(FILE));
  assert.equal(t.ok, true);
  assert.equal(t.rows.length, 86);
  assert.equal(m.주문번호, "발주번호"); assert.equal(m.공급사, "거래처"); assert.equal(m.요청자, "신청자"); assert.equal(m.납기일, "납기예정일"); assert.equal(m.입고수량, "누적입고");
  assert.match((t.notes || []).join(" "), /2줄/);
});

test("판정: 지연 19(일부 입고 5 포함)·임박 9·정상 40·입고 완료 14·확인 필요 4", () => {
  const { r } = judgeDemo(fs.readFileSync(FILE));
  const c = r.counts;
  assert.deepEqual([c.지연, c.임박, c.정상, c.입고완료, c.확인필요, c.부분입고], [19, 9, 40, 14, 4, 5]);
});

test("납기를 읽을 수 없는 4건('10월 말' 등)은 날짜를 지어내지 않고 확인 필요로 둔다", () => {
  const { r } = judgeDemo(fs.readFileSync(FILE));
  assert.equal((r.needCheck || []).length, 4);
});

// 엑셀(Excel)은 우리 앱보다 까다롭다: 문서 형식 선언과 관계 종류가 정식 값이 아니면 "통합 문서를 열 수 없습니다"가 뜬다.
// 실제 엑셀을 돌릴 수는 없으니 필수 조각이 정식 값인지를 본다. (이 확인이 없어서 처음 배포한 파일이 엑셀에서 안 열렸다)
// zip을 직접 읽는다: 중앙 디렉터리를 따라 항목을 풀어 내용을 글자로 돌려준다.
const zlib = require("zlib");
function unzipText(buf) {
  const out = new Map();
  let end = buf.length - 22; while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  let p = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const comp = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const lhName = buf.readUInt16LE(off + 26), lhExtra = buf.readUInt16LE(off + 28), start = off + 30 + lhName + lhExtra;
    const raw = buf.slice(start, start + csize);
    out.set(name, (comp === 8 ? zlib.inflateRawSync(raw) : raw).toString("utf8"));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

test("엑셀이 요구하는 정식 구조다: 형식 선언(Override)·관계 종류·스타일·수정 날짜", () => {
  for (const file of [FILE, path.join(__dirname, "..", "샘플주문.xlsx")]) {
    const e = unzipText(fs.readFileSync(file));
    assert.ok(e.size >= 6, file + " 항목 수");
    assert.match(e.get("[Content_Types].xml"), /Override PartName="\/xl\/workbook.xml" ContentType="application\/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main\+xml"/);
    assert.match(e.get("[Content_Types].xml"), /Override PartName="\/xl\/worksheets\/sheet1.xml" ContentType="application\/vnd.openxmlformats-officedocument.spreadsheetml.worksheet\+xml"/);
    assert.match(e.get("[Content_Types].xml"), /Default Extension="rels"/);
    assert.match(e.get("xl/_rels/workbook.xml.rels"), /relationships\/worksheet"/);
    assert.match(e.get("xl/_rels/workbook.xml.rels"), /relationships\/styles"/);
    assert.doesNotMatch(e.get("xl/_rels/workbook.xml.rels"), /Type="x"/);
    assert.match(e.get("xl/styles.xml"), /<fonts count="2">[\s\S]*<cellXfs count="3">/);
  }
});
