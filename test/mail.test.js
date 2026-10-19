process.env.TZ = "Asia/Seoul"; // 기간 판정이 이 컴퓨터의 시간대를 쓰므로, 테스트는 항상 한국 시간으로 고정한다
const test = require("node:test");
const assert = require("node:assert");
const { parseEml, decodeWords, stripQuoted, htmlToText } = require("../src/eml");
const MF = require("../src/mailfilter");
const { extract } = require("../src/emailRules");
const { buildMails } = require("../make-sample-mail");

const mails = Object.fromEntries(buildMails().map(([name, raw]) => [name, parseEml(Buffer.from(raw, "latin1"))]));

test("제목·보낸 사람의 한글 인코딩(=?UTF-8?B?, =?EUC-KR?B?)을 풀어 쓴다", () => {
  assert.equal(decodeWords("=?UTF-8?B?" + Buffer.from("납기 안내").toString("base64") + "?="), "납기 안내");
  assert.equal(decodeWords("=?EUC-KR?B?s7Ox4iC+yLO7?="), "납기 안내");
  assert.equal(mails["02-납기변경.eml"].subject, "RE: [가온산업] 납기 변경 안내");
  assert.equal(mails["04-회신-euckr.eml"].subject, "납기 안내");
});

test("긴 제목이 여러 조각으로 나뉘어도 이어 붙인다", () => {
  const a = Buffer.from("납기 안").toString("base64"), b = Buffer.from("내 PO-1").toString("base64");
  assert.equal(decodeWords("=?UTF-8?B?" + a + "?=\r\n =?UTF-8?B?" + b + "?="), "납기 안내 PO-1");
});

test("본문 인코딩: base64, quoted-printable, EUC-KR", () => {
  assert.ok(mails["01-이전납기.eml"].body.includes("납기는 10월 20일입니다"));
  assert.ok(mails["02-납기변경.eml"].body.includes("통관 서류 보완으로 10월 23일 입고 예정입니다"));
  assert.ok(mails["04-회신-euckr.eml"].body.includes("PO-2026-1002 건은 10월 14일 도착 예정입니다"));
});

test("멀티파트는 텍스트 부분을 쓰고, HTML만 있으면 글자만 뽑는다", () => {
  assert.equal(mails["03-ETA.eml"].body, "PO-2026-1005 ETD 10/18, ETA 10/28 입니다.");
  assert.equal(htmlToText("<p>안녕&nbsp;하세요</p><p>10월&amp;11월</p>").trim(), "안녕 하세요\n10월&11월");
});

test("날짜는 ISO로 바꾸고, 읽을 수 없으면 null", () => {
  assert.equal(mails["02-납기변경.eml"].date, "2026-10-09T05:20:00.000Z");   // +0900 → UTC
  assert.equal(parseEml(Buffer.from("Subject: x\r\n\r\n본문")).date, null);
});

test("답장에 딸려 온 원문(옛 날짜)은 잘라 낸다", () => {
  const b = mails["05-답장인용.eml"].body;
  assert.ok(b.includes("10월 14일 도착 확정"));
  assert.ok(!b.includes("10월 10일"));
  assert.equal(stripQuoted("확정입니다.\n> 이전 10월 1일\nOn Mon, Oct 5, 2026 at 9:00 AM A wrote:\n옛 내용"), "확정입니다.");
});

test("엑셀 첨부는 꺼내 두고(이름은 한글·인코딩 모두), 본문에는 섞지 않는다", () => {
  const { buildSupplierFiles } = require("../make-sample-supplier");
  const xlsx = buildSupplierFiles()[0][1];
  const mk = disp => 'Subject: x\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n--B\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n표 보내드립니다.\r\n--B\r\n' +
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: ' + disp + "\r\n\r\n" +
    xlsx.toString("base64").replace(/(.{76})/g, "$1\r\n") + "\r\n--B--";
  const a = parseEml(Buffer.from(mk('attachment; filename="=?UTF-8?B?' + Buffer.from("납기회신.xlsx").toString("base64") + '?="')));
  assert.equal(a.attachments.length, 1);
  assert.equal(a.attachments[0].filename, "납기회신.xlsx");
  assert.equal(a.attachments[0].data.length, xlsx.length);               // 첨부 내용이 그대로 복원된다
  assert.equal(a.body, "표 보내드립니다.");
  const b = parseEml(Buffer.from(mk("attachment; filename*=UTF-8''%EB%82%A9%EA%B8%B0.xlsx")));
  assert.equal(b.attachments[0].filename, "납기.xlsx");
  // 엑셀·CSV가 아닌 첨부(그림 등)는 무시
  assert.equal(parseEml(Buffer.from(mk('attachment; filename="logo.png"'))).attachments.length, 0);
});

test("첨부는 읽지 않는다", () => {
  const raw = 'Subject: x\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n--B\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n본문 PO-1\r\n--B\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Disposition: attachment; filename="a.txt"\r\n\r\n첨부 내용\r\n--B--';
  const m = parseEml(Buffer.from(raw));
  assert.ok(m.body.includes("본문") && !m.body.includes("첨부 내용"));
});

test("기간 프리셋: 기준일이 월요일이든 수요일이든 '지난주 금요일'은 같은 금요일", () => {
  assert.deepEqual(MF.presetRange("lastFriNoon", "2026-10-12"), { start: "2026-10-09T00:00", end: "2026-10-12T12:00" });  // 월
  assert.deepEqual(MF.presetRange("lastFriNoon", "2026-10-14"), { start: "2026-10-09T00:00", end: "2026-10-14T12:00" });  // 수
  assert.deepEqual(MF.presetRange("lastFriNoon", "2026-10-18"), { start: "2026-10-09T00:00", end: "2026-10-18T12:00" });  // 일(이번 주의 마지막 날)
  assert.deepEqual(MF.presetRange("all", "2026-10-12"), { start: "", end: "" });
});

test("기간 안/밖 판정: 날짜를 읽을 수 없는 메일은 빼고, 경계는 포함한다", () => {
  const r = MF.presetRange("lastFriNoon", "2026-10-12");
  assert.equal(MF.inRange(mails["02-납기변경.eml"].date, r.start, r.end), true);   // 금 14:20
  assert.equal(MF.inRange(mails["07-오후.eml"].date, r.start, r.end), false);       // 월 13:10 (낮 12시 이후)
  assert.equal(MF.inRange(mails["01-이전납기.eml"].date, r.start, r.end), false);   // 화 (지난주 금요일 이전)
  assert.equal(MF.inRange(null, r.start, r.end), false);
  assert.equal(MF.inRange(null, "", ""), true);                                     // 기간 제한이 없으면 모두 포함
});

test("납기 관련 메일 판정: 납기 말 + 주문번호가 있어야 한다", () => {
  assert.equal(MF.isDueMail(mails["02-납기변경.eml"]), true);
  assert.equal(MF.isDueMail(mails["03-ETA.eml"]), true);
  assert.equal(MF.isDueMail(mails["06-회의.eml"]), false);          // 납기 말이 없음
  assert.equal(MF.isDueMail(mails["08-물류공지.eml"]), false);      // '배송'은 있지만 주문번호가 없음
  assert.equal(MF.isDueMail({ subject: "A12 입고", body: "" }, ["A12"]), true); // 목록의 주문번호
});

test("지난주 금요일~오늘 오전의 납기 메일에서 주문별 납기를 뽑는다 (메일 날짜 기준)", () => {
  const r = MF.presetRange("lastFriNoon", "2026-10-12");
  const picked = Object.values(mails).filter(m => MF.inRange(m.date, r.start, r.end) && MF.isDueMail(m));
  assert.equal(picked.length, 4);                                    // 02, 03, 04, 05
  const items = [];
  picked.forEach(m => extract(m.subject + "\n" + m.body, m.date.slice(0, 10)).forEach(i => items.push({ ...i, mail: m })));
  const byNo = Object.fromEntries(MF.pickLatestPerOrder(items).map(i => [i.orderNo, i.dueDate]));
  assert.deepEqual(byNo, { "PO-2026-1001": "2026-10-23", "PO-2026-1005": "2026-10-28", "PO-2026-1002": "2026-10-14", "PO-2026-1010": "2026-10-14" });
});

test("같은 주문이 여러 메일에 있으면 가장 최근 메일이 기준이고, 이전 메일은 older에 남는다", () => {
  const all = Object.values(mails).filter(m => MF.isDueMail(m));
  const items = [];
  all.forEach(m => extract(m.subject + "\n" + m.body, m.date.slice(0, 10)).forEach(i => items.push({ ...i, mail: m })));
  const p1001 = MF.pickLatestPerOrder(items).find(i => i.orderNo === "PO-2026-1001");
  assert.equal(p1001.dueDate, "2026-10-23");                         // 10/9 메일이 10/6 메일(10월 20일)보다 최근
  assert.equal(p1001.older.length, 1);
  assert.equal(p1001.older[0].dueDate, "2026-10-20");
  // 가장 최근 메일(10/12 오후)이 날짜를 확정하지 않은 주문은 "확인 필요"가 최신 정보다
  const p1002 = MF.pickLatestPerOrder(items).find(i => i.orderNo === "PO-2026-1002");
  assert.equal(p1002.dueDate, null);
  assert.equal(p1002.older[0].dueDate, "2026-10-14");
});

test("EUC-KR로 인코딩된 보낸 사람 이름도 풀어 쓴다", () => {
  assert.equal(mails["04-회신-euckr.eml"].from, "바다물산 <sales@bada.example>");
});
