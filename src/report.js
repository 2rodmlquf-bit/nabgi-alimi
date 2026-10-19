// 보고서 문구와 CSV 내보내기. 화면·파일과 무관한 순수 함수.
(function (root) {
  const pad = n => String(n).padStart(2, "0");

  // CSV 한 칸. 엑셀에서 수식으로 실행되는 것을 막기 위해, 글자 칸이 = + - @ 로 시작하면 앞에 '를 붙인다.
  // (공급사가 보낸 메모에 =HYPERLINK(...) 같은 것이 들어 있을 수 있다.) 숫자 칸은 그대로 둔다.
  function csvCell(v) {
    if (v == null) return "";
    if (typeof v === "number") return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // 한글이 엑셀에서 깨지지 않도록 맨 앞에 BOM을 붙인다.
  function toCsv(headers, rows) {
    return "﻿" + [headers].concat(rows).map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  // 저장 이름: 경로 문자를 없애고 허용된 확장자만 쓴다 (실제 저장 위치는 사용자가 저장 창에서 고른다).
  function safeFileName(base, ext) {
    const e = ["csv", "txt"].includes(ext) ? ext : "txt";
    const name = String(base || "납기보고").replace(/[\\/:*?"<>|\r\n]+/g, "_").replace(/^\.+/, "").slice(0, 60) || "납기보고";
    return name.replace(/\.(csv|txt)$/i, "") + "." + e;
  }

  const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);

  // input: { base, fileName, total, counts{지연,임박,정상,입고완료,확인필요}, delay(Analyze.summarize 결과),
  //          groups(Contact.plan 결과), contacted(오늘 연락한 업체 수), editedCount(납기 변경 반영 건수) }
  function buildReport(input) {
    const { base, fileName, total, counts, delay, groups, contacted = 0, editedCount = 0, informed = null } = input;
    const L = [];
    L.push("납기 현황 보고 (기준일 " + base + ")");
    L.push("파일: " + (fileName || "(파일 없음)") + " (전체 " + total + "건)");
    L.push("", "■ 요약");
    L.push("- 납기 지연 " + counts.지연 + "건" + (delay.total ? " (평균 " + delay.avgDays + "일, 최장 " + delay.maxDays + "일)" : ""));
    L.push("- 납기 임박 " + counts.임박 + "건");
    if (counts.확인필요) L.push("- 납기일 확인 필요 " + counts.확인필요 + "건");
    L.push("- 정상 " + counts.정상 + "건, 입고 완료 " + counts.입고완료 + "건 (목록에서 제외)");

    if (delay.total) {
      L.push("", "■ 지연 원인 (지연 " + delay.total + "건 기준)");
      delay.byCause.forEach(c => L.push("- " + c.name + " " + c.count + "건 (" + pct(c.count, delay.total) + "%)"));
      const misc = (delay.byCause.find(c => c.name === "기타·미확인") || { count: 0 }).count;
      if (pct(misc, delay.total) >= 50) L.push("※ 기타·미확인 비중이 높아 원인 파악이 더 필요합니다.");
      L.push("", "■ 공급사별 지연 (상위 3곳)");
      delay.bySupplier.slice(0, 3).forEach(s => L.push("- " + s.name + " " + s.count + "건 (평균 " + s.avg + "일, 최장 " + s.max + "일)"));
      L.push("", "■ 연구원별 영향 (상위 3명)");
      delay.byRequester.slice(0, 3).forEach(s => L.push("- " + s.name + " " + s.count + "건 (최장 " + s.max + "일)"));
    }

    const pending = groups.length - contacted;
    const noReply = groups.reduce((n, g) => n + g.counts.미회신 + g.orders.filter(o => o.noReply && o.status !== "미회신").length, 0);
    L.push("", "■ 조치 현황");
    L.push("- 이메일·공급사 파일 기준으로 납기를 변경 반영한 주문 " + editedCount + "건");
    L.push("- 공급사 연락: 완료 " + contacted + "곳 / 남음 " + Math.max(0, pending) + "곳" + (noReply ? " (회신 미확인 " + noReply + "건 포함)" : ""));

    // 연구원 안내 현황(Informed.summary 결과). 안내 기록을 쓰지 않았으면 이 줄을 넣지 않는다.
    if (informed && informed.total) {
      L.push("- 연구원 안내: 지연·임박 " + informed.total + "건 중 안내 완료 " + informed.안내완료 + "건, 안내 안 함 " + informed.미안내 + "건, 다시 알려야 할 건 " + informed.재안내필요 + "건");
      if (informed.지연) L.push("- 지연 " + informed.지연 + "건 중 지연되기 전에 미리 안내한 건 " + informed.preempt + "건, 지연 중인데 아직 안내하지 못한 건 " + informed.lateNone + "건");
    }

    if (groups.length) {
      L.push("", "■ 우선 연락할 업체 (상위 3곳)");
      groups.slice(0, 3).forEach((g, i) => {
        const parts = [["지연", g.counts.지연], ["임박", g.counts.임박], ["확인 필요", g.counts.확인필요], ["미회신", g.counts.미회신]].filter(p => p[1]).map(p => p[0] + " " + p[1]);
        L.push((i + 1) + ". " + g.supplier + " (" + parts.join(", ") + ")");
      });
    }
    return L.join("\n");
  }

  // 예외 목록 CSV 행. exceptions/needCheck는 판정된 주문(표준 열 포함), causeOf/reasonOf는 화면과 같은 규칙, contactedOn: {공급사: 날짜}
  const EXC_HEAD = ["상태", "남은일수(음수=지연)", "주문번호", "품목명", "공급사", "요청자", "납기일", "지연 원인", "사유", "공급사 연락일", "연구원 안내"];
  // informedOf: 주문 → "미안내" 같은 글자(없으면 빈 칸)
  function exceptionRows(exceptions, needCheck, causeOf, reasonOf, contactedOn, informedOf) {
    const row = (o, status, days) => [status, days, o["주문번호"], o["품목명"], o["공급사"], o["요청자"], o["납기일"], status === "지연" ? causeOf(o) : "", reasonOf(o), (contactedOn || {})[(o["공급사"] || "").trim()] || "", status === "확인 필요" || !informedOf ? "" : informedOf(o)];
    return exceptions.map(o => row(o, o.status, o.daysLeft)).concat(needCheck.map(o => row(o, "확인 필요", "")));
  }

  const CONTACT_HEAD = ["순위", "공급사", "상태", "주문번호", "품목명", "납기", "경과(+)·남음(-) 일수", "지연 원인", "공급사 회신", "연락일"];
  function contactRows(groups, contactedOn) {
    const out = [];
    groups.forEach((g, i) => g.orders.forEach(o => out.push([i + 1, g.supplier, o.status === "확인필요" ? "확인 필요" : o.status, o.orderNo, o.item, o.due, o.status === "지연" ? o.days : o.status === "임박" ? -o.days : "", o.cause, o.noReply ? (o.reply || "회신 미확인") : "", (contactedOn || {})[g.supplier] || ""])));
    return out;
  }

  const api = { csvCell, toCsv, safeFileName, buildReport, EXC_HEAD, exceptionRows, CONTACT_HEAD, contactRows };
  if (typeof module !== "undefined") module.exports = api; else root.Report = api;
})(typeof window !== "undefined" ? window : globalThis);
