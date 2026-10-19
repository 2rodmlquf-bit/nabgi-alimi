// 가상 샘플 메일(.eml) 생성기. 실제 회사·사람이 아닌 임의의 가상 메일이고, 기준일은 2026-10-12(월)이다.
// 일부러 여러 인코딩과 함정(답장 인용, 회의 안내, 주문번호 없는 배송 안내)을 섞었다.
//   사용: node make-sample-mail.js   → 샘플메일/ 폴더에 .eml 파일 생성
const fs = require("fs");
const path = require("path");

const b64 = (s, lines = true) => { const x = Buffer.from(s, "utf8").toString("base64"); return lines ? x.replace(/(.{76})/g, "$1\r\n") : x; };
const word = s => "=?UTF-8?B?" + b64(s, false) + "?=";
const qp = s => Buffer.from(s, "utf8").toString("latin1").replace(/[^\x20-\x3c\x3e-\x7e\r\n]/g, c => "=" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).replace(/\r?\n/g, "\r\n");

function mail(headers, body) {
  return Object.entries(headers).map(([k, v]) => k + ": " + v).join("\r\n") + "\r\n\r\n" + body + "\r\n";
}
const FROM = (name, addr) => word(name) + " <" + addr + ">";

function buildMails() {
  const list = [];

  // 1) 옛 메일: 기간 밖(10/6), 같은 주문의 이전 납기
  list.push(["01-이전납기.eml", mail({
    "Date": "Tue, 06 Oct 2026 10:00:00 +0900", "From": FROM("가온산업 영업팀", "sales@gaon.example"), "To": "buyer@example.test",
    "Subject": word("[가온산업] 납기 안내"), "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "base64",
  }, b64("안녕하세요.\nPO-2026-1001 건의 납기는 10월 20일입니다."))]);

  // 2) 지난주 금요일 오후: quoted-printable, 납기가 바뀜
  list.push(["02-납기변경.eml", mail({
    "Date": "Fri, 09 Oct 2026 14:20:00 +0900", "From": FROM("가온산업 영업팀", "sales@gaon.example"), "To": "buyer@example.test",
    "Subject": word("RE: [가온산업] 납기 변경 안내"), "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "quoted-printable",
  }, qp("안녕하세요.\nPO-2026-1001 건은 통관 서류 보완으로 10월 23일 입고 예정입니다.\n불편을 드려 죄송합니다."))]);

  // 3) 지난주 금요일 저녁: multipart(텍스트+HTML), ETD/ETA
  list.push(["03-ETA.eml", mail({
    "Date": "Fri, 09 Oct 2026 17:05:00 +0900", "From": "Logistics <logi@trade.example>", "To": "buyer@example.test",
    "Subject": "ETA update PO-2026-1005", "MIME-Version": "1.0", "Content-Type": 'multipart/alternative; boundary="BOUND-1"',
  }, "This is a multi-part message.\r\n--BOUND-1\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
    b64("PO-2026-1005 ETD 10/18, ETA 10/28 입니다.") + "\r\n--BOUND-1\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
    b64("<html><body><p>PO-2026-1005 ETD 10/18, ETA 10/28 입니다.</p></body></html>") + "\r\n--BOUND-1--")]);

  // 4) 오늘 오전: EUC-KR(CP949) 인코딩 (예전 한국 메일에 흔함)
  list.push(["04-회신-euckr.eml", mail({
    "Date": "Mon, 12 Oct 2026 08:40:00 +0900", "From": "=?EUC-KR?B?udm02bmwu+o=?= <sales@bada.example>", "To": "buyer@example.test",
    "Subject": "=?EUC-KR?B?s7Ox4iC+yLO7?=", "MIME-Version": "1.0", "Content-Type": "text/plain; charset=euc-kr", "Content-Transfer-Encoding": "base64",
  }, "vsiz58fPvLy/5C4gUE8tMjAyNi0xMDAyILDHwLogMTC/+SAxNMDPILW1wvggv7nBpMDUtM+02S4gsKi758fVtM+02S4=")]);

  // 5) 오늘 오전: 답장. 아래에 딸려 온 원문에는 옛 날짜(10월 10일)가 들어 있다
  list.push(["05-답장인용.eml", mail({
    "Date": "Mon, 12 Oct 2026 08:55:00 +0900", "From": FROM("라온기계", "cs@raon.example"), "To": "buyer@example.test",
    "Subject": word("RE: 온도 센서 납기 문의"), "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "base64",
  }, b64("PO-2026-1010 건은 10월 14일 도착 확정입니다.\n\n-----Original Message-----\n보낸 사람: buyer@example.test\nPO-2026-1010 납기가 10월 10일이라고 들었는데 맞나요?\n> PO-2026-1010 10월 10일"))]);

  // 6) 오늘 오전: 납기와 무관한 회의 안내
  list.push(["06-회의.eml", mail({
    "Date": "Mon, 12 Oct 2026 09:10:00 +0900", "From": FROM("구매팀 총무", "admin@example.test"), "To": "buyer@example.test",
    "Subject": word("주간 회의 일정 안내"), "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "base64",
  }, b64("내일 오후 3시에 주간 회의가 있습니다. 회의실은 3층입니다."))]);

  // 7) 오늘 오후: 기간(오전까지) 밖. 날짜를 확정하지 않은 표현
  list.push(["07-오후.eml", mail({
    "Date": "Mon, 12 Oct 2026 13:10:00 +0900", "From": FROM("바다물산", "sales@bada.example"), "To": "buyer@example.test",
    "Subject": word("납기 관련 회신"), "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "base64",
  }, b64("PO-2026-1002 건은 빠르면 이번 주 중, 늦으면 다음 주 초 도착합니다."))]);

  // 8) 지난주 금요일: 배송 안내이지만 주문번호가 없는 일반 공지 (납기 메일이 아님)
  list.push(["08-물류공지.eml", mail({
    "Date": "Fri, 09 Oct 2026 11:30:00 +0900", "From": FROM("물류센터", "center@example.test"), "To": "all@example.test",
    "Subject": word("물류센터 이전 안내"), "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "base64",
  }, b64("다음 달부터 물류센터가 이전하여 배송 시간이 달라집니다."))]);

  // 9) 오늘 오전: 공급사가 엑셀 표를 첨부해서 보냄 (본문에는 주문번호·날짜가 없어서 '납기 메일' 필터에는 걸리지 않고, 첨부로만 읽는다)
  const xlsx = require("./make-sample-supplier").buildSupplierFiles()[0][1];
  list.push(["09-엑셀첨부.eml", mail({
    "Date": "Mon, 12 Oct 2026 08:20:00 +0900", "From": FROM("가온산업 영업팀", "sales@gaon.example"), "To": "buyer@example.test",
    "Subject": word("납기 회신 표 첨부드립니다"), "MIME-Version": "1.0", "Content-Type": 'multipart/mixed; boundary="BOUND-2"',
  }, "--BOUND-2\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + b64("첨부한 표에 회신 가능한 것만 적었습니다.") +
    "\r\n--BOUND-2\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\nContent-Transfer-Encoding: base64\r\n" +
    "Content-Disposition: attachment; filename=\"" + word("가온산업_납기회신.xlsx") + "\"\r\n\r\n" + xlsx.toString("base64").replace(/(.{76})/g, "$1\r\n") + "\r\n--BOUND-2--")]);

  return list;
}

if (require.main === module) {
  const dir = path.join(__dirname, "샘플메일");
  fs.mkdirSync(dir, { recursive: true });
  buildMails().forEach(([name, raw]) => fs.writeFileSync(path.join(dir, name), raw, "latin1"));
  console.log("샘플 메일 " + buildMails().length + "통 생성: " + dir);
}
module.exports = { buildMails };
