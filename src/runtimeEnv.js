// 개발·E2E 테스트용 실행 환경 설정. 환경변수가 없는 일반 실행에는 아무 영향이 없다. 화면과 무관한 순수 함수.
//
// NABGI_USER_DATA  : 저장 폴더(state.json, 키 파일)를 이 절대 경로로 바꾼다. 테스트가 실제 사용자 데이터를 건드리지 않게 한다.
// NABGI_E2E=1      : E2E 모드. 반드시 NABGI_USER_DATA와 함께 써야 하고, 없으면 시작하지 않는다 (실제 데이터 보호).
// NABGI_OPEN_FILE  : E2E 모드에서만 "CSV 열기" 대화상자 대신 이 절대 경로의 파일을 연다 (대화상자는 자동화할 수 없다).
const path = require("path");

const text = v => (typeof v === "string" ? v.trim() : "");

// 저장 폴더 덮어쓰기 경로. 비어 있거나 상대 경로면 null (상대 경로는 어디를 가리키는지 모호해서 무시한다).
function userDataOverride(env) {
  const p = text(env && env.NABGI_USER_DATA);
  return p && path.isAbsolute(p) ? p : null;
}

const isE2E = env => !!env && env.NABGI_E2E === "1";

// E2E 모드인데 저장 폴더가 분리되지 않았으면 위험하다. 이 경우 앱을 시작하지 않는다.
function e2eIsSafe(env) {
  return !isE2E(env) || userDataOverride(env) !== null;
}

// E2E 모드에서만 파일 열기 우회 경로를 돌려준다. E2E가 아니면 환경변수가 있어도 무시한다.
function e2eOpenFile(env) {
  if (!isE2E(env)) return null;
  const f = text(env.NABGI_OPEN_FILE);
  return f && path.isAbsolute(f) ? f : null;
}

module.exports = { userDataOverride, isE2E, e2eIsSafe, e2eOpenFile };
