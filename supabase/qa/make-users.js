// 시험 계정 2개(A, B)를 만들 준비를 한다. 사용: node supabase/qa/make-users.js
// 1) 무작위 비밀번호로 qa-users.local.json / qa-users.local.js (QA 화면과 시험 스크립트가 읽는다)와
//    qa-users.local.sql (Supabase에 계정을 넣는 SQL)을 만든다. 모두 저장소에 올라가지 않는다(*.local.*).
// 2) qa-users.local.sql을 Supabase 대시보드 SQL Editor에서 실행하거나 Claude에게 실행을 부탁한다.
// 이미 파일이 있으면 아무것도 하지 않는다. 이메일은 @nabgi-qa.test 라서 실제 메일은 가지 않는다.
// (Supabase 가입 화면은 .test 같은 가짜 주소를 거부해서, 계정은 SQL로 직접 넣는다. 가입과는 무관해서 가입을 닫아도 된다.)
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const JSON_FILE = path.join(__dirname, "qa-users.local.json");
if (fs.existsSync(JSON_FILE)) { console.log("이미 시험 계정 파일이 있어요. 아무것도 하지 않았어요."); process.exit(0); }

const pw = () => crypto.randomBytes(18).toString("base64url") + "aA1!";
const mk = k => ({ email: "qa-" + k + "@nabgi-qa.test", password: pw(), userId: crypto.randomUUID() });
const u = { a: mk("a"), b: mk("b") };

const sql = Object.values(u).map(x =>
  `insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change) values ('00000000-0000-0000-0000-000000000000','${x.userId}','authenticated','authenticated','${x.email}',extensions.crypt('${x.password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');\n` +
  `insert into auth.identities (user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values ('${x.userId}','${x.userId}',jsonb_build_object('sub','${x.userId}','email','${x.email}','email_verified',true,'phone_verified',false),'email',now(),now(),now());`).join("\n");

fs.writeFileSync(JSON_FILE, JSON.stringify(u, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(__dirname, "qa-users.local.js"), "window.QA_USERS = " + JSON.stringify(u, null, 2) + ";\n", "utf8");
fs.writeFileSync(path.join(__dirname, "qa-users.local.sql"), sql + "\n", "utf8");
console.log("만들었어요 (저장소에는 올라가지 않아요): qa-users.local.json, qa-users.local.js, qa-users.local.sql");
console.log("다음: qa-users.local.sql을 Supabase에서 실행하세요 (README 참고).");
