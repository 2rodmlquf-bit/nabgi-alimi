const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { userDataOverride, isE2E, e2eIsSafe, e2eOpenFile } = require("../src/runtimeEnv");

const ABS = path.resolve("C:/tmp/nabgi-e2e");
const FILE = path.resolve("C:/tmp/orders.csv");

test("환경변수가 없는 일반 실행에서는 아무것도 바꾸지 않는다", () => {
  assert.equal(userDataOverride({}), null);
  assert.equal(userDataOverride(undefined), null);
  assert.equal(e2eOpenFile({}), null);
  assert.equal(isE2E({}), false);
  assert.equal(e2eIsSafe({}), true);
});

test("저장 폴더 덮어쓰기: 절대 경로만 받고, 비었거나 상대 경로는 무시한다", () => {
  assert.equal(userDataOverride({ NABGI_USER_DATA: ABS }), ABS);
  assert.equal(userDataOverride({ NABGI_USER_DATA: "  " + ABS + "  " }), ABS);   // 앞뒤 공백 제거
  assert.equal(userDataOverride({ NABGI_USER_DATA: "" }), null);
  assert.equal(userDataOverride({ NABGI_USER_DATA: "relative/dir" }), null);      // 상대 경로는 모호하다
  assert.equal(userDataOverride({ NABGI_USER_DATA: 123 }), null);                 // 문자열이 아님
});

test("E2E 모드인데 저장 폴더가 분리되지 않았으면 안전하지 않다 (실제 데이터 보호)", () => {
  assert.equal(e2eIsSafe({ NABGI_E2E: "1" }), false);
  assert.equal(e2eIsSafe({ NABGI_E2E: "1", NABGI_USER_DATA: "relative" }), false);
  assert.equal(e2eIsSafe({ NABGI_E2E: "1", NABGI_USER_DATA: ABS }), true);
  assert.equal(e2eIsSafe({ NABGI_E2E: "0" }), true);                              // "1"이 아니면 E2E가 아니다
  assert.equal(e2eIsSafe({ NABGI_USER_DATA: ABS }), true);                        // 저장 폴더만 바꾸는 것은 언제나 안전
});

test("파일 열기 우회는 E2E 모드에서만 동작한다", () => {
  assert.equal(e2eOpenFile({ NABGI_OPEN_FILE: FILE }), null);                      // E2E가 아니면 환경변수가 있어도 무시
  assert.equal(e2eOpenFile({ NABGI_E2E: "1", NABGI_OPEN_FILE: FILE }), FILE);
  assert.equal(e2eOpenFile({ NABGI_E2E: "true", NABGI_OPEN_FILE: FILE }), null);   // 정확히 "1"만
  assert.equal(e2eOpenFile({ NABGI_E2E: "1" }), null);                             // 파일 경로가 없음
  assert.equal(e2eOpenFile({ NABGI_E2E: "1", NABGI_OPEN_FILE: "orders.csv" }), null); // 상대 경로 거부
});

const ABS_FILE = path.resolve("C:/tmp/a.json");
test("NABGI_SAVE_FILE과 NABGI_E2E_HIDDEN은 E2E 모드에서만, 절대 경로일 때만 쓰인다", () => {
  const R = require("../src/runtimeEnv");
  assert.equal(R.e2eSavePath({ NABGI_SAVE_FILE: ABS_FILE }), null);                                   // E2E가 아니면 무시
  assert.equal(R.e2eSavePath({ NABGI_E2E: "1", NABGI_USER_DATA: ABS, NABGI_SAVE_FILE: "상대/경로.json" }), null);
  assert.equal(R.e2eSavePath({ NABGI_E2E: "1", NABGI_USER_DATA: ABS, NABGI_SAVE_FILE: ABS_FILE }), ABS_FILE);
  assert.equal(R.e2eHidden({ NABGI_E2E_HIDDEN: "1" }), false);
  assert.equal(R.e2eHidden({ NABGI_E2E: "1", NABGI_USER_DATA: ABS, NABGI_E2E_HIDDEN: "1" }), true);
});
