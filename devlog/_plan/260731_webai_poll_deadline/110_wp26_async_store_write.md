# 110 — WP26 check-then-synchronous-write 창 닫기 (async store write)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP26 (이 유닛의 마지막 구현 phase — c7의 잔여)
- 선행: `080_wp21_async_store_lock.md`가 프리미티브(`withStoreLockAsync`,
  `DEADLINE_PASSED`, post-lock 재검사)를 만들었고 strict artifact 경로만 이관했다
- 감사: sol-medium 3라운드 (FAIL → FAIL → NEAR-PASS, 잔여 1건 본문 반영)

## 문제

WP24가 남긴 마지막 창이다. 데드라인/`stillActive` 검사가 **블로킹 락 획득
전에** 일어나고 쓰기가 그 뒤에 온다. 락 대기가 데드라인을 넘겨도 쓰기는
그대로 착지한다. `updateSession`은 블로킹 pre-read(`session.mjs:257`)와
`patchSession` 락(`session-store.mjs:424`)을 타므로, 검사 통과 후 만료가
끼어들 틈이 구조적으로 존재한다.

확인된 check-then-write 지점 (감사 1~2라운드에서 실증):

| 경로 | 검사 | 쓰기 |
| --- | --- | --- |
| finalizer | `tab-finalizer.mjs:72-74`, `:97`, `:128` | `:78`, `:101`, `:103`, `:129` |
| ChatGPT poll | `chatgpt.mjs:938-940` 게이트 | `:1234`, `:1439`, `:1459`, `:2077` |
| Work poll | `chatgpt-work-picker.mjs:1020`, `:1042` | `:1021`, `:1043`, `:1085` |
| Gemini / Grok | 한 줄 패턴 | `gemini-live.mjs:788`, `grok-live.mjs:409` |
| Deep Research resume | `chatgpt-deep-research.mjs:494`, `:512` | `:495`, `:513` |
| watch polling 복원 | `watcher.mjs:165`, `:270`, `:697` | `:166`, `:272`, `:698` |
| tab-recovery 바인딩 | watch/resume/MCP가 진입 전 검사 | `tab-recovery.mjs:83`, `:127`, `:570`, `:635` |
| trace 영속화 | `chatgpt.mjs:1137`, `:1411` 게이트 | `trace-persistence.mjs:44-61` (블로킹 read+write) |
| artifact 기록 | finalizer/deep-research 게이트 | `session-artifacts.mjs:561-566` (동기 2경로) |
| 이미지 append | `chatgpt.mjs:1077`, `:1158` 게이트 | `chatgpt-images.mjs:272` |
| 파일 append (non-strict) | `chatgpt.mjs:2163-2167`이 predicate를 받고 **무시** | `chatgpt-files.mjs:522` |

## 계약

### 1. 프리미티브 (session-store.mjs / session.mjs)

- `patchSessionAsync` 계열: `withStoreLockAsync`로 락을 기다리고, **락을 쥔
  뒤** `stillActive`를 재검사한다. 만료면 쓰지 않고 `DEADLINE_PASSED`를
  돌려준다. 모델은 `session-artifacts.mjs:411-425`.
- `updateSessionAsync` / `markSessionTimeoutAsync`: 판정은 **락 안에서 읽은
  행**에 대해 내린다. `session.mjs:260-266`의 conversation-URL 필터와
  `:277-296`의 completed-evidence 보호를 락 안 판정으로 옮긴다.
- `stillActive`의 정의는 결합형이다 — `!token.expired && Date.now() <
  hardDeadline`. `chatgpt.mjs:947`이 템플릿이다. Gemini(`gemini-live.mjs:698`),
  Grok(`grok-live.mjs:317`), Work(`chatgpt-work-picker.mjs:952`), Deep Research
  resume(`chatgpt-deep-research.mjs:462`)은 현재 `token.expired`만 보므로 지연된
  타이머 콜백이 만료 후에도 flag를 false로 남길 수 있다.

### 2. 이관 대상 (category a — 데드라인 안의 쓰기)

1. provider poller 4종의 poll-경로 쓰기 + `markSessionTimeout` 호출부.
2. `finalizeProviderTab` 전 단계. 순서 보존이 조건이다 — complete write →
   transcript/artifact → archive → archived write → pool
   (`tab-finalizer.mjs:78`, `:89`, `:123`, `:140`). 모든 쓰기는 awaited,
   `DEADLINE_PASSED`는 즉시 short-circuit. 호출 순서 어서션을 테스트로 남긴다.
3. tab-recovery 공유 헬퍼: `recoverSessionTab`/`resolveSessionPage`가 옵션
   `stillActive` predicate를 받는다. watch(`watcher.mjs:208`),
   resume(`cli-sessions.mjs:113`, `:143`), MCP poll(`mcp-server.mjs:346`)이
   저장된 절대 `deadlineAt`에서 유도해 넘긴다. predicate가 있으면 바인딩
   쓰기는 async 프리미티브를 탄다. 명시적 `sessions reattach`
   (`cli-sessions.mjs:174`)는 동기 유지.
4. `appendTraceToSession`의 async 변형 — poll-recovery 경로
   (`chatgpt.mjs:1855-1869`)만. send-경로 trace는 동기 유지.
5. `appendArtifactRecord` — finalizer/deep-research-resume 호출부는 기존
   atomic async append(`withStoreLockAsync` + `appendSessionArtifactsLocked`)로.
6. 이미지 append(`chatgpt-images.mjs:272`)와 non-strict 파일
   append(`chatgpt-files.mjs:522`) — strict 분기의 모델을 그대로 쓴다.
7. watch의 **데드라인 유도 상태 전이**(`polling` 복원 3곳) — 락 안에서 저장된
   `deadlineAt` 재평가, 만료면 복원하지 않는다.
8. multi-turn: outer hard-deadline race를 provider poller와 같은 형태로
   씌우고, 쓰기(`chatgpt-multi-turn.mjs:175`, `:182`, `:199`, `:214`, `:217`)에
   `stillActive` 클로저를 내린다.

### 3. 면제 (명시적)

- **무조건적 outcome bookkeeping**: DOM hash/문자수 메트릭(`watcher.mjs:294`)과
  터미널 timeout/completion 결과 기록. 만료의 **기록**이지 만료와 경쟁하는
  쓰기가 아니다.
- multi-turn의 timeout/partial bookkeeping은 **outer token이 살아 있는 동안**
  유효하다. outer race 패배 후에는 bookkeeping 포함 모든 loser 쓰기가
  `DEADLINE_PASSED`다.
- category (b): 세션 생성/초기 바인딩(send 경로), prune, list/show, reattach는
  동기 유지. 130-consumer 전면 전환은 `080` 3절의 기각을 계승한다.

### 4. 잔여 (이 phase 범위 밖, 명시 이월)

- **initial `sendDeepResearch`** 쓰기(`chatgpt-deep-research.mjs:342`, `:349`,
  `:377`, `:384`): losing-run token이 없다. 자체 hard-deadline token을 받는
  별도 후속 항목. resume만 이번 대상이다.
- `readSessionStoreLocked` 자체의 동기성(`080`이 기록) — strict 우회 유지.

## 검증

| 테스트 | 반증 조건 (mutation → RED) |
| --- | --- |
| 프리미티브 post-lock 재검사 | 재검사 제거 → 저장된 세션이 결정론적으로 변한다 |
| 경합: 락 보유 중 만료 | 락을 **풀고** 패자 쓰기가 settle된 뒤 무변경 어서션 (기존 `web-ai-stalled-probe-deadline.test.mjs:205`의 락-보유-중-반환 형태 재사용 금지) |
| finalizer 호출 순서 | 순서 어서션 — complete→artifact→archive→archived→pool |
| watch transient-timeout | 락이 저장 데드라인을 넘김 → `polling` 복원 없음 |
| image/file append | 만료 후 append 시도 → `DEADLINE_PASSED`, 디스크 무변화 |
| multi-turn partial 보존 | timeout bookkeeping이 억제되지 **않음** (outer 생존 시) |
| ratchet | `gate:no-new-blocking-io` baseline 6건 유지 (`scripts/blocking-io-baseline.json:153-157`) |

확장 지점: `test/unit/web-ai-tab-finalizer.test.mjs:77-123`,
`web-ai-provider-poll-deadline.test.mjs:331-400`,
`web-ai-stalled-probe-deadline.test.mjs:180-245`.

## G4 조건 6 — 신선 재측정 (2026-08-05)

`chatgpt.com` 재확인: `/api/auth/session` `hasUser:false`, 로그인 버튼 3개.
composer 요소는 로그아웃 상태에서도 DOM에 있으므로 로그인 증거가 아니다.
**측정 불가 상태 유지** — 실제 generation 중 reload 측정은 로그인된 프로필이
생길 때까지 BLOCKED다. 로그인 조작은 이 루프의 범위 밖이다.
