# 데이터 모델 v1과 저장소 (Phase 2)

작성: 2026-10-19 · 근거: `납기-문제정의/devpian.md` Phase 2, 코드 `src/store/`

## 1. 한눈에

```
 화면(renderer)  ──  뷰(view): 지금까지 쓰던 평평한 모양
       │                { edited, reasons, causeOverride, notice, contacted, contactLog,
       │                  informed, subst, schedule, soonRules }
       │  IPC (state-load / state-save / state-clear / state-info)  ← 이름과 모양은 예전 그대로
       ▼
 메인 프로세스 ── createStore({ mode: "local", dir }) ──► 저장소 (LocalFileStore)
                                                        │  뷰 <-> 상태(state) 변환: src/store/core.js
                                                        ▼
                                                   state.json (v1)
```

- 화면은 **저장 방식을 모른다.** 저장소 인터페이스(`load/save/clear/info`)만 안다. 저장 방식을 바꿀 때는 `createStore`의 `mode`만 바꾼다.
- 저장소가 하는 일: 읽기, 예전 형식 이전과 백업, 손상 파일 보관, 상한 검사, 임시 파일 후 교체, 동작을 차례로 처리.
- 변환 로직(`core.js`)은 파일·DB와 무관한 순수 함수라서 로컬 파일 저장소와 (나중의) Supabase 저장소가 똑같이 쓴다.

## 2. 저장 파일 `state.json` (v1)

```json
{
  "schemaVersion": 1,
  "savedAt": "2026-10-19T08:47:52.767Z",
  "informLog": {
    "PO-2026-1001": [
      { "id": "c1140393-…", "date": "2026-10-12", "channel": "전화", "status": "지연",
        "due": "2026-09-24", "note": "…", "createdAt": "2026-10-12T12:00:00.000Z", "deletedAt": "2026-10-19T08:47:52.767Z" }
    ]
  },
  "quickNotes": { "PO-2026-1001": [ { "id": "…", "text": "…", "createdAt": "…" } ] },
  "orderMeta":  { "PO-2026-1002": { "reason": "통관 서류 보완", "causeOverride": "통관·서류", "edited": { "from": "…", "to": "…" }, "updatedAt": "…" } },
  "settings":   { "notice": { "template": "공지형", "alt": "", "signature": "…" }, "soonRules": "필터=3", "updatedAt": "…" },
  "legacy":     { "contacted": {}, "contactLog": {}, "subst": {}, "schedule": {} }
}
```

| 영역 | 내용 | 규칙 |
|---|---|---|
| `informLog` | 연구원 안내 기록. 주문번호별 목록 | **append-only.** 기록은 고치지 않는다. 취소는 지우지 않고 `deletedAt`을 채운다. 상태는 `지연`·`임박`·`확인필요` |
| `quickNotes` | 빠른 메모 (Phase 3) | 화면이 쓴다 (FR-12). 주문당 살아 있는 메모 50건·300자, 지우면 `deletedAt` 표시 |
| `orderMeta` | 사유, 원인 직접 지정, 납기 변경 | 바뀐 주문만 `updatedAt`이 갱신된다 |
| `settings` | 안내문 선택·서명, 품목별 임박 기준 | 바뀔 때만 `updatedAt` 갱신 |
| `legacy` | 공급사 연락 기록, 대체품, 분납 일정 | S1 범위 밖 기능. **구조를 바꾸지 않고 그대로 보존**한다 |

### 한도

| 항목 | 값 | 이유 |
|---|---|---|
| 주문당 살아 있는 안내 기록 | 최근 50건 | 예전과 같은 제한. 넘치면 오래된 것부터 삭제 표시 |
| 주문당 삭제 표시 | 최근 100건 | 파일이 끝없이 커지지 않게 |
| 메모 길이 | 300자 | |
| 저장 글자 수 | 2,000,000자 | 예전과 같은 제한. 넘으면 저장을 거부하고 기존 내용 유지 |

## 3. 화면은 안내 기록 "취소"를 어떻게 남기나

화면(`informed.js`)은 예전 그대로 기록 목록에서 **빼기만** 한다. 저장소가 이전 상태와 비교해서 다음을 한다 (`core.fromView`).

- 뷰에 있는 기록의 `id`가 저장된 살아 있는 기록과 같으면 → 그대로 둔다 (기록은 고치지 않는다)
- 뷰에 새 기록이 있으면 → 새 `id`(UUID)와 `createdAt`을 붙여 추가
- 저장된 살아 있는 기록이 뷰에서 빠졌으면 → **`deletedAt`을 채운다** (삭제 흔적)
- 화면으로 돌려줄 때(`core.toView`)는 삭제된 기록을 **빼고** 살아 있는 것만 `id`·`createdAt`과 함께 준다

> `devpian.md`의 T2.3은 `informed.js`의 `append`/`undo`를 `deletedAt` 방식으로 바꾸라고 했지만, 위처럼 **저장소가 차이를 알아채게** 해서 화면 코드를 바꾸지 않고 같은 결과(삭제 흔적, 규칙은 삭제된 기록을 무시)를 얻었다. 변경이 작고 기존 테스트가 그대로 지켜진다.

## 4. 예전(v0) 형식 이전

버전 표시(`schemaVersion`)가 없는 파일이 v0다. 앱을 열 때 저장소가 한 번만 이전한다.

1. 원본을 **그대로** `state.v0.bak.json`으로 복사한다. 이미 있고 내용이 같으면 그대로 쓰고, **다르면 덮어쓰지 않고** `state.v0.bak-<시각>.json`으로 만든다.
2. 새 형식으로 바꾼다. 안내 기록에는 `id`를 붙이고 `createdAt`은 기록한 날짜의 정오(실제 시각을 모른다)로 둔다.
3. 임시 파일에 쓴 뒤 이름을 바꿔 `state.json`을 교체한다.
4. 화면에 알린다: "저장 파일을 새 형식으로 바꿨어요. 예전 파일은 state.v0.bak.json으로 보관했어요."

**여러 번 열어도 결과가 같다.** 이미 v1이면 아무것도 하지 않고, id도 바뀌지 않는다.

## 5. 문제가 있을 때의 동작

원칙: **읽을 수 없다고 빈 상태로 덮어쓰지 않는다.**

| 상황 | 동작 | 화면에 알림 |
|---|---|---|
| 파일이 없다 | 빈 상태로 시작. 파일을 만들지 않는다 (읽기만으로는 쓰지 않음) | 없음 |
| JSON이 깨졌다 / 빈 파일 / 배열 등 | 파일을 `state.corrupt-<시각>.json`으로 **옮겨 보관**하고 빈 상태로 시작 | "저장 파일을 읽지 못해 새로 시작했어요. 손상된 파일은 그대로 보관했어요: …" |
| 더 새로운 버전(`schemaVersion` > 1) | **읽기 전용.** 저장·삭제를 거부, 파일은 한 글자도 안 바꾼다 | "…새로운 버전에서 만든 저장 파일이에요. 내용을 지키려고 저장하지 않고 읽기만 해요." |
| 파일을 열 수 없다 (권한, 폴더가 이름을 차지 등) | 읽기 전용 | "저장 파일을 열지 못했어요(…). 내용을 지키려고 저장하지 않아요." |
| 백업을 못 만들었다 | 이전하지 않는다. 내용은 읽어 오되 읽기 전용 | "…백업을 만들지 못해 새 형식으로 바꾸지 않았어요…" |
| 새 형식으로 쓰지 못했다 | 원본은 그대로. 내용은 읽어 오되 읽기 전용 | "…새 형식으로 바꾸지 못했어요…. 예전 파일은 그대로예요." |
| 저장이 실패했다 | 기존 파일과 메모리의 내용은 그대로 | 저장 실패 이유 |
| 저장 내용이 한도를 넘었다 | 저장 거부, 기존 내용 유지 | "저장할 내용이 너무 큽니다." |

읽기 전용일 때도 사용자는 자기 데이터를 **볼 수 있다.** 저장만 막는다.

## 6. 디스크에 생기는 파일

| 파일 | 뜻 | 지우나 |
|---|---|---|
| `state.json` | 현재 저장 파일 (v1) | "저장 기록 지우기"로 지운다 |
| `state.json.tmp` | 저장 중에만 있는 임시 파일. 다 쓴 뒤 이름을 바꿔 교체하므로, 저장 도중 꺼져도 기존 파일이 남는다 | 자동 |
| `state.v0.bak.json` (`-<시각>`) | 예전 형식 파일의 원본 사본 | **자동으로 지우지 않는다** |
| `state.corrupt-<시각>.json` | 읽을 수 없어서 치워 둔 파일 | **자동으로 지우지 않는다** |

위치: `%APPDATA%\delivery-watch\` (Electron의 캐시 파일도 같은 폴더에 생긴다). 암호화하지 않는다.

## 7. 저장소 인터페이스와 계약

```
load()     -> { view, notices: [{ level, code, message }], readOnly }
save(view) -> { ok: true } | { ok: false, error }
clear()    -> { ok: true } | { ok: false, error }
info()     -> { kind, notices, readOnly, ... }
```

- 모두 Promise를 돌려준다 (나중의 DB 저장소가 비동기이므로 지금부터 비동기).
- 같은 저장소에 대한 동작은 **차례로** 처리된다. 저장을 연달아 요청해도 순서가 지켜진다.
- **계약 테스트**(`test/store.contract.test.js`)가 이 행동을 `MemoryStore`와 `LocalFileStore` 양쪽에 똑같이 시험한다. 새 저장소를 만들면 그 파일의 `factories`에 한 줄을 더해 통과시킨다.
- 팩토리: `createStore({ mode })`. 지금은 `local`, `memory`. 모르는 방식은 이유를 알려 주며 거부한다.

## 8. Supabase로 옮길 때 (Phase 10 미리보기)

저장소 구현체만 `SupabaseStore`로 바꾸면 화면은 그대로다. 대응은 아래와 같다. (Supabase의 기능·제한·가격은 착수할 때 공식 문서로 다시 확인한다.)

| v1 상태 | 테이블(초안) | 메모 |
|---|---|---|
| `informLog` | `inform_logs` (id uuid pk, user_id, order_no, logged_on, channel, status, due, note, created_at, deleted_at) | `id`가 이미 UUID라 올리기를 **멱등**(upsert)으로 할 수 있다. `deleted_at`이 삭제를 전달한다 |
| `quickNotes` | `quick_notes` | 같은 방식 |
| `orderMeta` | `order_meta` (pk: user_id + order_no) | `updated_at`이 가장 최근인 쪽이 이긴다 (last-write-wins) |
| `settings` | `user_settings` (jsonb) | 같은 방식 |
| `legacy` | (옮기지 않음) | S1 범위 밖 |

미리 만들어 둔 준비: 고유 `id`, `createdAt`/`updatedAt`/`deletedAt`, 비동기 인터페이스, `schemaVersion`과 이전 규칙, 계약 테스트.
회사 업무 데이터를 외부 클라우드에 올리는 것은 보안 승인이 필요하다 → `DECISIONS.md` G-6. 최소 데이터 원칙(안내 기록·메모·설정만, 주문 원본은 올리지 않음)을 지킨다.

## 9. 다음에 바꿀 때

- 모양을 바꾸면 `schemaVersion`을 올리고 `core.js`에 이전 함수를 더한다. 옛 파일은 **백업 후** 이전한다.
- 화면이 새 데이터를 저장해야 하면(예: 빠른 메모): 뷰에 필드를 더하고 `core.toView`/`fromView`에서 상태의 해당 영역과 이어 준다. `quickNotes`(Phase 3)가 그 예다. 화면에서 방금 만든 기록은 id가 없으므로 저장소가 내용·시각이 같은 기존 기록과 맞춰 본다(`mergeList`).
- 한도나 규칙을 바꾸면 `test/storeCore.test.js`가 먼저 실패하도록 시험을 고치고 시작한다.
