# Supabase 연습용 프로젝트 (nabgi-practice)

데이터베이스 설계는 `docs/erd.md`, `docs/DB_PLAN.md`, 결정은 `docs/adr/0001~0005`. 이 폴더는 **연습용 프로젝트**(ADR-0003)에 실제로 적용한 SQL을 보관한다. 업무용 프로젝트는 보안 승인 뒤에 따로 만든다.

## 현재 상태 (2026-10-20)

| 항목 | 값 |
|---|---|
| 프로젝트 이름 | `nabgi-practice` (지역: 서울 `ap-northeast-2`, 무료 플랜 0원) |
| 만든 계정 | 2rodmlquf@naver.com 의 Supabase 조직 (Supabase 연결이 이 계정으로 바뀐 상태에서 생성) |
| 표 | 8개 (`inform_logs`, `quick_notes`, `substitute_checks`, `schedule_entries`, `supplier_contact_logs`, `order_meta`, `supplier_contact_marks`, `user_settings`), 모두 RLS 켜짐, 행 0개 |
| 보안 점검 | Supabase 보안 점검(advisors) **문제 0건** |
| 아직 안 한 것 | 앱 연결 코드, 로그인 계정 만들기, 가입 닫기·이메일 확인 끄기(화면에서 직접), 로컬 저장 형식 v2 |

프로젝트 주소(URL)와 키는 이 저장소에 적지 않는다(코드가 아닌 설정으로 받는다, ADR-0003·0005). `service_role` 키는 앱·저장소 어디에도 넣지 않는다.

## 적용한 마이그레이션 (순서대로)

| 파일 | 내용 |
|---|---|
| `migrations/20261020022201_create_nabgi_core_tables.sql` | 표 8개, 글자 수·값 범위 제약, 삭제 표시 일관성 제약, 인덱스 |
| `migrations/20261020022215_secure_nabgi_core_tables.sql` | RLS(본인 행만), anon 차단, 쌓는 기록은 지우기 금지·삭제 표시 열만 수정 가능, 현재 값 표는 최신 `updated_at`이 이기는 트리거 |

두 파일은 Supabase에 적용한 것과 글자 그대로 같다. 새 프로젝트(업무용 등)를 만들면 같은 순서로 적용한다.

## DB가 강제하는 규칙 (앱이 알아야 할 것)

- `user_id`는 보내지 않는다. DB가 로그인한 사용자로 채운다(`default auth.uid()`).
- 쌓는 기록 5개는 **새 행 넣기(insert)** 와 **삭제 표시(`deleted_at`, `deleted_reason` 두 열만 수정)** 만 된다. 다른 열 수정과 지우기는 거부된다. 그래서 올리기는 "새 행은 넣고(이미 있으면 건너뜀), 삭제 표시는 따로 수정"으로 해야 한다. 한 번에 통째로 덮어쓰는 업서트는 안 된다.
- 현재 값 3개는 읽기·넣기·수정만 된다(지우기 없음). 더 오래된 `updated_at`으로 수정하면 조용히 무시된다.
- 로그인하지 않은 요청(anon)은 어떤 표도 읽거나 쓰지 못한다.

## 화면(대시보드)에서 직접 해야 하는 것

Supabase 연결(커넥터)에는 로그인 설정을 바꾸는 기능이 없다. 아래는 사용자가 직접 한다.

1. **이메일 확인 끄기**: 대시보드 → Authentication → Sign In / Providers (주소 형태 `/dashboard/project/<프로젝트>/auth/providers`) → Email → "Confirm email" 끄기. (Supabase 문서가 이 화면에서 바꾼다고 안내한다.)
2. **가입 닫기**: 같은 Authentication 설정 화면에서 "Allow new users to sign up" 끄기. (정확한 항목 이름은 확인하지 못했다. 화면에서 가입 허용 관련 스위치를 찾는다.)
3. **로그인 계정 1개 만들기**: Authentication → Users → Add user → Create new user. 이메일과 비밀번호를 정하고 **자동 확인(Auto Confirm)** 을 체크한다. 비밀번호는 대화창이나 저장소에 적지 않는다.
