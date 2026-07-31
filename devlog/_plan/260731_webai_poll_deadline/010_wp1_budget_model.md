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
| B22/B23 | `web-ai/session.mjs:156-172`, `session-store.mjs:116` | baseline/session store 읽기 |

추가로 진입점 자체가 동기 락을 쓴다. `withSessionCommandLock`
(`web-ai/session-store.mjs:273-290`)은 `openSync`를 `LOCK_RETRY_LIMIT` 루프로
돌리고 실패 시 `sleepBlockingMs`로 **블로킹 대기**한다.

**핵심 질문:** 예산 래퍼를 이 락의 안쪽에 둘지 바깥쪽에 둘지. 안쪽이면 락 획득
자체가 예산 밖이라 `--timeout`이 시작도 전에 멈출 수 있고, 바깥쪽이면 락을
잡은 채 타임아웃되어 락 해제 경로가 필요하다. WP1이 이걸 답해야 한다.

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

### 기준 3 — 기존 취소 선례

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

이 패턴이 in-process 모델의 선례다. **다만 한계도 여기 있다** — `evalP`는
취소되지 않고 살아남는다. 이것이 정확히 single-flight가 풀어야 할 문제다.

WP1은 이 패턴을 확장할 수 있는지, 아니면 근본적으로 부족한지 판정한다.

### 기준 4 — 진입점 구조

세션 폴의 진입점은 하나로 모인다(`web-ai/cli.mjs:1259-1277`).

```
runBoundCommand(command='poll', input.session 있음)
  → withSessionCommandLock(input.session, ...)        session-store.mjs:273 (동기 락)
    → withCommandSessionPage(command, deps, input, ...)  cli.mjs:1314
      → withWebAiActiveCommand(command, sessionDeps, ...)  cli.mjs:1459
        → effectivePollFn(sessionDeps, ...)
```

`sessionDeps`가 `:1263-1268`에서 조립된다 — `getPage`, `getTargetId`,
`getCdpSession` 셋. **예산을 끼울 자리가 명확하다.** 이 셋을 예산 인지 버전으로
감싸면 하위가 무엇을 하든 그 예산을 받는다.

세션 없는 폴은 `:1279`로 바로 간다. 두 경로 모두 다뤄야 한다.

## 산출물

### 1. `011_model_decision.md` — 결정 기록

- 고른 모델과 근거
- 위 네 기준 각각에 대한 판정
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

WP1은 설계 단계라 통합 테스트가 없다. 프리미티브 모듈에 대해서만:

- 예산 만료 후 `fenced()`가 실행을 막는다
- `singleFlight()`가 같은 키의 중복 작업을 누적시키지 않는다
- 예산 객체가 타이머를 누수하지 않는다(`unref` 또는 명시적 정리)

`npm run typecheck`와 새 모듈의 단위 테스트가 게이트다.

## 범위

IN: 결정 문서, 예산 프리미티브 모듈 + 그 단위 테스트.

OUT: `pollWebAi` 배선(WP3 이후), 기존 경계 수정, 하네스 전환(WP2).

## 이 work-phase가 실패하는 방식

두 모델 모두 실현 불가로 판정될 수 있다. in-process는 동기 IO가 너무 깊고,
격리는 `deps` 직렬화가 안 될 수 있다.

그 경우 문제는 `pollWebAi`가 아니라 **web-ai 전반의 페이지 접근 규약**이다.
유닛을 닫지 말고 그 판정을 기록한 뒤 아키텍처 수준의 결정을 사용자에게
에스컬레이션한다 — 세 번째 모델을 즉흥으로 만들지 않는다.
