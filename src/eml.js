// .eml(메일 파일) 읽기. 제목·보낸 사람·날짜·본문을 꺼낸다. 메인 프로세스(Node)에서만 쓴다.
// 지원: RFC2047 제목(=?UTF-8?B?...?=), base64·quoted-printable 본문, multipart, HTML 본문 글자만 추출,
//       UTF-8 / EUC-KR(CP949) 글자 인코딩, 답장에 딸려 온 원문(인용) 잘라내기.

const CHARSETS = { "ks_c_5601-1987": "euc-kr", cp949: "euc-kr", "x-windows-949": "euc-kr", "ks_c_5601": "euc-kr", "us-ascii": "utf-8", "iso-8859-1": "windows-1252", latin1: "windows-1252" };

function decodeText(buf, charset) {
  const cs = String(charset || "utf-8").trim().replace(/^"|"$/g, "").toLowerCase();
  try { return new TextDecoder(CHARSETS[cs] || cs).decode(buf); } catch (e) { return Buffer.from(buf).toString("utf8"); }
}

function decodeQP(str) {
  const s = String(str).replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(s.charCodeAt(i) & 255);
  }
  return Buffer.from(out);
}

// 헤더 값(제목 등)의 =?charset?B/Q?...?= 부분을 풀어 쓴다.
function decodeWords(v) {
  const joined = String(v || "").replace(/\?=\s+=\?/g, "?==?"); // 붙어 있는 인코딩 조각 사이의 공백 제거
  const hasEncoded = /=\?[^?]+\?[bBqQ]\?[^?]*\?=/.test(joined);
  if (!hasEncoded) {
    // 인코딩 표시 없이 8비트 글자가 그대로 들어온 경우(UTF-8로 보고 되살린다)
    if (/[\u0080-ÿ]/.test(joined)) { const u = Buffer.from(joined, "latin1").toString("utf8"); if (!u.includes("�")) return u; }
    return joined;
  }
  return joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, txt) =>
    decodeText(enc.toUpperCase() === "B" ? Buffer.from(txt, "base64") : decodeQP(txt.replace(/_/g, " ")), cs));
}

function splitHeadBody(s) {
  const m = /\r?\n\r?\n/.exec(s);
  return m ? { head: s.slice(0, m.index), body: s.slice(m.index + m[0].length) } : { head: s, body: "" };
}

function parseHeaders(head) {
  const map = new Map();
  head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach(line => {
    const i = line.indexOf(":");
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!map.has(k)) map.set(k, line.slice(i + 1).trim()); }
  });
  return map;
}

function parseParams(v) {
  const s = String(v || "");
  const value = s.split(";")[0].trim();
  const params = {};
  const re = /([\w*]+)\s*=\s*(?:"([^"]*)"|([^;\s]+))/g;
  let m;
  while ((m = re.exec(s.slice(s.indexOf(";") + 1 || s.length)))) params[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return { value, params };
}

// 첨부 파일 이름: filename*=UTF-8''%EB... (RFC2231) 또는 filename="=?UTF-8?B?...?=" 또는 평범한 이름
function attachmentName(params) {
  if (params["filename*"]) {
    const m = /^([^']*)'[^']*'(.*)$/.exec(params["filename*"]);
    if (m) return decodeText(decodeQP(m[2].replace(/%/g, "=")), m[1] || "utf-8");
  }
  return decodeWords(params.filename || params.name || "");
}

function splitMultipart(body, boundary) {
  const parts = body.split("--" + boundary);
  parts.shift(); // 첫 조각은 안내 문구라 버린다
  return parts.filter(p => !p.startsWith("--")).map(p => p.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
}

function collect(s, out) {
  const { head, body } = splitHeadBody(s);
  const h = parseHeaders(head);
  const ct = parseParams(h.get("content-type") || "text/plain");
  const type = ct.value.toLowerCase();
  if (type.startsWith("multipart/") && ct.params.boundary) { splitMultipart(body, ct.params.boundary).forEach(p => collect(p, out)); return; }
  const enc = String(h.get("content-transfer-encoding") || "7bit").trim().toLowerCase();
  const bytes = enc === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : enc === "quoted-printable" ? decodeQP(body) : Buffer.from(body, "latin1");
  const disp = parseParams(h.get("content-disposition") || "");
  const fname = attachmentName({ ...ct.params, ...disp.params });
  // 첨부: 글자 본문이 아닌데 파일 이름이 있거나 attachment로 표시된 것. 엑셀(.xlsx)·CSV만 꺼내 둔다(공급사가 보낸 표).
  if (disp.value.toLowerCase() === "attachment" || (fname && type !== "text/plain" && type !== "text/html")) {
    if (/\.(xlsx|csv)$/i.test(fname)) out.attachments.push({ filename: fname, data: bytes });
    return;
  }
  if (type !== "text/plain" && type !== "text/html") return;
  (type === "text/html" ? out.html : out.plain).push(decodeText(bytes, ct.params.charset));
}

function htmlToText(html) {
  return String(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

// 답장·전달 메일에 딸려 오는 원문(옛 날짜가 섞여 있어 납기를 헷갈리게 한다)을 잘라 낸다.
function stripQuoted(text) {
  const lines = String(text).split(/\r?\n/);
  const cut = lines.findIndex(l => /^\s*(-{2,}\s*(original message|원본 메시지|forwarded message)|_{5,}\s*$|on .{5,}wrote:\s*$|보낸\s?사람\s*:|from\s*:\s*\S)/i.test(l));
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter(l => !/^\s*>/.test(l));
  return kept.join("\n").trim();
}

function parseEml(buffer) {
  const s = Buffer.from(buffer).toString("latin1"); // 바이트를 1:1로 문자열에 옮겨 구조를 읽고, 본문은 다시 바이트로 되돌려 풀어 쓴다
  const { head } = splitHeadBody(s);
  const h = parseHeaders(head);
  const out = { plain: [], html: [], attachments: [] };
  collect(s, out);
  const raw = out.plain.join("\n\n").trim() ? out.plain.join("\n\n") : htmlToText(out.html.join("\n"));
  let date = null;
  const d = new Date(h.get("date") || "");
  if (!isNaN(d)) date = d.toISOString();
  return { subject: decodeWords(h.get("subject") || ""), from: decodeWords(h.get("from") || ""), date, body: stripQuoted(raw), attachments: out.attachments };
}

module.exports = { parseEml, decodeWords, stripQuoted, htmlToText, decodeText };
