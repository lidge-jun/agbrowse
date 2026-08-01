# 080 — WP21 store lock의 blocking wait 제거 (G1 나머지)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP21
- 선행: `030_wp12_command_lock_async.md`가 진입점 락(`withSessionCommandLock`)을
  먼저 처리했다. 여기서는 `withStoreLock`을 다룬다

## 실측

WP16~WP20이 c7을 닫지 못한 이유를 숫자로 남긴다. 경합 상태의 `withStoreLock`을
호출하고 그 전에 50ms 타이머를 걸었다.

```
withStoreLock:      elapsed 6476ms, timerFiredAt=null
withStoreLockAsync: elapsed 5416ms, timerFiredAt=53ms
```

**타이머가 아예 발화하지 않았다.** `Atomics.wait`가 이벤트 루프를 멈추므로
데드라인 타이머도 돌지 않는다. 호출자에게 약속한 `--timeout`이 그 구간 동안
**세어지지 않는다.** WP16의 hard deadline이 이 구간을 못 덮는 게 아니라, 그
구간에서는 데드라인이라는 개념 자체가 성립하지 않는다.

## 왜 전면 전환을 하지 않는가

`getSession`/`updateSession` 계열 소비자가 130곳 가까이다. 전부 async로 바꾸면
호출 체인이 연쇄적으로 async가 되고, 그 규모는 한 work-phase의 검증 가능한
범위를 넘는다. 반쯤 바꾼 상태로 남기면 어느 경로가 안전한지 아무도 모른다.

그래서 셋으로 나눴다.

### 1. `withStoreLockAsync` 도입

락 프로토콜은 **동일하다** — 같은 경로, 같은 staleness 규칙, 같은 재시도 예산.
다른 것은 기다리는 방법뿐이다(`Atomics.wait` → `await delayMs`). 프로토콜이
같아야 두 형태를 서로 다른 프로세스가 동시에 써도 한쪽이 다른 쪽의 락을 못 보는
일이 없다.

### 2. 데드라인을 아는 경로부터 전환

`commitStagedArtifacts`를 async로 바꾸고 `appendSessionArtifactsAsync`를 쓰게
했다. 이 쓰기는 **호출자에게 데드라인을 약속한 폴 안에서** 실행된다 — WP20이
strict 계약을 위해 추가한 바로 그 경로다. 여기서 루프를 멈추면 WP20이 세운
계약이 그 순간 무효가 된다.

**쓰기만 바꾼 것은 부족했다.** 감사가 같은 경로의 읽기를 짚었다 —
`saveAssistantDownloadableFilesStrict`가 재사용 판정을 위해 `getSession`을
부르고, 그게 `listStoredSessions` → `readSessionStoreLocked` → 동기
`withStoreLock`으로 이어진다. 경합 재현에서 타이머가 발화하지 못하고 6.6초 뒤
실패했다. `readSessionAsync`를 추가해 그 읽기도 awaited lock을 타게 했다.

"나머지 동기 사용처는 데드라인 밖"이라고 처음에 적었는데 **틀렸다.** 정확히는
`insertSession`·`patchSession`·`pruneSessions`가 데드라인 밖이고,
`readSessionStoreLocked`는 `getSession`을 통해 데드라인 안에서도 불린다. 이번에
strict 경로만 우회시켰을 뿐 그 함수 자체는 여전히 동기다.

#### await가 만든 새 창

락을 기다릴 수 있게 만들자 **없던 구멍이 생겼다.** commit 직전의 `stillActive`
검사와 실제 쓰기 사이에 락 대기가 끼어든다. 감사 재현: `elapsed=82ms`,
`active=false`인데 `out.ok=true`, artifact 1건이 기록됐다. 타이머는 살아났지만
패배한 작업의 durable write는 안 막혔다.

그래서 `appendSessionArtifactsAsync`가 **락을 잡은 뒤** 다시 검사하고,
만료됐으면 `DEADLINE_PASSED`를 돌려준다. `null`(세션 없음)과 구분하는 이유는
처리가 다르기 때문이다 — 하나는 없는 레코드, 하나는 일어나면 안 되는 쓰기다.

### 3. ratchet 게이트

`no-new-blocking-io`에 `blockingStoreLock` 차원을 추가했다. `withStoreLock`은
호출부에 `Sync` 프리미티브가 없어서 기존 패턴이 **아무것도 못 본다** — 이
게이트가 스스로 "새 코드가 기존 blocking wrapper를 부르는 경우는 못 잡는다"고
적어둔 그 구멍이다.

baseline은 현재 6건으로 고정했다 — **호출자 6곳이 아니라** 함수 선언 1곳과 직접
호출 5곳이다. 전부 `session-store.mjs` 안에 있다. 실패 메시지에
`withStoreLockAsync`를 명시해서 대체재를 찾아 헤매지 않게 했다.

처음 구현은 `withStoreLock(` 형태만 셌다. 감사가 여섯 가지 우회를 실증했다 —
`withStoreLock?.(…)`, `(withStoreLock)(…)`, 값 별칭, import 별칭, computed
member 둘. 전부 통과했다. 기존 `Sync` 프리미티브는 별칭·computed 접근을 따로
거부하는데 새 차원에만 그 방어가 없었다.

지금은 직접 호출을 **세고**, 그 외의 참조는 **거부한다**. 별칭은 ratchet할 수
없기 때문이다 — manifest가 다음에 어떤 이름을 쓸지 알 수 없다. 선언 파일은
정의상 참조 하나를 갖고 있으므로 그 하나만 허용한다.

## 테스트

| 테스트 | mutation | RED 출력 |
| --- | --- | --- |
| L1 async가 타이머를 살림 | `delayMs` → `sleepBlockingMs` | `expected null not to be null` |
| W2c 새 blocking 호출자 거부 | ratchet 분기 제거 | `expected true to be false` |
| R3 락 대기 중 만료 | post-lock 재검사 제거 | `expected true to be false` |

L2는 짝이다 — **동기 락에서는 타이머가 정말로 안 도는지**를 같은 하네스로
확인한다. L1만 있으면 애초에 경합하지 않는 구현에서도 통과한다.

L3도 짝이다. 블로킹하지 않는 것은 **여전히 락일 때만** 쓸모가 있다. 중첩 획득이
거부되는지 본다.

W2d도 짝이다. async 형태까지 세면 게이트가 자기가 유도하려는 마이그레이션을
막는다.

## 남은 것

**c7은 이번에도 닫지 않는다.** 데드라인 경로의 읽기와 쓰기를 옮겼을 뿐이고,
`insertSession`·`patchSession`·`pruneSessions`와 `readSessionStoreLocked` 자체는
그대로 동기다. 다른 경로에서 `getSession`을 부르면 여전히 루프가 멈춘다.

게이트가 **직접 호출과 별칭 유입**을 막는다. 다만 그것이 "줄어들기만 한다"를
보장하지는 않는다 — 이미 동기인 함수를 새 코드가 부르는 것은 이 게이트가 세는
대상이 아니다. 게이트가 세는 것과 실제 위험은 겹치지만 같지 않다.

baseline 총계가 298 → 305로 올랐다. `withStoreLockAsync`가 동기 락과 같은 FS
프리미티브를 쓰기 때문이다(새 `Sync` 참조 6건 + 주석의 `Atomics.wait` 1건).

숫자만 보면 늘었지만 **전환된 그 대기 구간의 루프 정지는 줄었다.** strict 경로
전체가 안전해졌다는 뜻은 아니다 — 정확히 그만큼만 주장한다.
