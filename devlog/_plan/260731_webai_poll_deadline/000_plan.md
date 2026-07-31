# 260731 — web-ai 폴링 데드라인 계약 (이슈 #88)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- branch: `dev`
- class: C4 (런타임 계약 변경, 세션 상태와 탭 수명주기에 영향)
- 선행: `devlog/_fin/260731_pr89_issue_triage/021_stall_boundary_map.md`

## 문제

이슈 #88: `agbrowse web-ai` 폴링이 `--timeout`을 넘겨도 반환하지 않는다. 프로세스와
세션 락은 살아 있고 stderr 하트비트만 멎는다.

원인은 단일 버그가 아니다. `pollWebAi`가 데드라인을 루프 경계에서만 확인하는데,
그 안에서 호출하는 것들이 상한 없이 블로킹된다. 선행 유닛이 경계 표본 36개를
확인했고 그중 bounded인 것은 **하나도 없다**.

## 왜 열거가 아니라 계약인가

선행 유닛이 경계를 22개 → 34개로 두 번 세었고 두 번 다 감사에서 반증됐다.
이유는 `021` §0에 있다.

- 호출 그래프가 `web-ai/` 밖 `skills/browser/`의 탭 관리·CDP 연결·HTTP 폴링까지
  뻗는다.
- `deps.getPage`/`deps.getCdpSession`은 **주입 지점**이라 지금 구현을 다 세어도
  다음 구현에서 새 경계가 생긴다.
- Playwright의 `page.evaluate`·`locator.all()`·`CDPSession.send` 모두 timeout
  옵션이 없다.

따라서 이 유닛은 경계를 더 세지 않는다. **진입점에서 예산을 강제해 하위가 무엇을
하든 반환을 보장**한다.

## 계약 (021 §0)

세 요소를 모두 만족해야 "반환 보장"이라고 말할 수 있다.

1. **Sync isolation** — 동기 IO를 제거하거나 격리한다. 동기 구간이 event loop를
   막으면 타이머 자체가 안 돌아 나머지 둘의 전제가 무너진다.
2. **Late-side-effect fencing** — 데드라인 이후에는 session·artifact·tab 상태를
   바꾸지 않는다. `Promise.race`는 패배한 실행을 취소하지 않으므로, timeout을
   반환한 뒤에도 원래 실행이 살아서 부수효과를 일으킨다.
3. **Single-flight** — 패배한 작업이 누적돼 프로세스를 붙잡지 않는다.

수용 기준: **데드라인 이후 부수효과 없음**, **패배한 작업이 프로세스를 붙잡지
않음**.

## 모델 선택 (WP1이 결정)

후보는 셋이다 — in-process, worker thread, subprocess. 아래는 in-process와
격리 계열의 대비이며, worker/subprocess 구분은 `010`의 probe 표가 다룬다.

| | in-process | 격리(worker/subprocess) |
| --- | --- | --- |
| sync isolation | 동기 IO를 하나씩 async로 옮기거나 제거 | 부모가 watchdog으로 종료 — 개별 수정 불필요 |
| fencing | 데드라인 이후 mutation을 게이트하는 코드 필요 | 자식 종료로 자동 |
| single-flight | 취소·drain 구현 필요 | 자식 종료로 자동 |
| 위험 | 놓친 동기 IO 하나가 계약을 깬다 | 프로세스 경계 도입, deps 직렬화, 디버깅 난이도 |
| 범위 | `web-ai/` + `skills/browser/` 다수 파일 | 진입점 + 워커 래퍼 |

**WP1이 세 후보(in-process / worker / subprocess)를 비교해 하나를 고른다.** 이 선택이 이후 모든 work-phase를
규정하므로 첫 작업이다. 자매 유닛(`artifact/finalizer`)도 같은 모델을 써야 하니
결과를 양쪽에 기록한다.

### 착수 시점의 관측

선택을 미리 정하지 않되, 다음은 확인된 사실이다.

- `observeAssistantResponse`가 `AbortSignal`을 받는다
  (`web-ai/chatgpt-response-observer.mjs:78-84`). **취소 선례가 아니다** —
  소비자 race일 뿐 `evalP`는 살아남고, 현재 poll 호출(`chatgpt.mjs:627-630`)은
  signal을 넘기지도 않는다. in-process 모델 한계의 실물 예시다.
- **CLI 세션 경로**는 하나의 사슬로 모인다. `runBoundCommand`(`web-ai/cli.mjs:1254`)가
  `withSessionCommandLock` → `withCommandSessionPage` → `withWebAiActiveCommand`
  3중 래퍼를 거쳐 `deps`를 조립한다(`:1259-1277`). 예산을 끼울 자리가 명확하다.
- 반대로 `withSessionCommandLock`(`web-ai/session-store.mjs:273`) 자체가
  `Atomics.wait` 기반 동기 블로킹이다(`:250-256`). **B18/B19(`withStoreLock`)와는
  다른 경계**이며 021 표본에 없다 — 진입점 락이라 WP3가 소유한다. 그 동안에는
  타이머가 안 돌므로 바깥에서 race를 걸어도 소용없다.

## 담당 경계 (021 7절 유닛 A)

B01~B09, B11, B12, B13, B26, B27, B29 — 15개.

답변 읽기와 완료 판정 경로다. 이 중 **fail-open 둘**이 특히 중요하다.

| 경계 | 현재 동작 | 위험 |
| --- | --- | --- |
| B03 `readActivityState` | catch → `{strength:'none'}` | `'none'`이 quiet으로 읽혀 완료 분기로 간다 — 정체가 조용한 완료로 위장 |
| B06 `doesAssistantFollowUser` | 비-`false` → `true` | 정체가 "순서 정상"으로 통과 |

둘 다 정체가 **지연이 아니라 틀린 결론**을 만든다. 예산 계약과 독립적으로 고쳐야
한다 — 예산을 씌워도 틀린 결론은 그대로다.

## work-phase

| WP | 내용 | 선행 |
| --- | --- | --- |
| WP1 | 예산 계약 모델 선택 + canonical owner 확정 + 프리미티브 설계 | — |
| WP2 | fake timer 하네스 — 시계와 타이머를 함께 주입 | WP1 |
| WP3 | **진입점 배선** — 여섯 경로 전부에 예산 전파 + pre-poll 구간 넷 처방 | WP1, WP2 |
| WP4 | 데드라인 안 읽기 경로 (B01, B02, B07) + `countAssistantMessages` 계약 | WP2, WP3 |
| WP5 | 완료 판정 경로 (B03, B04, B05, B06) — fail-open 교정 | WP4 |
| WP6 | 데드라인 후 경로 (B09, B11, B12, B13, B29) | WP5, **자매 sync-IO** |
| WP7 | B26 세션 락, B27 하트비트 | **자매 sync-IO** |
| WP8 | B08의 취소되지 않는 evaluate | WP1, WP2 |
| WP9 | warning 전파 + 활성화 관측 | 전부, **자매 finalizer/lease** |

분할은 의존 순서다(PHASE-SPLIT-01).

**WP3가 새로 추가됐다.** `sessionDeps` 세 getter를 감싸는 것만으로는 부족하다는
것이 감사에서 확인됐다. 진입점 배선이 독립 work-phase여야 하는 이유다.

### 생산 호출 경로 여섯

| # | 진입 | 경로 |
| --- | --- | --- |
| 1 | CLI 세션 폴 | `runBoundCommand`(`cli.mjs:1254`) → `withSessionCommandLock` → `withCommandSessionPage` → `withWebAiActiveCommand` → `pollFn` |
| 2 | CLI 무세션 폴 | `runBoundCommand` → `withWebAiActiveCommand`(`cli.mjs:1279`) |
| 3 | MCP | `web-ai/mcp-server.mjs:105` |
| 4 | sessions resume | `web-ai/cli-sessions.mjs:122` |
| 5 | watcher | `web-ai/watcher.mjs:633` |
| 6 | `queryWebAi` 내부 | `web-ai/chatgpt.mjs:1127` (send 후 이어지는 poll) |

### 예산보다 먼저 실행되는 구간 (pre-poll)

`pollWebAi` 진입 전에 이미 블로킹 가능한 지점이 넷이다. **최초 데드라인 생성
지점을 이들보다 앞에 두지 않으면 `--timeout`이 시작도 전에 멈춘다.**

| 구간 | 위치 | 성격 |
| --- | --- | --- |
| implicit session 해석 | `cli.mjs:1255` `resolveImplicitCommandSession` → `session-target-guard.mjs:46-49` → `listSessions` | 동기 session-store 읽기 |
| command lock 획득 | `session-store.mjs:273-316`, `sleepBlockingMs` `:250-256` | `Atomics.wait` — 타이머까지 정지 |
| 페이지 해석 | `cli.mjs:1314` → `tab-recovery.mjs:437-558` | `verifySessionTab`·`getPageByTargetId`·`page.goto`·세션 update |
| active-command 등록 | `cli.mjs:1459-1472` → `active-command-store.mjs:53-112`, `:132-172` | `openSync`/`readFileSync`/`writeFileSync` |

WP3는 이 넷과 위 여섯 경로를 **구조도로 고정하고 최초 데드라인 생성 지점을
확정**한다. 그것이 이 work-phase의 산출물이다.

### 자매 유닛 선행 (021 7절)

| 이 유닛 | 필요한 자매 phase | 이유 |
| --- | --- | --- |
| WP6 | sync-IO 처방 | B20(`persistResolverTraceForSession`)이 copy 경로에 있다 |
| WP7 | sync-IO 처방 | B26이 세션 store 락을 쓴다 |
| WP9 | finalizer·lease phase | B33/B34가 성공·recovery·copy 경로 전부에 걸린다 |

## 검증 시나리오 (021 6절, A·B 공통)

| # | 시나리오 | 증명 |
| --- | --- | --- |
| C1 | `deps.getPage`/`page.evaluate`가 영원히 pending | 데드라인 안에 반환 |
| C2 | 패배한 Promise가 나중에 resolve | session·finalizer·artifact 부수효과 없음 |
| C3 | 반복 timeout | pending 작업 누적 없음 |
| C4 | 동기 IO가 event loop 차단 | wall-time 상한 성립 (모델별 증명 방식이 다르다) |
| C5 | fail-open 여섯 각각 | sentinel을 정상 상태로 오독하지 않음 |

C5 중 B03·B06이 이 유닛 담당(WP5)이다. C1~C4는 **자매 유닛과 공동 게이트** —
어느 한쪽만으로는 met이 아니다.

### 시나리오별 하네스와 관측 대상

C1~C5를 그대로 두면 "어디서 어떻게 증명하는가"가 빠진다. WP2가 하네스를 정할 때
아래를 채운다.

| # | 하네스 | 관측 대상 | 비고 |
| --- | --- | --- | --- |
| C1 | fake timer + page double | 반환 여부, 경과 시간 | **여섯 경로 전부** — CLI 세션/무세션, MCP, resume, watcher, `queryWebAi` |
| C2 | fake timer + 늦게 resolve하는 double | 세션 store·artifact·lease 상태 불변 | 늦은 resolve 후 스냅샷 비교. active-command 등록도 정리되는지 확인 |
| C3 | 반복 timeout | outstanding handle 수, pending 작업 수, **command lock 잔존 여부** | 단순 반환값이 아니라 누적 관측. 락이 남으면 다음 명령이 막힌다 |
| C4 | **실시간 프로세스 하네스** | wall-clock 상한 | fake timer로는 불가 — `Atomics.wait`는 타이머를 막고, 격리 모델이면 자식 종료를 실제로 재야 한다. **pre-poll 구간 넷도 대상** |
| C5 | 경계별 단위 테스트 | sentinel이 정상값으로 오독되지 않음 | B03·B06은 이 유닛, 나머지는 자매 |

**C4가 별도 하네스를 요구한다.** 나머지와 성격이 달라 WP2가 둘을 다 만들어야
한다. 추가로 command lock 경합·해제도 C1/C3에서 관측 대상에 포함한다 —
timeout 후 락이 남으면 다음 명령이 막힌다.

## 테스트 하네스 제약 (021 6절)

`pollWebAi`를 실제 구동하는 하네스는 넷이다.

```
test/unit/web-ai-chatgpt-activity-poll.test.mjs      가상 시계 (유일)
test/unit/web-ai-provider-session.test.mjs
test/integration/web-ai-fake-chatgpt.test.mjs:97
test/integration/web-ai-golden-scenario.test.mjs:85
```

`activity-poll`은 `Date.now`를 mock하고 offset은 `page.waitForTimeout`에서만
전진한다. 실제 `setTimeout` 기반 예산과 섞으면 "두 번째 읽기는 남은 시간만
받는다"를 검증할 수 없다 — WP2가 이를 fake timer로 옮긴다.

`chatgpt.mjs` 소스 문자열을 읽는 테스트가 10개 있어(`021` 5절) 리팩터 시 함께
갱신해야 한다.

## 범위

IN: `web-ai/chatgpt.mjs` 폴링 경로, `web-ai/chatgpt-response-dom.mjs`,
`web-ai/chatgpt-response-observer.mjs`, 예산 프리미티브 신규 모듈, 관련 테스트.

진입점 배선(WP3) 대상: `web-ai/cli.mjs`, `web-ai/session-store.mjs`,
`web-ai/session-target-guard.mjs`, `web-ai/tab-recovery.mjs`,
`web-ai/active-command-store.mjs`, `web-ai/mcp-server.mjs`,
`web-ai/cli-sessions.mjs`, `web-ai/watcher.mjs`.

OUT: 이미지·파일 다운로드, 탭 lease, CDP 취득 경로 — 자매 유닛
(`artifact/finalizer hardening`) 소유. devlog 정리. #87 관련 코드.

## 종료 판정

DONE 조건은 셋이다.

1. 담당 경계 15개가 예산 계약 아래 데드라인을 인지한다.
2. C5의 B03·B06이 fail-closed로 검증된다.
3. **WP3의 여섯 호출 경로와 pre-poll 구간 넷이 전부 예산 안에 들어온다.**
   한 경로라도 빠지면 그 경로로 #88이 재현된다.

C1~C4는 자매 유닛 완료 후 공동 게이트로 확인한다.

**부분 완료를 DONE으로 적지 않는다.** 일부 경계만 덮으면 #88은 여전히 재현된다.
