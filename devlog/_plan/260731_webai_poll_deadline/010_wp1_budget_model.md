# 010 — WP1: 예산 계약 모델 선택과 프리미티브 설계

선행: 없음. 이 유닛과 자매 유닛(`artifact/finalizer hardening`)의 첫 작업이다.

**산출물은 결정이지 구현이 아니다.** 코드 변경은 프리미티브 모듈 하나까지다.

## 결정해야 할 것

`000_plan.md`의 두 모델 중 하나. 이 선택이 두 유닛의 나머지 work-phase를 모두
규정한다.

## 판정 기준

세 계약(sync isolation · fencing · single-flight)을 각 모델이 어떻게 만족하는지
**실제 코드로** 확인한다. 표로 비교하고 끝내지 않는다.

### 기준 1 — sync isolation이 실현 가능한가

in-process를 고르려면 담당 범위의 동기 IO를 전부 async로 옮기거나 제거해야
한다. 확인된 동기 경계:

| 경계 | 위치 | 성격 |
| --- | --- | --- |
| B18/B19 | `web-ai/session-store.mjs:136` `withStoreLock` | `openSync`/`writeFileSync` + 최대 200회 재시도 루프 |
| B26 | `web-ai/chatgpt.mjs:1528-1530` | `buildDeferredPollingResult` → `getSession`+`updateSession` |
| B27 | `web-ai/chatgpt.mjs:688` | `process.stderr.write` |
| B20 | `web-ai/chatgpt.mjs:1386` | `persistResolverTraceForSession` |
| B22/B23 | `web-ai/session.mjs:156-161`, `session-store.mjs:116-117` | baseline/session store 읽기 |
| B21 | `skills/browser/browser.mjs:480-485` | `deps.getPage` 하위 persisted-state 동기 읽기 |
| B31/B32 | `web-ai/chatgpt-images.mjs:257-273`, `web-ai/chatgpt-files.mjs:433-444` | 아티팩트 저장 (자매 유닛 소유, 모델은 공통) |
| B33/B34 | `web-ai/tab-finalizer.mjs:64-86`, `web-ai/tab-lease-store.mjs:179-208` | finalizer·lease (자매 유닛 소유, 모델은 공통) |
| B35 | `skills/browser/tab-manager.mjs:35-52` | `forgetTabActivity` (자매 유닛 소유, 모델은 공통) |
| 진입점 락 | `web-ai/session-store.mjs:250-256`, `:273-316` | `withSessionCommandLock` — `Atomics.wait` |

자매 유닛 소유 경계도 표에 넣는 이유: **모델은 두 유닛이 공유**하므로, in-process를
고르려면 저 전부가 async로 옮겨져야 한다. 이 유닛 담당분만 보고 판정하면 안 된다.

추가로 진입점 자체가 동기 락을 쓴다. `withSessionCommandLock`
(`web-ai/session-store.mjs:273-290`)은 `openSync`를 `LOCK_RETRY_LIMIT` 루프로
돌리고 실패 시 `sleepBlockingMs`로 **블로킹 대기**한다.

**이건 대등한 선택지가 아니다.** 락 획득은 `openSync` 재시도 루프이고 실패 시
`sleepBlockingMs`(`web-ai/session-store.mjs:250-256`)를 부르는데, 그 구현이
`Atomics.wait`다(`:255`). **동기 블로킹이라 그 동안 타이머 자체가 안 돈다** —
바깥에서 `Promise.race`를 걸어도 소용없다. `LOCK_RETRY_LIMIT`까지 가면 5초 이상
막힐 수 있다.

게다가 락 해제는 callback Promise가 끝난 뒤 `finally`에서만 일어난다(`:273-316`).
timeout을 반환해도 원 작업이 살아 있으면 락도 계속 잡혀 있다.

결론: **예산은 락 획득 전에 시작해야 하고, 획득 자체를 deadline-aware async로
바꾸거나 부모 격리로 선점해야 한다.** WP1이 둘 중 하나를 고른다.

이 command lock 수정은 별도 work-phase가 필요하다 — `000_plan.md`의 WP 목록에
없었다. WP6의 B26은 `buildDeferredPollingResult`가 쓰는 **다른** store lock이다.

### 기준 2 — fencing을 어디에 거는가

데드라인 이후 mutation이 일어나는 지점(`021` §0 표):

```
web-ai/chatgpt.mjs:848-850    session crash/update
web-ai/chatgpt.mjs:698-705, :812-826, :899-912, :970-984   finalizer·archive·pool
web-ai/chatgpt.mjs:986-1008   session timeout 변경
web-ai/tab-finalizer.mjs:66-106   finalizer 내부 session/artifact 쓰기
```

in-process면 이 지점마다 "데드라인 지났으면 skip" 게이트가 필요하다. 격리면
자식 프로세스 종료로 자동 해결되지만, 종료 시점에 이미 쓴 것은 남는다 —
**부분 쓰기**를 어떻게 다룰지가 쟁점이다.

### 기준 3 — 기존 취소 선례가 실제로 있는가

`observeAssistantResponse`(`web-ai/chatgpt-response-observer.mjs:78-84`)가 이미
`AbortSignal`을 받는다.

```js
export async function observeAssistantResponse(page, { baselineAssistantCount = 0, timeoutMs, signal } = {}) {
    if (signal?.aborted) return null;
    try {
        const evalP = page.evaluate(buildResponseObserverExpression({ ... }));
        if (!signal) return await evalP;
        const abortP = new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
        return await Promise.race([evalP, abortP]);
```

**이건 취소가 아니다.** `evalP`는 race에서 져도 취소되지 않고 살아남는다.
Playwright는 시작된 `evaluate`를 취소하는 API를 제공하지 않는다.

따라서 in-process 모델의 진짜 질문은 이것이다: **영원히 pending인 `evaluate`를
cancel 또는 drain할 방법이 있는가?** 없다면 single-flight는 누적만 막을 뿐이고
C3는 통과해도 C1은 프로세스가 종료되지 않아 실패할 수 있다.

WP1은 이 질문에 pass/fail로 답한다.

### 기준 4 — 진입점 구조와 그 한계

세션 폴의 CLI 사슬은 이렇다(`web-ai/cli.mjs:1259-1277`).

```
runBoundCommand(command='poll', input.session 있음)
  → withSessionCommandLock(input.session, ...)        session-store.mjs:273 (동기 락)
    → withCommandSessionPage(command, deps, input, ...)  cli.mjs:1314
      → withWebAiActiveCommand(command, sessionDeps, ...)  cli.mjs:1459
        → effectivePollFn(sessionDeps, ...)
```

`sessionDeps`가 `:1263-1268`에서 조립된다 — `getPage`, `getTargetId`,
`getCdpSession` 셋.

**그 셋을 감싸는 것만으로는 부족하다.** 감사가 확인한 세 가지 누수:

1. **페이지 해석이 조립보다 먼저다.** `withCommandSessionPage`(`:1314`)가
   `verifySessionTab`·`getPageByTargetId`·`page.goto`·세션 update까지 수행한
   **뒤에** `sessionDeps`가 만들어진다(`web-ai/tab-recovery.mjs:437-558`). 그
   구간의 정체는 예산 밖이다.
2. **반환된 `page`가 getter를 우회한다.** `pollWebAi`는 `getPage()`로 받은
   실제 `page` 객체에 직접 `evaluate`/locator를 호출하고, `getSession`·
   `updateSession`도 직접 import한다(`web-ai/chatgpt.mjs:585-617`, `:658-677`).
   getter를 감싸도 그 뒤 호출은 원본 객체를 쓴다.
3. **`runBoundCommand`를 거치지 않는 호출자가 넷 더 있다.**
   `web-ai/mcp-server.mjs:105`, `web-ai/cli-sessions.mjs:122`,
   `web-ai/watcher.mjs:633`, 그리고 `web-ai/chatgpt.mjs:1127`
   (`queryWebAi` 내부에서 send 후 이어지는 poll). CLI 진입점만 고치면 이들은
   계약 밖이다.

따라서 WP1은 **예산의 canonical owner를 먼저 정해야 한다.** 후보:
`pollWebAi` 자신이 예산을 만들고 모든 호출자가 데드라인을 전달하는 형태,
또는 `deps` 계약에 예산을 필수 필드로 넣는 형태. 어느 쪽이든 여섯 경로
전부가 대상이다.

세션 없는 폴은 `:1279`로 바로 간다.

### 기준 5 — 격리 모델의 결정적 조건

"직렬화가 안 될 수 있다"로 넘기면 판정이 안 된다. 다음을 **probe로 확인**한다.

| 항목 | 확인 방법 | 탈락 조건 |
| --- | --- | --- |
| process 경계 | `pollWebAi`가 받는 것 중 무엇이 자식에서 재구성 가능한가 | `sessionDeps`의 closure와 Playwright `Page`는 그대로 직렬화 불가(`web-ai/cli.mjs:1263-1268`) — 자식이 CDP로 재연결할 수 있는지가 관건 |
| IPC 결과 계약 | `pollWebAi` 반환 객체가 구조화 복제 가능한가 | `baseline`·`traceSummary` 등에 함수/순환 참조가 있으면 스키마 변환 필요 |
| kill/reap | 자식을 죽였을 때 CDP 세션과 탭이 정리되는가 | 좀비 탭이 남으면 lease 오염 |
| 부분 쓰기 | 자식이 세션 store를 쓰던 중 죽으면 | 락 파일이 남거나 store가 깨지면 탈락 |
| 직접 호출자 호환 | MCP·resume·watcher·`queryWebAi`가 자식 모델로 동작하는가 | 넷 중 하나라도 못 쓰면 두 경로가 갈린다 |
| 취소 불가 작업 drain | in-process를 고른 경우 | `Atomics.wait` 중인 동기 구간은 취소가 원리적으로 불가 — 이 경우 in-process 탈락 |
| 성능 | 자식 기동 비용 | 폴은 반복 호출이라 매번 프로세스를 띄우면 비용이 문제 |

**마지막 두 행이 결정적일 가능성이 높다.** `Atomics.wait`가 남아 있는 한
in-process는 C4를 만족할 수 없고, 자식 기동 비용이 크면 격리가 실용적이지 않다.
WP1은 이 둘을 먼저 측정한다.

## 산출물

### 1. `011_model_decision.md` — 결정 기록

- 고른 모델과 근거
- 위 다섯 기준 각각에 대한 판정
- P1~P9 probe 결과 (명령·출력·판정)
- 버린 모델의 어떤 점이 결정적이었는지
- 이 결정이 틀렸다는 것을 보여줄 증거(LOOP-PESSIMIST-01)

### 2. 예산 프리미티브 모듈 (NEW)

고른 모델에 맞는 최소 프리미티브. in-process면 대략 이런 형태다.

```js
// web-ai/poll-budget.mjs (파일명은 WP1이 확정)

/**
 * 폴링 명령 하나의 예산. 데드라인·취소·fencing을 한 객체로 묶는다.
 * 개별 호출 지점을 감싸는 대신 이것을 deps에 주입해, 하위가 무엇을
 * 하든 같은 예산 아래 있게 한다.
 */
export function createPollBudget({ deadlineAt }) { /* ... */ }

/** 데드라인 이후 mutation을 막는 게이트. */
export function fenced(budget, fn) { /* ... */ }

/** 같은 키의 작업이 누적되지 않게 한다. */
export function singleFlight(budget, key, fn) { /* ... */ }
```

격리 모델이면 워커 래퍼와 watchdog이 그 자리에 온다.

**정확한 시그니처는 WP1이 확정한다.** 위는 형태 예시이며, 모델 선택 전에
API를 고정하지 않는다.

### 3. 자매 유닛과의 공유

결정을 `devlog/_plan/260731_webai_artifact_finalizer/`에도 기록한다. 두 유닛이
다른 모델을 쓰면 계약이 성립하지 않는다.

## 검증

### Probe evidence ledger (`011`의 필수 내용)

모델 선택을 주장이 아니라 측정으로 만든다. 각 행에 **실행한 명령과 결과**를
기록한다. 사전 임계값을 여기 적고, 측정 후에 임계값을 움직이지 않는다.

후보는 **셋**이다. "격리"를 한 덩어리로 묶으면, 빠른 worker의 P7과 재연결
가능한 subprocess의 P3을 합쳐 어느 후보도 통과 못 한 것을 "격리 통과"로
오판할 수 있다.

| 후보 | 설명 |
| --- | --- |
| A: in-process | 동기 IO를 async로 옮기고 취소·drain을 구현 |
| B: worker thread | `node:worker_threads`. 메모리 공유, 기동 빠름 |
| C: subprocess | `child_process`. 완전 격리, 기동 느림 |

**한 후보가 자기에게 적용되는 probe를 전부 통과해야 선택 가능하다.** 후보 간
결과를 섞지 않는다.

| # | probe | 측정 | A | B | C |
| --- | --- | --- | --- | --- | --- |
| P1 | 영원히 pending인 `page.evaluate` 후 상태 | 아래 정의 참조 | 필수 | — | — |
| P2 | `Atomics.wait` 구간에 타이머가 도는가 | `setTimeout` 콜백 실행 여부 | 필수 | 필수 | — |
| P3 | 자식/워커에서 CDP 재연결 | targetId로 `Page` 재획득 | — | 필수 | 필수 |
| P4 | `pollWebAi` 반환 구조화 복제 | `structuredClone(result)` | — | 필수 | 필수 |
| P5 | kill 후 정리 | 탭·CDP 세션·락 파일 잔존 | — | 필수 | 필수 |
| P6 | 부분 쓰기 복구 | store 쓰기 중 kill → 다음 명령 동작 | — | 필수 | 필수 |
| P7 | 기동 비용 | 폴 1회당 추가 지연 | — | 필수 | 필수 |
| P8 | 직접 호출자 구조 호환 | 여섯 경로가 이 모델로 배선 **가능한가**(prototype) | 필수 | 필수 | 필수 |
| P9 | 향후 sync 유입 차단 | conformance 방식 | 필수 | 필수 | 필수 |

### P1 정의 (수정)

"프로세스가 종료되는가"는 oracle로 쓸 수 없다. MCP(`web-ai/mcp-server.mjs:328-363`)와
watcher(`web-ai/watcher.mjs:629-651`)는 poll 뒤에도 살아 있어야 하는 **장기
프로세스**다. 정상 drain돼도 종료되지 않고, 반대로 pending Promise가 handle을
안 잡으면 drain 안 돼도 one-shot 프로세스는 종료돼 false-pass한다.

P1의 실제 측정:
- 데드라인 안에 반환하는가 (C1 계약)
- timeout 직후 outstanding operation 수, active handle, 미해제 CDP request,
  락 파일 상태
- 장기 프로세스에서 폴을 반복했을 때 위 수치가 **누적되는가**

one-shot CLI 종료 여부는 별도 관측치로 기록하되 pass/fail 기준으로 쓰지 않는다.

### 사전 임계값

| probe | 임계값 |
| --- | --- |
| P1 | 반복 폴 20회 후 outstanding operation·handle 증가 0. 증가하면 A 탈락 |
| P2 | 타이머가 안 돌면 lock을 async로 바꿔야 하고, 불가면 A 탈락 |
| P7 | 폴 1회당 200ms 초과면 해당 후보 탈락 |

측정 후에 임계값을 움직이지 않는다.

**P1과 P7을 먼저 측정한다.** A의 P1과 B·C의 P7이 각 후보의 존폐를 가른다.
셋 다 탈락이면 아래 "실패하는 방식"으로 간다.

### 프리미티브 단위 테스트

- 예산 만료 후 `fenced()`가 실행을 막는다
- `singleFlight()`가 같은 키의 중복 작업을 누적시키지 않는다
- 예산 객체가 타이머를 누수하지 않는다(`unref` 또는 명시적 정리)

`npm run typecheck`와 위 단위 테스트가 게이트다. **P1~P9 ledger가 채워지지
않으면 WP1은 완료가 아니다.**

### 일회용 spike 허용

P1~P7은 실제 프로세스·CDP·kill을 다뤄야 하므로 단위 테스트만으로 측정할 수
없다. **WP1은 일회용 feasibility spike를 만들 수 있다** — 측정이 끝나면 버리는
스크립트다. 정식 하네스(WP2)나 배선(WP3)을 선구현하지 않는다.

P8은 두 단계로 나눈다.
- **WP1**: 여섯 경로가 이 모델로 배선 *가능한가*를 구조적으로 판단(prototype 수준)
- **WP3**: 실제 배선 후 runtime conformance 검증

WP1이 P8을 완전히 증명할 수는 없다 — 배선이 WP3 소유이기 때문이다.

## 범위

IN: 결정 문서, 예산 프리미티브 모듈 + 그 단위 테스트.

OUT: `pollWebAi` 배선(WP3 이후), 기존 경계 수정, 하네스 전환(WP2).

## 이 work-phase가 실패하는 방식

두 모델 모두 실현 불가로 판정될 수 있다. in-process는 동기 IO가 너무 깊고,
격리는 `deps` 직렬화가 안 될 수 있다.

그 경우 문제는 `pollWebAi`가 아니라 **web-ai 전반의 페이지 접근 규약**이다.
유닛을 닫지 말고 그 판정을 기록한 뒤 아키텍처 수준의 결정을 사용자에게
에스컬레이션한다 — 세 번째 모델을 즉흥으로 만들지 않는다.
