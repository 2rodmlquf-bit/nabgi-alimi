# 개발 환경과 기준선 (Phase 0)

작성: 2026-10-19 · 근거: `납기-문제정의/devpian.md` Phase 0 (T0.1~T0.10)

## 1. 환경

| 항목 | 버전·값 |
|---|---|
| 운영체제 | Windows 11 Pro 10.0.26200 |
| Node.js | v24.19.0 (내장 `WebSocket`, `fetch` 사용 가능) |
| npm | 11.17.0 |
| Electron | 44.7.0 |
| electron-builder | 26.15.3 |
| git | 2.55.0.windows.3 |

### 명령

| 하는 일 | 명령 |
|---|---|
| 의존성 설치 | `npm ci` |
| 앱 실행 | `npm start` 또는 `납기알리미-실행.bat` |
| 자동 테스트 | `npm test` |
| E2E (화면까지 실제 앱으로) | `npm run test:e2e` (시나리오 8개, 약 5분). 일부만: `node e2e/run.js --only S-02` |
| E2E 안전 점검 | `npm run probe:e2e-safety` |
| 저장 파일 이전 리허설 | `node tools/migration-rehearsal.js [예전 형식 저장 파일]` (복사본으로만 시험, 원본은 읽기만) |
| 설치 파일 만들기 | `npm run dist` (결과 `dist/`, 약 111MB, 저장소에는 넣지 않음) |
| 화면 캡처 | `tools/capture.js` 머리말 참고 |

### 확인 못 한 것 (Phase 8에서 확인)

- **새 PC에서 `npm ci`가 끝까지 되는지.** 이 PC에서는 `npm ci --dry-run`이 "up to date"로 잠금 파일과 일치함을 확인했다. 다만 npm 11이 `electron-winstaller`의 설치 스크립트가 `allowScripts`에 등록되지 않았다고 경고한다. 패키징(`npm run dist`)에 영향을 줄 수 있다. 새 환경에서 `electron --version`과 `npm run dist`를 직접 해 봐야 한다.

## 2. 기준선

| 항목 | 값 |
|---|---|
| 기준 태그 | `baseline-v0.4.0-informed` (커밋 `2c2dbbe`) |
| 기준 테스트 | **141개 통과** (약 0.3초) |
| Phase 0에서 추가 | `test/runtimeEnv.test.js` 4개 → 145개 |
| Phase 2 끝 | 단위 **222개** 통과 (저장 모델 17, 저장소 계약 22, 로컬 파일 저장소 13, 열 추측 7 등 포함). E2E 시나리오 8개 |

## 3. 개발·테스트용 환경변수

환경변수가 없는 **일반 실행에는 아무 영향이 없다.** 구현은 `src/runtimeEnv.js`, 적용은 `main.js` 맨 위와 `open-csv` 처리기.

| 변수 | 뜻 |
|---|---|
| `NABGI_USER_DATA` | 저장 폴더(`state.json`, API 키 파일)를 이 **절대 경로**로 바꾼다. 상대 경로와 빈 값은 무시한다 |
| `NABGI_E2E=1` | E2E 모드. **`NABGI_USER_DATA`가 없으면 앱이 시작하지 않는다** (종료 코드 1). 실제 데이터를 지키는 안전장치 |
| `NABGI_OPEN_FILE` | E2E 모드에서만, "CSV 열기" 대화상자 대신 이 절대 경로의 파일을 연다 |

화면 조작은 앱을 `--remote-debugging-port=<포트>`로 띄우고 Chrome DevTools Protocol로 한다 (`tools/e2e-safety-probe.js` 참고).

## 4. 실제 사용자 데이터 (개발 중 건드리지 않는다)

- 위치: `%APPDATA%\delivery-watch\state.json`
- 2026-10-19 확인 당시: 884바이트, 마지막 수정 2026-10-12 16:35, 해시 앞 16자 `96b7d3ee927196af`
- `npm run probe:e2e-safety`가 앞뒤 지문을 비교해 **바뀌지 않았는지** 확인한다. 이번 Phase 0 점검 결과: 바뀌지 않았다.
- 2026-10-19 백업: `.backup/state.v0.2026-10-19.json` (git이 무시하는 폴더). 이 백업의 복사본으로 새 저장소를 시험했다 (`tools/migration-rehearsal.js`, 모두 통과). **실제 파일은 새 버전을 처음 실행할 때 앱이 직접 이전한다** (원본을 `state.v0.bak.json`으로 먼저 보관). 저장 파일의 모양과 동작은 `docs/DATA_MODEL.md`.

## 5. 브랜치와 커밋 규칙

- 브랜치: `main` + 기능별 `feat/FR-12-quick-memo`, `fix/…`, `docs/…`. 혼자 작업하므로 PR은 쓰지 않고 병합 전 체크리스트(`devpian.md` 14절)로 점검한다.
- 커밋 메시지: `FR-12: 빠른 메모 추가`처럼 **요구사항 번호를 앞에 붙인다.** 요구사항과 무관한 작업은 `infra:`, `docs:`, `tools:`, `fix:`.
- 한 커밋은 한 가지 일만 한다.
- 기존 테스트를 지우거나 약하게 바꾸지 않는다. 바꿔야 하면 이유를 커밋 메시지에 쓴다.
- 이 저장소에서는 `core.autocrlf=false`, `core.quotepath=false`로 두었다 (줄바꿈 변환 경고와 한글 경로 깨짐 방지).

## 6. 계획 문서 (동결)

계획 문서는 이 저장소 밖 `납기-문제정의/`에 있고 **v0.1로 동결**한다. 내용을 바꾸면 버전을 올리고 변경 이력에 적는다.

| 문서 | 버전 |
|---|---|
| `prd.md` | v0.1 |
| `IA.md`, `uj.md` | v0.1 |
| `devpian.md` | v0.1 |
| `root_cause.md`, `list_solutions.md`, `raw_problem.md` | 2026-10-19 |
