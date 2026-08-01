# 070 — WP16 hard deadline 독립 검증 (커밋 93f21f0)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP16
- 대상: 커밋 `93f21f0` — 내가 작성하지 않았으나 `dev` 공유 이력에 들어온 변경

## 왜 검증하는가

이 커밋은 **c7의 핵심**을 주장한다 — "정체된 read가 `--timeout`을 넘기지
못한다". 앞선 WP10~WP15는 전부 **throw하는 read**를 다뤘고, 이 커밋은
**settle하지 않는 read**를 다룬다. `021`이 처음부터 지목한 결함이 그것이다.

작성자가 다르다는 이유로 검증을 건너뛸 수 없다. 이미 `dev`에 있고, c7의
met/unmet 판정이 여기 달려 있다.

## 활성화 관측 (C-ACTIVATION-GROUNDING-01)

커밋 메시지가 주장하는 수치를 **before/after 워크트리로 직접 재현**했다.

`page.evaluate`가 `new Promise(() => {})`를 반환한다 — throw하지 않고 영원히
settle하지 않는다. 이것이 이슈가 보고한 정확한 형태다.

```
93f21f0~1 (before):  budget 2s → {"elapsedMs":12001,"kind":"STILL-HANGING"}
                     (12초 하네스 타임아웃에 걸려 강제 종료)
93f21f0   (after):   budget 2s → {"elapsedMs":2001,"status":"timeout",
                      "warnings":["poll-deadline-exceeded","target-identity-unverified"]}
```

**커밋 메시지의 8002ms는 그 하네스의 8초 한도였다.** 실제로는 상한이 없다 —
12초 한도를 주면 12초를 넘긴다. 주장이 오히려 보수적이었다.

warning에 `target-identity-unverified`가 함께 남는 것도 확인했다. WP11의
observation ledger가 hard-deadline 반환에도 병합된다는 뜻이다.

## 예산 계약 3요소 대조

`000_plan.md`가 "반환 보장"의 조건으로 셋을 요구한다. 각각을 실측했다.

### 1. Sync isolation — **부분**

WP12가 `withSessionCommandLock`의 `Atomics.wait`를 없앴고, 이 커밋은 타이머
콜백에서 세션 쓰기를 하지 않는다(동기 store 락을 타이머 안에서 잡으면 이벤트
루프가 멈춘다는 이유를 주석에 적었다 — 맞는 판단이다).

남은 것: `withStoreLock`의 blocking retry와 양쪽 락의 동기 FS. G1 미해결.

### 2. Late-side-effect fencing — **미충족** (판정 정정)

처음에 이 항목을 충족으로 적었다. **틀렸다.** 아래에 그 경위와 반증을 남긴다.

내가 돌린 하네스는 `skipFinalize: true`로 폴을 불렀다. 그 플래그가 세션에
답을 쓰는 유일한 경로를 통째로 건너뛴다. 관측한 `answer=null`은 fencing이
막아낸 결과가 아니라 **쓰는 코드가 아예 실행되지 않은 결과**였다. 하네스가
검사 대상을 우회하고 있었다.

코드를 보면 fence가 걸릴 자리에 아무것도 없다.

- `web-ai/chatgpt.mjs:861` — `commitIfActive`가 정의돼 있다. 데드라인이 지난
  뒤 새 side effect를 시작하지 못하게 막는 게이트다.
- 이 함수의 **호출은 0건이다.** `rg -n "commitIfActive" web-ai/chatgpt.mjs`가
  정의 한 줄만 돌려준다.
- 같은 이유로 `run.expired`도 `chatgpt.mjs:862`의 읽기 한 곳뿐이고, `true`로
  바꾸는 코드가 없다. 플래그가 영원히 `false`다.

막지 못하는 경로는 구체적이다. `status: 'complete'`로 끝나는 반환이 네 곳이고,
**네 곳 모두** 직전에 `finalizeProviderTab`을 부른다 — `chatgpt.mjs:984-992`,
`1119-1122`, `1247-1250`, `1326-1329`. 그 함수는 `tab-finalizer.mjs:66-72`에서
`updateSession(..., { status: 'complete', answer: answerText })`를 실행한다.

전제를 정확히 적는다. 정체된 read가 데드라인 직후 settle한다고 해서 항상
finalize에 닿지는 않는다. 그 tick에서 completion 후보·`finished`·ordering·
identity·stable window가 전부 성립했거나 recovery가 답을 건져 올린 경우여야
한다. 아니면 deferred나 timeout으로 빠진다. 조건이 성립한 경우의 순서가 아래다.

1. wrapper의 race가 `timeout` 봉투를 호출자에게 돌려준다 (`chatgpt.mjs:730-732`)
2. 취소되지 않은 `runPollWebAi`가 계속 실행된다
3. `finalizeProviderTab`이 `status: 'complete'`와 `answer`를 세션에 쓴다
   (`tab-finalizer.mjs:66-72`) — 막는 게이트가 없다
4. finalizer가 끝난 뒤에야 `runPollWebAi`가 resolve한다
5. 그제야 `.then` 정규화가 `POLL_EXPIRED`로 바꾼다 (`chatgpt.mjs:720-728`)
   — **부수효과는 이미 났다**

반환값은 정규화되고 세션은 오염된다. 호출자는 timeout을 받았는데 store에는
완료된 답이 남는다. `commitIfActive`가 정확히 이걸 막으려고 작성됐지만 어디에도
연결되지 않았다.

### 3. Single-flight — **미충족**

같은 세션을 세 번 폴하며 pending evaluate를 셌다.

```
poll 1 → timeout, pendingEvaluates=1
poll 2 → timeout, pendingEvaluates=2
poll 3 → timeout, pendingEvaluates=3
```

선형으로 쌓인다. **커밋이 스스로 "single-flight remains unsolved"라고 적은
그대로다.** 다만 표현은 낮춰 적는다 — 관측된 것은 "프로세스를 붙잡는다"가
아니라 **패배한 작업이 해제되지 않고 선형으로 누적된다**는 사실이다. active
handle 잔존이나 프로세스 종료 방해는 이 하네스로 측정하지 않았다.

## 구현 심사 (독립 감사 R1)

행동 관측만으로는 구현을 심사할 수 없다고 위에 적었고, 그래서 reviewer
서브에이전트에 코드 감사를 붙였다. 차단급 결함 다섯 건이 나왔고 **다섯 건 전부
내가 소스에서 재확인**했다.

| # | 결함 | 위치 | 확인 방법 |
| --- | --- | --- | --- |
| 1 | `input.timeout`이 없으면 hard deadline이 무조건 **1초** | `chatgpt.mjs:691` | 세션 예산 30초인데 `elapsedMs:754, status:timeout` |
| 2 | `commitIfActive` 호출 0건 → late side effect 무방비 | `chatgpt.mjs:861` | `rg` 결과 정의 1건 / 호출 0건 |
| 3 | 고정된 `Date.now` 아래에서 `arm()`이 영원히 재무장 | `chatgpt.mjs:707-712` | **실측됨** — 아래 참조 |
| 4 | recovery reserve가 **500ms 상한에 묶여** `RECOVERY_RESERVE_MS`에 못 미침 | `chatgpt.mjs:829-834` | 산식 실행: 1s→250, 1.5s→375, 2s↑→500 |
| 5 | 회귀 테스트 부재 | — | **해소됨**: 커밋 `9566cec`가 Y1/Y2c/Y5/Y7 추가 |

1번이 가장 무겁다. CLI가 poll/watch/resume에서 `--timeout`을 **의도적으로**
`undefined`로 넘긴다(`cli.mjs:730-738`) — 저장된 세션 데드라인의 잔여를
예산 해석기가 물려받게 하려는 설계다. 그런데 wrapper는 그 해석기를 타지 않고
`Math.max(1, ...)`로 곧장 1초를 만든다(`chatgpt.mjs:691`). 안쪽 루프만
`resolveTimeoutBudgetSec`를 쓴다(`chatgpt.mjs:769-775`). **바깥 상한과 안쪽
예산이 서로 다른 값을 본다.** 30분짜리 deep-research 폴이 1초에 잘린다.

4번은 산식의 한 항이 죽어 있다. `Math.max(PACING_INTERVAL_MS, budgetMs % PACING_INTERVAL_MS)`
에서 나머지는 항상 500 미만이므로 이 항은 언제나 정확히 500이다.

다만 전체가 `Math.min`이라 결과가 늘 500인 것은 아니다. 작은 예산에서는 다른
항이 이긴다.

```
budget  1000ms → reserve 250   (ratio 항이 이김)
budget  1500ms → reserve 375
budget  2000ms → reserve 500
budget 10000ms → reserve 500
budget 60000ms → reserve 500
```

정확한 진술은 "reserve가 500ms에 **상한 고정**되고 2초 이상 예산에서는 항상
500ms"다. 결론은 그대로다 — `RECOVERY_RESERVE_MS = 2_000`은 **어떤 예산에서도
도달할 수 없다.** 상수가 선언한 의도가 산식에 반영되지 않았다.

### 3번 실측

R1 시점에는 코드 경로로만 확정했던 항목이다. 하네스로 재현했다.

`Date.now`를 한 값으로 고정하고 예산 2초짜리 폴을 걸었다. `arm()`이 매번
`hardDeadline - Date.now()`를 다시 재므로 남은 시간이 줄지 않고, 타이머가
250ms마다 자기를 다시 건다.

```
예산 2s, Date.now 고정 → 6초 한도까지 {"kind":"STILL-HANGING"}
```

**반환 자체가 일어나지 않는다.** 다른 결함들은 반환을 잘못된 시점에 만들지만
이 결함은 반환을 없앤다. 주석은 "테스트가 시계를 독립적으로 움직일 수 있으니
wall time만으로 만료시키지 않는다"고 근거를 적었는데, 그 방어가 시계가 아예
멈춘 경우를 무한 대기로 바꾼다. 이 파일의 기존 하네스가 `Date.now`를 mock하는
방식(`activity-poll.test.mjs:14-21`)이 정확히 그 조건이다.

## c7 판정

c7은 두 가지를 요구한다.

| 요구 | 상태 |
| --- | --- |
| fail-open B03·B06 교정 | **충족** (WP10) |
| 담당 경계 15개가 예산 계약 아래 데드라인을 인지 | **부분** |

두 번째가 핵심이다. 이 커밋은 **진입점에서 반환을 보장**하지만 경계별로
데드라인을 인지시키지 않는다. 차이가 중요하다.

- 보장되는 것: 명시적 `timeout`을 주고 `Date.now`가 정상 진행하는 하네스에서
  호출자가 그 시간 안에 결과를 받는다 (관측 범위를 이만큼으로 좁힌다 —
  결함 1·3이 이 조건을 벗어난 경우를 각각 깬다)
- 보장되지 않는 것: 정체된 작업이 멈춘다, 반복 폴이 자원을 해제한다

`000_plan.md`의 수용 기준은 "**패배한 작업이 프로세스를 붙잡지 않음**"을
명시적으로 포함한다. single-flight 실측이 증명한 것은 그중 **작업의 선형
누적**까지다. 프로세스를 실제로 붙잡는지는 별도 측정이 필요하고, 그 측정 없이
이 기준을 met으로 적을 수는 없다.

**c7을 met으로 적지 않는다.** 반환 보장은 달성됐고 그것이 이슈 본문의 증상을
없앤다 — 하지만 계약 3요소 중 **둘**이 미충족이다(fencing, single-flight).
처음 적은 근거(“fencing 충족”)는 위에서 반증했으므로 판정 근거를 교체한다.

게다가 1번 결함 때문에 반환 보장 자체가 실제 CLI 경로에서 **잘못된 값으로**
걸린다. 호출자는 `--timeout` 안에 결과를 받는 게 아니라 1초 만에 timeout을
받는다. 증상이 행에서 조기 종료로 바뀌었을 뿐 계약은 여전히 깨져 있다.

## 이 work-phase가 확인한 것과 확인하지 못한 것

확인: 활성화 관측(before/after), single-flight 반증, observation ledger 전파,
구현 감사 5건과 그 소스 재확인.

확인 못 함:

- G2·G4.
- 실제 ChatGPT에서의 동작. 하네스는 fake page다.

## WP17에서 실제로 고친 것

감사에서 나온 결함 1·2·3·4를 고쳤다. 5번은 `9566cec`가 이미 해소했다.

### 1. 예산 해석 통일 (`chatgpt.mjs:690-697`)

wrapper가 안쪽 루프와 **같은** 해석기를 쓰게 했다.

```js
const session = input.session ? getSession(input.session) : null;
const timeoutSec = resolveTimeoutBudgetSec(input, session, input.vendor || 'chatgpt');
```

`poll`/`watch`/`resume`가 넘기는 `undefined`가 이제 저장된 세션 데드라인의
잔여로 해석된다. 바깥 상한과 안쪽 예산이 같은 값을 본다.

### 2. fence 배선

`commitIfActive`가 호출 0건이던 문제의 뿌리는 **`run.expired`를 아무도 켜지
않는다**는 것이었다. wrapper가 토큰을 만들어 안쪽 run에 내려주고, `finally`에서
`runToken.expired = true`를 세운다. 순서가 중요하다 — 패배한 run이 아직 tick
중일 수 있고, 이 플래그가 그 다음 commit을 throw시킨다.

그리고 데드라인 이후 부수효과 경로를 게이트에 통과시켰다.

| 경로 | 방식 |
| --- | --- |
| finalizer 4곳 | `commitAsyncIfActive` |
| crashed 세션 쓰기 | `commitIfActive` |
| deferred 세션 쓰기 (4개 호출) | `buildDeferredPollingResult`에 `commit` 주입 |
| timeout 세션 쓰기 2곳 | `commitIfActive` |
| 하트비트 stderr 출력 | `isActiveRun()` — throw가 아니라 skip |
| resolver trace 저장 2곳 | `commitIfActive` |
| generated image / images / 첨부파일 저장 | `commitAsyncIfActive` |
| diagnostics 캡처 | `commitAsyncIfActive` |

deferred는 호출부 네 곳을 각각 감싸는 대신 빌더에 게이트를 넘겼다. 쓰기가 그
함수 안에 있으므로 거기서 한 번 막는 편이 빠뜨릴 여지가 없다.

**첫 배선은 finalizer와 세션 쓰기만 덮었다.** 감사가 나머지를 전수로 지적했고,
Y8 실행 로그에 `[poll] 3s — settling...`이 데드라인 이후 실제로 찍힌 것이
증거였다. 반환한 뒤에도 진행 상황을 계속 떠드는 폴이다.

하트비트만 throw가 아니라 skip인 이유는 그것이 부수효과가 아니라 알림이기
때문이다. 나머지는 throw해서 `POLL_EXPIRED`로 정규화된다.

#### await를 넘는 부수효과

`commitAsyncIfActive`는 **시작 전에 한 번만** 검사한다. 시작된 async 작업은
되돌릴 수 없으므로 게이트의 일은 시작을 거부하는 것이다.

그런데 `finalizeProviderTab`은 데드라인 **전에** 시작해도 `archiveConversation`
await 뒤에 `updateSession({archived:true})`와 `poolTab`을 실행한다. 진입 시점
검사만으로는 이 쓰기를 막지 못한다.

그래서 finalizer에 `stillActive` 콜백을 넘기고 await **직후 다시** 검사한다
(`tab-finalizer.mjs`). 만료됐으면 archive 쓰기를 건너뛰고
`archiveSkippedReason: 'poll-deadline-exceeded'`로 돌려준다.

### 3. 단조 시계 상한

`arm()`이 보고된 시계만 믿는 한 무한 재무장을 피할 수 없다. `process.hrtime`
기반 단조 시계로 실제 경과를 함께 재고, 둘 중 **먼저** 만료되는 쪽을 따른다.

```js
const monotonicElapsedMs = monotonicNowMs() - monotonicStart;
if (remaining <= 0 || monotonicElapsedMs >= monotonicCeilingMs) { resolve(POLL_EXPIRED); return; }
```

상한은 `timeoutMs + POLL_EXPIRY_CHECK_MS`다. 시계를 실시간보다 **빠르게** 미는
테스트는 첫 조건에 먼저 걸리므로 잘리지 않고, 시계가 멈추거나 아주 느린 경우에만
두 번째 조건이 발화한다.

엄밀히 말해 이 상한은 hard bound가 아니다. 검사 주기와 이벤트 루프 지연이 더해져
Y10 실측이 2초 예산에 2514ms였다. "예산 + 검사 주기 + 스케줄링 지연"이 정확한
표현이다.

이 절은 한 번 다시 썼다. 내가 처음 넣은 것은 "보고된 시계가 한 값에 머문 시간"을
재는 형태였는데(전체 스위트에서 `T14b`가 깨져서 그렇게 바꿨다), 이 세션과 동시에
작업한 다른 주체가 커밋 `4390fb6`에서 단조 경과 방식으로 교체했다. 지금 코드는
후자다. **문서가 존재하지 않는 코드를 설명하고 있었다.**

### 5. arm 이전 동기 IO 제거

감사가 추가로 잡은 것이다. 예산 해석을 wrapper로 옮기면서 `getSession()`이
**타이머를 걸기 전에** 실행됐다. 그 읽기는 `withStoreLock`의 동기 FS와 blocking
retry를 탄다. store 경합이 5초 걸리면 watchdog은 그 뒤에야 시작한다 — 데드라인을
보장하려는 코드가 데드라인 밖에서 블로킹한 셈이다.

두 가지를 고쳤다.

- 명시적 `timeout`이면 세션을 아예 읽지 않는다. 흔한 경로가 락을 건드리지 않는다.
- `started`와 `monotonicStart`를 함수 **첫 줄**로 옮겼다. 저장된 데드라인을
  읽어야 하는 경우에도 그 읽기에 걸린 시간이 예산 안에 들어간다.

완전한 해결은 G1(async store)이다. 여기서는 상한 밖으로 새는 것만 막았다.

### 4. 죽은 항 제거 (`chatgpt.mjs:876-892`)

`Math.max(PACING_INTERVAL_MS, budgetMs % PACING_INTERVAL_MS)`를 지웠다. 항상
500이라 상수를 무력화하던 항이다. ratio 항과 최소 루프 예산 항이 이미 작은
예산을 지키므로 안전 장치가 사라지지 않는다. 이제 `RECOVERY_RESERVE_MS = 2_000`
이 충분히 큰 예산에서 실제로 적용된다.

## 회귀 테스트와 mutation 확인

세 개를 추가했다(`web-ai-chatgpt-activity-poll.test.mjs`). 기존 Y1/Y2c/Y5/Y7이
전부 `skipFinalize: true`라서 fencing을 검사하지 못한다는 점이 출발점이다.

**GREEN은 증거가 아니다.** 각 테스트를 해당 수정만 되돌린 mutation으로 RED
확인했다.

| 테스트 | mutation | RED 출력 |
| --- | --- | --- |
| Y8 (fence) | `commitIfActive` 게이트를 `if (false)`로 | `expected 'late answer' to be null` |
| Y9 (예산) | 1초 기본값으로 복원 | `expected 1044 to be greater than 1500` |
| Y10 (frozen clock) | stall ceiling 항 제거 | `expected 'STILL-HANGING' to be 'timeout'` |
| Y8 (하트비트) | `isActiveRun()`를 `true`로 | `expected [ '[poll] 3s — settling...' ] to deeply equal []` |
| Y11 (reserve) | 죽은 항 복원 | `expected 7671 to be less than 7000` |

Y10의 mutation은 **재설계 후 다시 확인**했다. 구현이 바뀌었으므로 이전 mutation
결과는 근거가 되지 못한다.

감사 지적을 받아 테스트를 한 번 더 강화했다.

- **Y8**은 세션 3필드만 보던 것을 실제 ledger로 바꿨다. `archived`와 하트비트
  stderr까지 포함한다. "side-effect ledger가 필요하다"고 문서에 적어놓고 정작
  구현하지 않았던 부분이다.
- **Y9**의 창을 `1500~6000`에서 `2600~4500`으로 좁혔다. 이전 범위는 상수 2초
  구현도 통과시켰다 — 저장된 3초 예산을 **상속**한다는 주장을 증명하지 못했다.
- **Y11**을 새로 추가했다. blocker 4에는 테스트가 아예 없었고, 기존 2초 fixture는
  수정 전후 모두 reserve가 500ms라 죽은 항을 되살려도 통과했다. 8초 예산에서
  reserve 2초가 실제로 주어지는지 루프 종료 시점으로 관측한다.

Y8이 특히 중요하다. 세션 store에 `late answer`가 실제로 기록되는 것을 보여준다
— 문서 앞부분에서 논증만 했던 오염이 관측으로 확인됐다.

Y8 하네스는 한 번 고쳤다. 처음에는 첫 read만 막았는데 결과가 `complete`로
나왔다. reader들이 개별적으로 bounded라 루프가 회복해 데드라인 전에 끝난 것이다.
**막으려던 조건을 하네스가 만들지 못하고 있었다.** 모든 read를 2.6초까지 붙잡는
형태로 바꾸고 나서야 의도한 late-completion이 재현됐다.

`T14b` 회귀도 같은 교훈의 다른 얼굴이다. 단일 파일 실행은 통과하고 전체
스위트에서만 깨졌다 — 파일 하나만 돌려서는 시계 관련 변경을 검증할 수 없다.

## WP18: Y8이 부하에 따라 흔들렸다

위 표의 Y8 RED는 **재현되지 않았다.** 같은 커밋에서 Y8만 반복해 돌리자
43회 중 3회 실패했고, mutation을 넣지 않은 깨끗한 트리에서도 5회 중 2회
실패했다. 그러면 표의 "mutation으로 RED"는 근거가 아니다 — 부하에 따라
색이 바뀌는 테스트에서 한 번의 RED는 mutation이 잡혔다는 뜻이 아니다.

원인은 두 가지였고 둘 다 하네스에 있었다.

**1. 스톨 기준점이 poll 밖에 있었다.** `clearAt`을 테스트 본문 진입 시점에
`Date.now() + 2600`으로 고정했는데, 데드라인은 `pollWebAi` 호출 시점부터
흐른다. 그 사이의 세션 생성·baseline 저장이 실제 저장소에 쓰기를 하므로
부하가 걸리면 수백 ms가 든다. 그만큼 clear 시점이 데드라인 **앞으로**
당겨지고, 그러면 run은 정상적으로 답을 읽고 정당하게 finalize한 뒤에야
race에서 진다. late-completion이 아니라 **early-completion**이었다. 첫 read가
실제로 호출될 때 기준점을 잡도록 바꿨다.

**2. `innerText`는 원인이 아니었다.** 처음에 텍스트 폴백이 게이트 밖이라
루프가 그 경로로 일찍 끝난다고 적고 같이 고쳤다. **틀렸다.** 감사가
반증했다 — `runPollWebAi`는 `page.innerText`를 부르지 않는다. 유일한 직접
호출은 전송 시점 baseline(`chatgpt.mjs:375`)이고, Y8의 locator는 `all()`이 빈
배열이라 locator 쪽 `innerText`에도 닿지 않는다. 즉시 반환하는 `innerText`로
되돌린 하네스도 `answer: null`을 그대로 냈다. 게이트에 넣은 것 자체는 무해하나
flake의 원인이 아니었으므로 근거에서 뺀다. **1번만이 실제 원인이다.**

고친 뒤 Y8은 단독 8/8, 파일 전체 3회 59/59로 통과한다.

### mutation 재확인

개별 fence 하나만 되돌리는 mutation은 **전부 GREEN이었다.** 두 게이트가 서로를
가린다 — `commitIfActive`(chatgpt.mjs)와 `stillActive`(tab-finalizer.mjs)는
같은 쓰기를 각각 막으므로 한쪽을 지워도 다른 쪽이 잡는다. 둘을 **함께** 지웠을
때만 3/3 RED가 나온다(`expected 'late answer' to be null`).

이것을 실패로 적지 않는다. 이중 방어는 의도된 것이고, Y8이 증명하는 명제는
"두 게이트 중 최소 하나가 살아 있다"이다. 다만 표에 "`commitIfActive` 게이트를
`if (false)`로 → RED"라고 적은 것은 **틀렸다.** 그 mutation만으로는 GREEN이다.

| mutation | 결과 |
| --- | --- |
| `commitIfActive` 게이트 제거만 | GREEN (finalizer가 막음) |
| finalizer `stillActive` 진입 검사 제거만 | GREEN (commit 게이트가 막음) |
| **둘 다 제거** | **RED 3/3** — `expected 'late answer' to be null` |
| 하트비트 `isActiveRun()` 제거 | RED 3/3 — `[poll] 3s — settling...` |

### 부수적으로 드러난 것 — G1의 실물

반복 실행 중 Y8이 이렇게 죽은 적이 있다.

```
Error: web-ai session store: failed to acquire lock at
  ~/.browser-agent/web-ai-sessions.json.lock after 200 attempts
  ❯ withStoreLock web-ai/session-store.mjs:164:11
```

vitest 두 프로세스가 동시에 돌던 때였다. 이 파일은 `BROWSER_AGENT_HOME`을
임시 디렉터리로 돌리지만, 락 경합 자체는 `withStoreLock`의 200회 blocking
retry가 그대로 노출된 것이다. c7이 unmet으로 남겨둔 **G1이 테스트 환경에서
실제로 관측된 사례**다. 별도 유닛의 근거로 남긴다.

## WP19: 감사 FAIL과 그 교정

`6a5a2b2`를 sol high 리뷰어에 독립 감사시켰고 **FAIL**을 받았다. blocker 1건과
should-fix 4건. 전부 소스에서 재확인했다.

### blocker — finalizer의 진입 검사가 이후 단계를 막지 않는다

`finalizeProviderTab`은 진입에서 한 번만 `stillActive`를 봤다. 그 아래의 각
단계는 **자기 안에서 데드라인이 지날 수 있다.** 세션 쓰기는 store 락을 잡고
(`session-store.mjs:136-164`, 200회×25ms retry), archive는 provider UI를
클릭한다. 감사가 `stillActive`가 한 번만 true인 하네스로 재현했다.

```json
{"result":{"archiveSkippedReason":"poll-deadline-exceeded"},
 "status":"complete","answer":"late answer","transcriptExists":true}
```

데드라인이 지났다고 **보고하면서 이미 완료된 답과 transcript를 써버린** 상태다.

단계마다 재검사하도록 고쳤다(`expired()`). transcript 저장 전, archive **호출
전**(기존 검사는 클릭이 끝난 뒤였다), pooling 전.

테스트 3개를 `web-ai-tab-finalizer.test.mjs`에 추가했다. 경계마다 만료시키고
그 이후 아무 일도 없었는지 본다. 세 번째는 짝 assertion이다 — 항상 거부하는
게이트도 앞의 둘을 통과시키므로 정상 경로가 여전히 finalize되는지 확인한다.

mutation RED: 재검사 두 개를 되돌리면 `expected [{kind:'transcript',…}] to
deeply equal []`와 `expected "spy" to not be called at all, but actually been
called 1 times`.

### should-fix — 임시 home이 static import 이후에 설정된다

`session-artifacts.mjs:8`과 `session.mjs:58`이 `BROWSER_AGENT_HOME`을 **import
시점 상수**로 고정했다. 테스트 본문이 임시 디렉터리를 가리켜도 static import가
먼저 실행되므로 baseline과 artifact는 **개발자의 실제 `~/.browser-agent`에**
쓰이고 있었다. 둘 다 호출 시점 해석 함수로 바꿨다.

### 남긴 것

- copy 버튼 클릭(`copy-markdown.mjs:139-147`)과 CDP 세션 생성이 게이트 밖이다.
  durable write는 막혀 있으나 provider UI 조작과 세션 생성 자체는 아니다.
- 저장된 데드라인 상속 시 store 읽기 시간이 두 번 차감된다(`chatgpt.mjs:710`
  vs `:723`). `poll`만 해당하고 `watch`/`resume`는 명시적 timeout을 넘긴다.
- Y8은 문서가 주장한 "side-effect ledger"가 아니다. trace/image/file/
  diagnostics fence를 지워도 green이다.

세 항목 모두 이번 사이클에서 닫지 않는다. 별도 유닛의 근거로 남긴다.

## WP20: 2라운드 감사도 FAIL — 같은 결함의 한 칸 아래

`0b5512d`를 같은 리뷰어에 다시 걸었고 또 **FAIL**이 나왔다. 진입 검사 하나를
단계별 재검사로 바꿨는데, 그 재검사들 **사이**에 또 틈이 있었다.

### blocker — transcript 저장 이후가 다시 무방비

`trySaveTranscript` **앞**에는 검사를 넣었지만 **뒤**에는 없었다. 파일 쓰기
자체가 시간을 쓰므로 그 안에서 데드라인이 지날 수 있고, 그러면 바로 다음의
`appendArtifactRecord`(세션 쓰기)와 실패 시 warning 쓰기가 만료 후에 시작한다.

리뷰어가 `stillActive`를 **transcript 파일 존재 여부에 묶어서** 재현했다.
파일이 생긴 순간부터 false다.

```json
{"activityChecks":[true,true,false],
 "transcriptExists":true,"artifactRecords":["transcript"]}
```

파일이 생겨 이미 만료 상태인데 artifact 레코드가 그대로 붙었다. 저장 직후
재검사를 추가했다.

이 패턴이 이 유닛에서 반복된다. **한 단계를 막으면 그 다음 단계가 드러난다.**
"await를 건너면 재검사한다"가 아니라 **부수효과 하나마다 재검사한다**로
규칙을 바꿔야 끝난다.

### 테스트 공백 세 개

리뷰어가 지적한 대로 기존 3개는 경계를 다 덮지 못했다. pooling 경계의
`expired()`를 지워도 셋 다 green이었다. 셋을 추가했다.

| 테스트 | 경계 | mutation RED |
| --- | --- | --- |
| transcript 저장 중 만료 | 저장 직후 ~ artifact 레코드 | 재검사 제거 → `expected [{kind:'transcript',…}] to deeply equal []` |
| pooling 직전 만료 | archive 이후 ~ poolTab | 재검사 제거 → 1 failed |
| 파일 실재 확인 | 세션 레코드와 별개 | — (기존 테스트 보강) |

마지막은 assertion 보강이다. `session.artifacts`만 보면 **파일만 남는 유출**을
놓친다. `transcript.md`의 실재를 직접 본다.

### baseline 캐시가 home을 따라가지 않았다

경로는 호출 시점 해석으로 고쳤지만 `baselines` Map과 `loaded` 플래그가
모듈 전역이었다. home B에서 읽은 행이 home C의 읽기에 답하고, C에 저장할 때
**두 home의 행이 함께** 기록됐다. 플래그를 `loadedFrom` 경로로 바꾸고 경로가
달라지면 map을 비운다.

`context-pack/builder.mjs:34`도 같은 import-time 고정이었다. 그 테스트가
static import를 쓰므로 실제 `~/.browser-agent`에 패키지를 쓰고 있었다.

### 리뷰어가 유보한 것

deferred 3건 중 **저장된 데드라인 이중 차감**은 "#88을 닫았다고 말하기 전에
고쳐야 한다"고 못박았다. 동의한다. 이 유닛의 계약은 durable write 차단이므로
여기서 닫지 않되, **#88 종료 조건에 포함**시킨다.

## WP22: 데드라인 이중 차감 교정과 4라운드 감사

리뷰어가 "#88 종료 전 필수"로 지정한 항목이라 미루지 않고 고쳤다.

### 결함

`resolveTimeoutBudgetSec`는 저장된 데드라인을 **잔여 시간**으로 바꾼다. 잔여는
그것을 더할 기준점에 대해서만 옳다. 그런데 wrapper는 자기 시계를 읽게 두고,
그 잔여를 **store 읽기 이전**에 잡은 `started`에 더했다. 읽기 시간이 resolver
안에서 한 번, 기준점에서 또 한 번 빠진다. store 락은 200회×25ms를 재시도하니
경합 시 실제로 초 단위가 날아간다. 그리고 저장된 데드라인을 상속하는 경로가
바로 `poll`이다.

resolver가 이미 `nowMs`를 파라미터로 받으므로 wrapper가 자기 기준점을 넘기면
끝난다(`chatgpt.mjs:733`).

### Y12의 한계와 Y13

Y12는 resolver를 직접 불러 **산술 계약**을 고정한다. 호출부가 인자를 빼도
green이다 — 이걸 주석에 적어뒀는데 리뷰어가 "그러면 배선은 누가 지키냐"고
되물었다. 맞는 지적이다.

Y13을 추가했다. 실제 `pollWebAi`를 돌리되 resolver를 mock해서 **넘겨받은
시계를 캡처**하고 sentinel을 throw해 브라우저 작업 전에 멈춘다. 느린 store를
흉내 낼 필요 없이 밀리초 안에 배선을 증명한다. `started`를 빼면
`actual value must be number or bigint, received "undefined"`로 RED.

### pooling 테스트도 같은 병

리뷰어가 pooling 경계 테스트가 여전히 **호출 횟수 기준**임을 짚었다. 위쪽에
검사를 하나 더 넣으면 이 테스트의 탈출 지점이 경계 위로 올라가고 green으로
남는다 — archive 테스트에서 이미 겪은 것과 같은 형태다. artifact 레코드 기준
으로 바꾸고, transcript 단계가 실제로 실행됐다는 assertion을 덧붙였다. 통과가
"조기 탈출"을 뜻할 수 없게 만든다.

### 리뷰어가 남긴 것

`Math.max(1, ...)` 때문에 **1초 미만의 저장된 잔여는 1초로 늘어난다.** 이미
지난 데드라인이면 최대 1.5초까지 초과한다. 이 커밋 이전부터 있던 호환 동작이고
원래의 무한 행 결함은 아니지만, "엄격한 데드라인"이라 부를 수 없는 구간이다.
wrapper가 실제 잔여를 보존하거나 이미 지난 경우 즉시 timeout해야 한다.
별도 유닛으로 남긴다.

## 남은 것

single-flight(G2·G4 포함)는 여전히 미해결이다. 이번 변경은 패배한 작업이
**열거된 경로에서** 부수효과를 내지 못하게 만들었지만 **해제하지는 않는다.**
pending evaluate는 계속 선형으로 쌓인다. 취소 프리미티브가 필요한 별도 유닛이다.

"전부 막았다"고 쓰지 않는 이유가 있다. 게이트는 **열거된 지점**에서만 작동한다.
새 부수효과가 추가되면 게이트를 통과시켜야 하는데 그것을 강제하는 장치가 없다.
WP13의 ratchet 게이트와 같은 방식이 필요하다.

`commitAsyncIfActive`의 한계도 남는다. finalizer는 `stillActive`로 await 이후를
막았지만 `collectImages`, diagnostics, 첨부파일 저장은 시작 전 검사만 있다.
데드라인 직전에 시작하면 그 안의 파일 쓰기는 이후에 일어난다.

## 이전 계획 메모

결함 1·2·3·4를 실제로 고치고 각각을 mutation으로 RED 확인되는 테스트로 묶는다.
5번은 `9566cec`가 해소했으나 그 테스트들이 전부 `skipFinalize: true`를 쓰므로
2번을 잡아내지 못한다 — finalize를 타는 짝 테스트가 추가로 필요하다.

finalizer 하나만 막는 것으로는 부족하다는 지적을 R2에서 받았다. 데드라인 이후
세션이나 디스크에 쓰는 경로가 더 있다.

- `updateSession({status:'crashed'})` — `chatgpt.mjs:1154`
- deferred 세션 쓰기 — `:1193`, `:1236`, `:1278`, `:1302` → `:1974`
- diagnostics 캡처 — `:1268`
- timeout 세션 쓰기 — `:1343`, `:1363`
- trace/file/image 출력 — `:1034`, `:1055`, `:1093`, `:1321`, `:1937`
- archive/artifact/pool — `tab-finalizer.mjs:76-106`

그래서 B 단계의 테스트는 개별 경로를 하나씩 막는 형태가 아니라 **side-effect
ledger** 형태여야 한다. 데드라인 이후 loser를 풀어주고 나서 세션·artifact·
trace·diagnostics·archive/pool이 전부 불변인지 한 번에 검사한다. 정상 완료 시
데드라인 타이머가 정리되는지도 같이 본다.
