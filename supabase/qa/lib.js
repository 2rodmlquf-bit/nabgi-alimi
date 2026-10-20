// Supabase QA 공용 도구 (Node). 프로젝트 주소·공개 키·시험 계정은 저장소에 없고 이 폴더의 *.local.* 파일(저장소 제외)에서 읽는다.
//   qa-config.local.json   { url, key }            프로젝트 주소와 공개(publishable) 키
//   qa-users.local.json    { a: {email,password}, b: {...} }   시험 계정 (setup-users.js가 만든다)
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const read = f => {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) throw new Error(f + " 파일이 없어요 (supabase/qa/README.md의 준비 순서를 보세요)");
  return JSON.parse(fs.readFileSync(p, "utf8"));
};
const config = () => read("qa-config.local.json");
const users = () => read("qa-users.local.json");

// Supabase REST 호출. token을 안 주면 로그인하지 않은 요청(anon)이다.
async function api(p, { method = "GET", token, body, headers = {} } = {}) {
  const c = config();
  const res = await fetch(c.url + p, {
    method,
    headers: { apikey: c.key, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* JSON이 아닌 응답 */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function signIn(email, password) {
  const r = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  if (r.status !== 200) throw new Error("로그인 실패 (" + email + "): " + r.status + " " + r.text.slice(0, 160));
  return { token: r.json.access_token, userId: r.json.user.id, email };
}

const uuid = () => crypto.randomUUID();
// 같은 글자에서는 항상 같은 UUID (시험 데이터를 다시 넣어도 중복되지 않게)
const stableUuid = s => { const h = crypto.createHash("sha1").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

module.exports = { config, users, api, signIn, uuid, stableUuid };
