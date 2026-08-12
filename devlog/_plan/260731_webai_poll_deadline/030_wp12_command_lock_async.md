# 030 — WP12 진입점 락의 blocking wait 제거 (G1 부분)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP12
- 선행: 없음
- 관련: `011_model_decision.md`의 reversal gate **G1**, `000_plan.md`의 pre-poll 구간 2번

## 왜 이것만 떼어내는가

G1은 "동기 store를 async로 전환해 P2를 PASS로 뒤집기"이고, 감사 실측으로
범위가 나왔다 — `updateSession` 48곳, `getSession` 39곳, 소비 모듈 16개.
`withStoreLock`이 **동기 반환형**(`(() => T) => T`)이라 그 캐스케이드가 생긴다.

**`withSessionCommandLock`은 다르다.** 이미 `async`이고 반환형이
`Promise<T>`다(`session-store.mjs:273`). production 호출식은 **여섯 곳**이고,
전부 Promise 계약을 이미 소비한다 — await하거나 async 함수에서 return한다.

| 위치 | 형태 |
| --- | --- |
| `cli.mjs:1260`, `:1444` | async 함수에서 `return` |
| `mcp-server.mjs:334` | async 함수에서 `return` |
| `watcher.mjs:153` | `await` |
| `cli-sessions.mjs:101`, `:123` | `await` |

즉 이 함수 안의 `sleepBlockingMs`는 **호출부 시그니처를 하나도 바꾸지 않고**
제거할 수 있다. G1의 나머지(`withStoreLock` 계열)와 성격이 완전히 다르다.

그리고 이건 그냥 최적화가 아니다. `000_plan.md`가 pre-poll 블로킹 구간 넷 중
2번으로 지목한 지점이고, 여기서 막히면 **`--timeout`이 시작도 하기 전에
멈춘다.**

## 측정 (2026-07-31)

P2를 이 함수의 실제 파라미터로 재현했다 — `LOCK_RETRY_MS = 25`,
최대 `LOCK_RETRY_LIMIT = 200`회.

```
12회 재시도 (락 경합 시 흔한 구간):
  blocking  384ms 동안 50ms 타이머 timerFiredDuringBlock=false   ← FAIL
  async     319ms 동안 timerFiredDuringWait=true                  ← PASS
```

최악의 경우는 200회 × 25ms = **5초**다. 그동안 이벤트 루프가 통째로 멈춘다 —
타이머도, 예산 계약이 나중에 걸 어떤 데드라인도 돌지 않는다.

## 처방

`sleepBlockingMs`를 `withSessionCommandLock`의 재시도 경로에서만 걷어낸다.

```js
// session-store.mjs:298
-            sleepBlockingMs(LOCK_RETRY_MS);
+            await delayMs(LOCK_RETRY_MS);
```

`delayMs`는 `setTimeout` 기반 `Promise`다. `unref()`는 **하지 않는다** —
락을 기다리는 동안 프로세스가 종료되면 안 된다.

`withStoreLock`(`:161`)의 호출은 **그대로 둔다.** 그쪽은 동기 반환형이라
87곳 캐스케이드가 따라온다. `sleepBlockingMs` 함수 자체도 남긴다.

### 왜 재시도 횟수를 예산으로 바꾸지 않는가

`LOCK_RETRY_LIMIT`을 데드라인 기반으로 바꾸는 것이 최종 형태지만, 그건 예산
primitive가 있어야 한다. **이 work-phase는 "기다리는 동안 이벤트 루프가 살아
있다"까지만 한다.** 그것이 P2-command-lock subprobe가 묻는 전부이고, 전체
P2와 G1이 성립하기 위한 전제 중 하나다.

## 검증

**V1은 전체 P2 반전이 아니라 command-lock sleep에 대한 subprobe다.** 전체 P2와
G1은 FAIL/unmet으로 남는다 — `withStoreLock`의 blocking retry, 양쪽 락의
`openSync`/`writeFileSync`/`readFileSync`/`unlinkSync`, deadline-aware 중단이
전부 그대로다.

| # | 시나리오 | 관측 |
| --- | --- | --- |
| V1 | 락 경합 중 타이머 | `P2-command-lock subprobe PASS` — 대기 동안 `setTimeout`이 발화한다 |
| V2 | 락 없음 | 즉시 획득, 대기 없음 (회귀 방지) |
| V3 | 경합 후 해제 | 락이 풀리면 획득에 성공한다 |
| V4 | stale 락 | 기존 unlink 후 재시도 동작 보존 |
| V5 | 한도 소진 | 기존 throw 메시지 보존 |
| V6 | 콜백 throw | finally의 락 해제 보존 |

V1이 이 work-phase의 전부다. 나머지는 과잉 수정 방지다.

### V1의 이벤트 순서 — "타이머가 발화했다"만으로는 부족하다

waiter가 **끝난 뒤** 타이머가 발화해도 그 검사는 통과한다. 경합이 실제로
성립했다는 증거가 함께 필요하다. 다음 순서를 고정한다.

1. 첫 `withSessionCommandLock`이 락을 획득하고 deferred를 기다린다
2. holder 획득을 확인한 **뒤** release 타이머를 등록한다
3. 같은 sessionId로 두 번째 waiter를 시작한다
4. 타이머 콜백 안에서 `waiterSettled === false`를 assert하고 holder를 푼다
5. 이벤트 순서가 `holder-acquired → timer-fired → holder-released → waiter-acquired`인지 검사한다

blocking mutation이면 두 번째 호출이 이벤트 루프를 막아 타이머가 발화하지
못하고 약 5초 뒤 throw하므로 확실히 RED다. V3(경합 후 획득)도 같은 테스트가
증명한다.

### mutation proof

`await delayMs(...)`를 `sleepBlockingMs(...)`로 되돌리면 V1이 RED가 되어야
한다. 되지 않으면 V1은 무의미하다 — WP10·WP11에서 이 확인을 빠뜨린 테스트가
반복해서 나왔다.

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `web-ai/session-store.mjs` | `delayMs` 추가, `:298` 한 줄 교체 |
| `test/unit/web-ai-session-command-lock.test.mjs` 또는 기존 스위트 | V1~V6 |

## 실행 결과 (2026-07-31)

커밋 둘: `cf19c3e`(소스), `937b4d6`(테스트 보강).

측정된 상한이 처방의 추정과 일치했다. V5가 실제로 200회 재시도를 돌아
**5407ms**에 throw한다 — 200 x 25ms다. 수정 전이라면 그 5.4초 동안 이벤트
루프가 통째로 멈춰 있었다는 뜻이다.

mutation: blocking 복원 시 V1이 **6432ms에 RED**(수정본 85ms).

### 감사가 잡은 것

| # | 지적 |
| --- | --- |
| 1 | 호출부를 5곳으로 셌으나 실제 6곳 (`cli-sessions.mjs:123` 누락) |
| 2 | "전체 P2 반전"으로 과대 표기 — subprobe다 |
| 3 | V1이 "타이머 발화"만 보면 waiter 종료 후 발화해도 통과 |
| 4 | **V5 부재** — "약 5초로 유한하다"가 이 변경의 안전 주장인데 테스트가 없었다 |
| 5 | V2의 wall-clock 200ms가 flaky이고, 150ms 지연을 넣어도 통과 |

4번이 가장 중요하다. blocking loop를 200개 순차 타이머로 바꾸는 것은 **상한이
유지될 때만** 개선이다. 그 전제를 검증하지 않았다.

5번은 반대 방향의 같은 실수다 — 테스트가 통과하지만 아무것도 보장하지 않는다.
`setTimeout` spy로 바꾸니 acquire 경로에 `await delayMs(1)` 하나만 넣어도
RED가 된다.

### 검증

```
npx vitest run test/unit test/integration
  Test Files 179 passed (179); Tests 2007 passed (2007)
npm run gate:all              All 16 gate(s) passed (exit 0)
npm run typecheck             exit 0   (.mjs 미대상)
bash structure/check-doc-drift.sh   164 passed
bash structure/verify-counts.sh      76 passed
```

## 이 work-phase가 닫는 것과 닫지 않는 것

닫는 것: command-lock 경합 재시도의 **결정적 5초 event-loop freeze** 제거.
그 이상이 아니다.

닫지 않는 것:

- **G1의 나머지** — `withStoreLock`과 그 87곳 캐스케이드. 별도 work-phase다.
- **pre-poll 구간 2번 자체** — 동기 FS(`openSync`/`writeFileSync`/`readFileSync`/
  `unlinkSync`)와 deadline-aware 획득이 남아 있어 open으로 유지한다.
- pre-poll 구간 1·3·4 — implicit session 해석, 페이지 해석, active-command 등록.
- c7/c8의 예산 상한. G2~G4도 그대로다.

**G1을 met으로 적지 않는다.** 제한된 부분 개선이다.
