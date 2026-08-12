# 065 — WP15 tick 내부 데드라인 (이슈 #88 본체)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP15
- 선행: 없음 — G1~G4와 독립인 최소 처방

## 아직 안 고쳐졌다

WP10·WP11·WP14는 읽기가 **throw**할 때를 고쳤다. `page.evaluate`가 **영원히
안 끝나는** 경우는 그대로다. 이슈 #88 제목이 말하는 게 정확히 그것이다.

재현:

```
budget 2초, evaluate가 never-settling Promise 반환
→ {"budgetSec":2,"elapsedMs":8002,"kind":"STILL-HANGING"}
```

8초에도 반환하지 않았다. 하네스가 포기한 것이지 폴이 끝난 게 아니다.

### 왜 루프 조건이 못 잡는가

```js
while (Date.now() <= deadline) {   // :723 — tick 경계에서만 평가된다
    …
    await page.evaluate(...)        // 여기서 멈추면 위 조건에 도달하지 못한다
}
```

데드라인이 **tick 사이**에만 존재한다. tick **안**에서 멈추면 없는 것과 같다.

## 이름과 보장 범위

이걸 "예산 계약"이나 "반환 보장·late-effect 없음·single-flight"라고 부르지
않는다. 감사가 지적한 대로 `Promise.race`가 줄 수 있는 것보다 강한 주장이다.

**이 work-phase의 이름은 async-stall return containment다.** 보장은 하나다:

> **폴 데드라인이 armed된 뒤부터**, poll loop와 recovery 경로의 async 정체는
> hard deadline 안에서 호출자에게 반환된다.

"`--timeout` 안에 반환"이라고 뭉뚱그리지 않는다. `requireChatGptPage`
(`:674`)는 데드라인 생성(`:709`)보다 **앞**이라 race 밖이고, 그것도 스케줄
가능한 async 정체일 수 있다. pre-poll 구간은 `000_plan.md`의 표가 소유한다.

정체 취소도, 이미 시작된 부수효과 차단도 아니다.

## 처방

### hard deadline은 loop deadline과 다르다

전체 본문을 loop deadline과 race하면 **정상 동작을 깬다.** 루프가 끝난 뒤
recovery·ordering 재검증·diagnostics·copy fallback이 실행되고(`:1002-1214`),
그것들이 `complete`/`polling`을 반환하는 정상 경로다. 같은 시각에 타이머를
걸면 그 결과가 timeout으로 덮이고, 스케줄링에 따라 비결정적이 된다.

두 데드라인을 나누되, **`--timeout`이 상한이다.**

```
hard deadline  = start + timeout                    ← 사용자가 준 값 그대로
loop deadline  = hard - RECOVERY_RESERVE_MS          ← 루프를 먼저 끊는다
```

초판은 `hard = start + timeout + reserve`라고 썼는데 그러면 호출자가 받는
상한이 `--timeout`이 아니라 `--timeout + reserve`다. **이름과 보장이 어긋난다.**
루프 예산을 줄여서 recovery 몫을 만든다.

`RECOVERY_RESERVE_MS`는 loop 이후 경로 몫이다. recovery 자체에도 무제한
evaluate·CDP 경계가 있으므로 "정상 recovery는 항상 예약 안에 끝난다"고 말할 수
없다. 정확히는 **예약 안에 끝난 recovery만 보존되고, 넘긴 것은 hard timeout에
진다.**

`timeout`이 reserve보다 작으면 loop deadline이 음수가 된다. 산식을 고정한다 —
"일정 비율"로 두면 1초 timeout에서 구현자마다 다른 결과가 나온다.

```js
const RECOVERY_RESERVE_MS = 2_000;          // 상한
const MAX_RECOVERY_RESERVE_RATIO = 0.25;    // timeout의 1/4을 넘지 않는다
const MIN_LOOP_BUDGET_MS = 500;             // 최소 한 tick

const reserveMs = Math.min(
    RECOVERY_RESERVE_MS,
    Math.floor(timeoutMs * MAX_RECOVERY_RESERVE_RATIO),
    Math.max(0, timeoutMs - MIN_LOOP_BUDGET_MS),
);
const hardDeadline = start + timeoutMs;
const loopDeadline = hardDeadline - reserveMs;
```

세 번째 항이 루프 예산을 지킨다. `timeout`이 500ms 이하면 reserve는 0이 되고
recovery 몫이 없다 — 그 예산에서는 정상이다.

### 루프 자체가 reserve를 먹어치우는 것을 막는다

reserve를 계산해두는 것만으로는 부족하다. 현재 루프는
`while (Date.now() <= deadline)`이고 매 tick 끝에 **고정 500ms**를 기다린다
(`:723`, `:979-984`). 2초 timeout / 500ms reserve면:

```
t=0 → 500 → 1000 → 1500 (조건 통과, 마지막 tick) → 2000
reserveLeft: 0
```

루프가 hard deadline에 정확히 도착해 **recovery 몫이 사라진다.** Y4의 보존
경로가 아예 실행되지 않는다.

**pacing 지점은 하나가 아니다.** tail(`:979-984`) 말고도 WP14가 넣은 실패 경로
(`:768-774`)가 자체 `waitForTimeout(500); continue`를 갖고 있어 tail에 도달하지
않는다. 그쪽만 고치면 reader 둘이 모두 실패하는 동안 cap이 우회된다.

```
1초 timeout → reserve 250ms, loopDeadline 750ms
실패 경로: 0 → 500 → 1000ms
reserveLeft: 0            ← recovery 몫이 사라진다
```

두 지점을 **하나의 deadline-aware helper로 통합**한다.

```js
// 남은 예산만큼만 기다린다. 예산이 없으면 루프를 끝내 recovery로 넘긴다.
// `wake`는 MutationObserver 조기 깨우기 — tail에서만 넘긴다.
async function paceTick(wake) {
    const remaining = loopDeadline - clock.now();
    if (remaining <= 0) return false;                 // caller가 break
    const waited = page.waitForTimeout(Math.min(500, remaining));
    if (wake) await Promise.race([waited, wake]);     // 기존 최적화 보존
    else await waited;
    return true;
}

while (clock.now() < loopDeadline) {        // <= 가 아니라 <
    …
    if (!fallbackRead.ok) {
        …
        if (!await paceTick()) break;       // continue가 아니다 (wake 없음)
        continue;
    }
    …
    if (!await paceTick(observerWake)) break;   // tail은 observer race 유지
}
```

실패 경로가 `continue`가 아니라 `break`로 나가는 것이 핵심이다 — 예산이
없는데 `continue`하면 루프 조건이 다시 참이 될 수 없으니 같은 결과지만,
의도를 코드로 남긴다.

mutation 셋으로 검증한다: `<=` 복원, tail의 `Math.min` 제거, **실패 경로의
고정 500ms 복원**.

시계는 주입한다: `{ now, setTimeout, clearTimeout }`. production은 전역,
테스트는 가상 시계를 넣어 Y2/Y3를 결정적으로 만든다.

### 데드라인 콜백은 store I/O를 하지 않는다

`markSessionTimeout`은 동기 store 락을 잡는다(`session.mjs:251` →
`session-store.mjs:126`). 타이머 콜백에서 부르면 **이벤트 루프를 막아** 반환이
지연된다 — P2가 이미 측정한 실패다.

따라서 hard deadline 경로는 **순수 envelope만 resolve한다.** 세션 기록은 하지
않는다. 그 기록까지 보장하려면 G1(async store)이 선행이며, 이 work-phase는
G1과 독립을 유지한다.

### fencing — 무엇을 막을 수 있고 무엇은 못 막는가

진 루프가 나중에 건드릴 수 있는 표면은 감사가 전수로 세었다.

효과 "종류"가 아니라 **실제 호출부 전부**를 적는다. 종류만 적으면 구현이
일부만 감싸고 loser가 세션 상태를 바꾼다.

| 분류 | 호출부 |
| --- | --- |
| session 직접 변경 | `:988` `updateSession`(crashed) |
| session write via deferred | `:1027`, `:1070`, `:1112`, `:1136` |
| session timeout 기록 | `:1177`, `:1197` `markSessionTimeout` |
| finalize·아카이브·탭 lease | `:815`, `:950`, `:1082`, `:1161` |
| stderr 하트비트 | `:804` |
| 이미지 파일·artifact | `:811`, `:885`, `chatgpt-images.mjs:263` |
| trace write | `:860-864` |
| 다운로드 파일 | `:923`, `chatgpt-files.mjs:433` |
| diagnostics artifact | `:1102` |
| clipboard/copy·trace | `:1151` |

가능하면 **session mutation을 wrapper 하나로 모은다** — 목록을 손으로 유지하면
빠뜨린다. 이 유닛에서 그 실수를 이미 두 번 했다.

**호출 전 검사만으로는 이미 시작된 async helper의 쓰기를 막지 못한다.**
그래서 보장을 정확히 좁힌다.

> hard deadline 이후 **새 부수효과를 시작하지 않는다.** 이미 진행 중인 것은
> 완료될 수 있다.

그리고 이 보장은 **이벤트 루프가 스케줄 가능한 async 정체에 한한다.** 동기
store 락처럼 루프 자체를 막는 구간은 타이머도 못 돌므로 race가 성립하지 않는다
— 그건 G1의 몫이고 WP12가 command lock 하나만 걷어냈다.

### gate는 플래그만 보면 안 된다

타이머 콜백이 아직 안 돌았는데 wall clock은 이미 hard deadline을 지난 상태가
가능하다. 다른 Promise의 continuation microtask가 타이머보다 먼저 실행되면
`expired === false`를 보고 새 효과를 시작한다.

```js
function commitIfActive(ctx, fn) {
    if (ctx.expired || ctx.clock.now() >= ctx.hardDeadline) {
        throw POLL_EXPIRED;          // SKIPPED가 아니다 — 아래 참조
    }
    return fn();
}
```

`now`와 타이머는 **같은 주입 시계**를 써야 Y2/Y3가 결정적이다.

### gate는 값이 아니라 제어 흐름을 끊어야 한다

`SKIPPED`를 **반환**하면 부수효과는 막지만 호출자가 그걸 무시하고
`complete`/`polling` envelope를 만들어 반환할 수 있다. 그러면 정체된 Promise가
hard deadline 직후 resolve되고 그 continuation microtask가 타이머 콜백보다
먼저 실행되는 경우, **`runPollLoop()`가 race를 이겨 데드라인 이후에 정상 완료
결과가 나간다.** 부수효과는 없는데 시간 계약은 깨진 상태다.

두 가지를 함께 한다.

1. gate는 `POLL_EXPIRED` sentinel을 **throw**해 루프를 빠져나온다.
2. loser 결과를 race 입력 **전에** 정규화한다.

```js
const loop = runPollLoop().then(
    result => (clock.now() >= hardDeadline ? timeoutEnvelope() : result),
    err => (clock.now() >= hardDeadline || err === POLL_EXPIRED
        ? timeoutEnvelope()
        : Promise.reject(err)),
);
const outcome = await Promise.race([loop, deadlineExpiry()]);
```

**rejection도 정규화한다.** fulfilled와 `POLL_EXPIRED`만 다루면, 정체된
`evaluate`가 hard deadline 직후 **일반 오류로 reject**하고 그 microtask가
타이머보다 먼저 실행될 때 race가 그 오류로 reject된다 — "deadline 이후에는
timeout envelope만 나온다"가 깨진다.

이러면 어느 쪽이 먼저 도착하든, 성공이든 실패든, hard deadline 이후에는
timeout envelope만 나온다.

### run context는 호출별이다

`activeRunId`를 모듈 전역에 두면 **다른 세션의 새 폴이 진행 중인 정상 폴을
무효화한다** — 의도치 않은 pseudo-single-flight다. 게다가 이 유닛은 방금
single-flight를 범위 밖으로 선언했다.

호출별 closure로 만든다.

```js
/** @typedef {{ expired: boolean, hardDeadline: number, clock: Clock }} PollRunContext */
```

`runId`/`activeRunId` 쌍은 넣지 않는다. 호출별 context에서는 **항상 참**이라
죽은 검사이고, "나중에 재사용할 수도 있다"는 가정은 방금 선언한 "호출 한 번이
소유권"·single-flight 제외와 어긋난다. 동시성 격리는 Y7이 지키고, context를
모듈 전역으로 옮기는 mutation이 그걸 RED로 만든다.

소유권은 `pollWebAi` 한 번의 호출이다. `expired`는 그 호출의 데드라인 타이머만
설정한다. 서로 다른 두 세션의 동시 폴이 **둘 다 완료되는** 짝 테스트로
고정한다.

### single-flight는 하지 않는다

`021`의 셋째 요소인데 **이 work-phase 범위가 아니다.** 타이머 정리는 진
루프를 정리하지 않는다. 같은 세션을 반복 폴하면 never-settling evaluate가
호출 수만큼 쌓인다.

감사 실측: pending Promise 자체는 Node active handle이 아니라 프로세스를
붙잡지 않는다. 그러나 Playwright/CDP request와 장수 MCP 프로세스에서의 누적은
별개 문제다. **미해결로 남긴다.**

`deadlineExpiry`의 타이머는 unref하지 않고, 루프가 먼저 끝나면
`clearTimeout`한다.

## 왜 이게 예산 계약의 대체가 아닌가

진입점 하나만 막으므로 다음은 그대로다.

- 개별 경계의 상한 — `deps.getPage` 자체가 멈추면 루프에 진입도 못 한다
- pre-poll 구간 넷 — `000_plan.md` 표
- `sendWebAi`/`deepResearchWebAi`의 정체

**c7을 met으로 만들지 않는다.** 다만 이슈 #88이 보고한 증상 — "`--timeout`을
넘겨 행" — 은 이걸로 사라진다.

## 검증

| # | 시나리오 | 관측 |
| --- | --- | --- |
| Y1 | evaluate가 never-settle, budget 2초 | hard deadline 안에 `status:'timeout'` 반환 |
| Y2 | Y1 이후 진 루프가 깨어남 | 세션·artifact·diagnostics·trace·archive·stderr 전부 **새 쓰기 없음** |
| Y3 | 정상 완료 | 회귀 없음 + 데드라인 타이머가 정리된다(타이머 주입으로 관측) |
| Y4 | reserve 안에 끝나는 post-deadline recovery | `complete`/`polling`이 보존된다 — timeout으로 덮이지 않는다 |
| Y4c | reserve를 넘기는 recovery | hard timeout이 이긴다 (보장의 한계를 고정) |
| Y4e | 1초 timeout, 루프 내내 reader 둘 다 실패, 750ms에 회복 | recovery 결과가 보존된다 — 실패 경로도 cap을 지킨다 |
| Y3b | observer가 pacing보다 먼저 resolve | 500ms를 다 기다리지 않고 다음 tick으로 — 기존 최적화가 살아 있다 |
| Y4d | 전체 소요 시간 | `--timeout`을 넘지 않는다 — reserve는 그 **안에서** 나온다 |
| Y4b | 정상 timeout(정체 없음) | 기존 envelope 유지 |
| Y2b | 정체가 hard deadline **직후** resolve, continuation이 타이머보다 먼저 | `timeout` 반환 + 부수효과 없음 — 정상 완료가 새어나가지 않는다 |
| Y5 | hard deadline 경로 | 세션 store 쓰기 없이 반환한다(동기 락 미획득) |
| Y2c | 정체가 hard 직후 **일반 오류로 reject**, continuation이 타이머보다 먼저 | `timeout` 반환 — 오류가 새어나가지 않는다 |
| Y7 | 서로 다른 두 세션을 동시에 폴 | **둘 다 완료된다** — run context가 호출별임을 고정 |

**Y6은 뺀다.** "hang을 기대하는 통과 테스트"는 나중에 그걸 고치는 순간 실패로
바뀐다 — 개선을 회귀로 만드는 테스트다. `deps.getPage` 정체가 범위 밖이라는
것은 아래 "닫지 않는 것"에 문서로 남기고, 필요하면 `it.todo`로 둔다.

**single-flight 주장도 뺐다.** 진 루프를 정리하지 못하므로 Y5를 "프로세스를
붙잡지 않는다"로 쓸 수 없다. 대신 데드라인 경로가 동기 store를 건드리지
않는다는, 실제로 증명 가능한 것을 검사한다.

### mutation proof

| mutation | RED |
| --- | --- |
| hard deadline race 제거 | Y1 |
| `commitIfActive` 검사 무시 | Y2 |
| `RECOVERY_RESERVE_MS`를 0으로 | Y4 |
| `hard = start + timeout + reserve`로 되돌리기 | Y4d |
| `commitIfActive`에서 `now() >= hardDeadline` 검사 제거 | Y2 |
| gate가 throw 대신 `SKIPPED` 반환 | Y2b |
| loser 결과 정규화(`.then`) 제거 | Y2b |
| `PollRunContext`를 모듈 전역으로 | Y7 |
| rejection 정규화에서 `now() >= hardDeadline` 제거 | Y2c |
| 루프 조건을 `<=`로 되돌리기 | Y4 |
| tail pacing의 `Math.min` 제거(고정 500ms) | Y4 |
| **실패 경로**(`:773`)를 고정 500ms로 되돌리기 | Y4e |
| 데드라인 콜백에서 `markSessionTimeout` 호출 | Y5 |

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `web-ai/chatgpt.mjs` | `pollWebAi` 본문을 내부 함수로 감싸 hard deadline과 race, `commitIfActive` 경계, `RECOVERY_RESERVE_MS` |
| `test/unit/web-ai-chatgpt-activity-poll.test.mjs` | Y1~Y7 |

## 이 work-phase가 닫는 것과 닫지 않는 것

닫는 것: **이슈 #88이 보고한 증상.** 정체된 assistant DOM 평가가 `pollWebAi`
호출자를 `--timeout` 너머로 붙잡지 않는다. 수용 기준 (2)의 "재현 가능한
결정적 테스트로 증명되고 수정 후 통과한다".

닫지 않는 것:

- **정체 자체의 취소.** 진 `evaluate`는 계속 pending이다. `011`이 판정한 대로
  취소에는 `Page.reload` primitive와 G4가 필요하다.
- **이미 시작된 부수효과.** 보장은 "새 효과를 시작하지 않음"까지다.
- **single-flight.** 반복 폴이 진 작업을 누적시킨다. 미해결.
- **pre-poll 정체.** `requireChatGptPage`(`:674`)를 포함해 데드라인 armed
  이전 구간 전부. `000_plan.md`의 pre-poll 구간 넷이 그것이다.
- **세션 상태 기록.** hard deadline 경로는 동기 store를 건드리지 않으므로
  세션은 `polling`으로 남는다. G1 이후에 다룬다.
- 경계별 예산 상한 (c7/c8) — G1~G4.
- B04.
