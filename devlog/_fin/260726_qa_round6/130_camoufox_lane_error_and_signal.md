# WP11 — camoufox 레인만 남아 있던 예외 두 개

120 §5의 후속 1번이다. WP6이 스케줄러의 여섯 catch를 한 규칙 아래로 모았는데,
camoufox 레인은 그 규칙 밖에 있었다. 그리고 abort 경로가 프로덕션에서 도달 불가였다.

## 1. 우리 버그를 삼키고 있었다

```js
const camoResult = await camoufoxImpl(...).catch(() => null);
```

`catch(() => null)`은 오류 종류를 가리지 않는다. WP6이 다른 여섯 곳에서 없앤 바로 그
형태다. 실측하면 이렇다.

```
TypeError('undefined is not a function')  →  삼켜짐, ok:true, 아무 흔적 없음
```

실패 이유도 사라졌다. `attempts`는 `--trace`일 때만 결과에 실리는데 이 경로는
`appendAttempt`조차 하지 않았으므로, camoufox 스폰이 왜 실패했는지 알 방법이 없었다.

**형제들과 같은 형태로 정렬했다.** `recordLaneFailure`가 프로그래밍 오류를 rethrow하고
나머지는 attempt로 기록하며, WP5가 만든 `runtimeWarnings`로 이유를 결과에 남긴다.

```js
try {
    camoResult = await camoufoxImpl(parsed.href, { timeoutMs, signal });
} catch (error) {
    recordLaneFailure(trace, error, { source: 'fetch', url: parsed.href, fallbackReason: 'camoufox-error' });
    options.runtimeWarnings.push(`camoufox-render-failed: ${error?.message}`);
}
```

## 2. abort 경로를 아무도 탈 수 없었다

`camoufox-session.mjs`는 두 곳에서 `signal`을 쓴다.

```js
:60  if (options?.signal?.aborted) return null;          // 스폰 전 중단
:83  ...(options?.signal ? { signal: options.signal } : {})  // execFile에 전달
```

그런데 호출부(`index.mjs`)는 `timeoutMs`만 넘기고 `signal`을 주지 않았다. 즉 **유닛
테스트가 검증하는 경로를 실제 호출자가 못 탄다.** `browser-adaptive-fetch-camoufox.test.mjs`의
유일한 테스트가 바로 그 aborted-signal 경로다 — 프로덕션에서 도달 불가인 코드를
테스트하고 있었던 셈이다.

실질 영향은 호출자의 데드라인이 이미 만료된 상태에서도 이 레인이 브라우저 스폰을
시작한다는 것이다. signal을 배선했다.

**이건 이 라운드에서 두 번째 유형이다.** WP9의 Phase 1d는 조건이 죽어 코드 전체가
도달 불가였고, 여기서는 파라미터가 안 넘어와 기능 일부가 도달 불가였다. 둘 다
"테스트는 초록인데 제품에서 안 돌아간다"의 변종이다.

### 2.1 첫 배선 값이 틀렸다 — 리뷰어가 실측으로 잡았다

처음에 `AbortSignal.timeout(options.timeoutMs)`를 넣었다. **회귀였다.**

`timeoutMs`는 전체 데드라인이 아니라 **per-attempt**다. CLI 도움말이 그렇게 적고
있다(`index.mjs:631` `--timeout-ms N  Per-attempt timeout`). 그리고 이 값을 쓰는
층이 셋인데 예산이 서로 다르다.

| 층 | 예산 | 이유 |
|----|------|------|
| Python `page.goto` | `timeoutMs` | 페이지 로드 |
| `execFile`(`camoufox-session.mjs:81`) | `timeoutMs + 30s` | **브라우저 런치 헤드룸** |
| 내가 넣은 signal | `timeoutMs` | 런치 몫이 없음 |

`execFile`의 `+30`은 camoufox 런치 비용을 위한 의도적 여유인데, 내 signal이 그걸
무효화했다. 실물로 A/B했다(`timeoutMs=1500`).

```
signal 있음(내 첫 판): ok false | 1510ms | camoufox attempts 0 | warnings []
signal 제거:           ok true  | 1956ms | camoufox attempts 1
```

**결과가 뒤집힌다.** 레인이 렌더를 내놓기 직전에 죽고, 게다가 조용히 죽는다 —
abort가 `execFileAsync`를 깨우면 `camoufox-session.mjs:87`의 `catch { return null; }`이
AbortError까지 삼켜 attempt도 warning도 안 남는다. **WP11이 없애려던 실패 유형이
모듈 안쪽에 그대로 있었고, 내 배선이 그 경로를 처음으로 도달 가능하게 만들었다.**

기본값 15000에서는 안 보인다. 그래서 §3의 첫 스모크(2807ms)가 통과했다. `--timeout-ms`를
낮춘 사용자만 맞는 결함이었다.

처음 고칠 때는 호출부에 상수를 두고 `options.timeoutMs + 30_000`으로 맞췄는데,
리뷰어가 **그것도 어긋난다**고 지적했다. `camoufox-session`은
`Math.ceil(timeoutMs/1000)`으로 초 단위 반올림을 하므로 두 식은 `timeoutMs`가
1000의 배수일 때만 같다.

| timeoutMs | execFile | 내 signal | 차이 |
|-----------|----------|-----------|------|
| 15000 | 45000 | 45000 | 0 |
| 1500 | 32000 | 31500 | **−500** |
| 1001 | 32000 | 31001 | **−999** |
| 50 | 31000 | 30050 | **−950** |

기본값 15000이 배수라 안 보였다. 그리고 리뷰어가 **새 오버플로 창**도 찾았다 —
`timeoutMs`가 `2^32-1-30000` 근처면 헤드룸을 더하다 `AbortSignal.timeout` 상한을
넘어 cause 없는 `RangeError`로 죽는다. HEAD 원본은 같은 값에서 `ok:false`로
살아남는다. 창을 30초 넓힌 것이 내 커밋이다.

**예산 계산을 순수 함수 하나로 뺐다.** 두 곳이 각자 하드코딩하는 한 다시 어긋난다.

```js
// camoufox-session.mjs
export const CAMOUFOX_LAUNCH_HEADROOM_MS = 30_000;
export function camoufoxBudgetMs(timeoutMs) {
    const seconds = Math.ceil((timeoutMs || 30_000) / 1000);
    return Math.min(seconds * 1000 + CAMOUFOX_LAUNCH_HEADROOM_MS, 2_147_483_647);
}
```

`execFile`의 `timeout`과 호출부의 `AbortSignal.timeout`이 둘 다 이 함수를 쓴다.
반올림이 함수 안에 있으므로 정의상 같은 값이고, 클램프가 오버플로를 막는다.

```
15000 -> 45000    1500 -> 32000    1001 -> 32000
   50 -> 31000     미지정 -> 60000    4294940000 -> 2147483647
```

그리고 `camoufox-session.mjs`의 catch가 AbortError는 rethrow하도록 했다. 호출자의
데드라인이 터진 것은 "이 출처에 아무것도 없었다"가 아니다 — 스케줄러가 기록해야 한다.

수정 후 실물:

```
timeoutMs=1500  ok true | 1977ms | camoufox attempts 1
timeoutMs=15000 ok true | 1959ms | camoufox attempts 1
```

"전체 데드라인"이라는 표현이 신규 주석 2곳과 `camoufox-session.mjs` 기존 주석 2곳에
있었다. 넷 다 "호출자의 데드라인"으로 정정했다.

### 2.2 에러 attempt가 직접 fetch와 구별되지 않았다

이 레인은 성공 경로부터 `source: 'fetch'`를 쓴다(camoufox 전용 source가 없다).
성공 쪽은 `reason: 'camoufox-render'`로 자기를 밝히는데 에러 쪽은 원본 메시지뿐이라,
직접 fetch 실패와 구분할 수 없었다. `recordLaneFailure`에 선택적 `lane` 인자를 더해
`camoufox-render: <메시지>`로 남긴다.

## 3. 검증

테스트 3건을 추가했다(39 → 42건). 셋 다 수정 전 RED다.

```
3 failed | 39 passed
  → promise resolved instead of rejecting        (TypeError가 삼켜짐)
  → expected false to be true                    (실패 이유가 warnings에 없음)
  → expected undefined to be an instance of AbortSignal
```

뮤테이션 4종 RED.

| Mutant | 결과 |
|--------|------|
| M-W 옛 `.catch(() => null)` 복원 | 3 failed / 39 passed |
| M-X `signal` 전달 제거 | 1 failed / 41 passed |
| M-Y `runtimeWarnings` push 제거 | 1 failed / 41 passed |
| M-Z `recordLaneFailure` 제거(조용히 삼킴) | 2 failed / 40 passed |

M-W가 3건을 깨우는 것은 옛 형태가 세 성질을 한꺼번에 없애기 때문이고, M-X/M-Y가
각각 하나씩만 깨우므로 테스트가 서로 다른 것을 본다.

### 3.1 그 테스트들이 signal의 값을 보지 않았다

리뷰어가 뮤턴트 6종이 살아남는다고 보고했다. 원인은 `expect(received).toBeInstanceOf(AbortSignal)`이
signal의 **존재**만 본다는 것이다. 그래서 §2.1의 회귀도, 정반대 극단(즉시 abort로
레인 영구 무력화)도 못 잡았다.

테스트를 보강했다(42 → 43건).

- 진입 시 `signal.aborted === false` — 이미 터진 signal을 배제한다.
- 새 테스트 `budgets the camoufox signal above the per-attempt timeout` —
  `timeoutMs=50`으로 호출해 레인이 그 4배를 기다린 뒤 `signal.aborted`를 본다.
  `timeoutMs` 예산이면 이미 터져 있고, 헤드룸이 있으면 아직 아니다.
- 에러 attempt에 `source`와 `reason` 전체를 단정하고, warning 문자열도 접두어까지 본다.

리뷰어의 생존 뮤턴트를 다시 돌렸다.

| Mutant | 이전 | 지금 |
|--------|------|------|
| N1 `AbortSignal.timeout(options.timeoutMs)` (헤드룸 제거 = 실제 회귀) | 42 passed | **1 failed / 42** |
| N2 `AbortSignal.abort()` (즉시 abort) | 42 passed | **2 failed / 41** |
| N3 `new AbortController().signal` (영원히 안 터짐) | 42 passed | 43 passed |

N3은 여전히 살아남는다. **정직하게 적는다** — 이 테스트로는 "터지지 않는 signal"과
"넉넉한 예산"을 구분할 수 없다. 구분하려면 실제로 예산이 만료될 때까지 기다려야 하고
(30초+), 그건 통합 스위트에 넣을 비용이 아니다. 가짜 타이머가 대안인데
`AbortSignal.timeout`은 Node 내부 타이머라 vitest의 fake timer가 잡지 못한다.
리뷰어도 `vi.useFakeTimers()` + `advanceTimersByTime(60_000)` 후에도
`aborted === false`임을 확인했고, `process.getActiveResourcesInfo()`로 세는 대안도
판별 불가였다.

**다만 §3.2의 유닛 테스트가 이 갭의 실질을 메운다.** 예산을 순수 함수로 뺐으므로
값 자체를 직접 단정할 수 있고, N3가 노리는 "예산이 없는 signal"은 그 함수를 통과할
수 없다. 남는 위험은 호출부가 함수를 안 쓰고 다른 signal을 넣는 경우뿐이고, 그때는
실사용 피해도 제한적이다 — `execFile`의 타임아웃이 여전히 프로세스를 죽이므로 abort
경로만 다시 죽고 렌더는 동작한다.

**잔존 범위를 정확히 적는다.** 미고정인 것은 "`AbortSignal.timeout(camoufoxBudgetMs(...))`
전체를 다른 signal 소스로 갈아치우는" 회귀뿐이다. 그건 예산 함수를 우회하는 명백한
재작성이고, 통합 테스트가 하한을(§3.1) 유닛 4건이 예산 값을(§3.2) 각각 고정하므로
"signal이 공유 예산에서 파생된다"는 성질 자체는 지켜진다. 그렇게 회귀해도 `execFile`이
같은 예산으로 프로세스를 죽이므로 피해는 abort 경로에 국한된다.

### 3.2 유닛 테스트로 예산과 abort를 직접 고정했다

`browser-adaptive-fetch-camoufox.test.mjs`는 테스트가 1건(15줄)뿐이었고 그마저
프로덕션에서 도달 불가인 경로를 보고 있었다(§2). 7건을 더했다(1 → 8건).

주입점을 만들었다 — `detect`와 `execFileImpl`. 스케줄러의 `deps.fetch`와 같은
형태이고, 이게 없으면 스폰 실패 경로를 camoufox 설치된 기계에서만 시험할 수 있다.

뮤테이션 3종 RED.

| Mutant | 결과 |
|--------|------|
| N5 AbortError rethrow 가드 제거 | 1 failed / 7 passed |
| N6 예산에서 헤드룸 제거 | 3 failed / 5 passed |
| N7 클램프 제거 | 1 failed / 7 passed |

N5는 리뷰어가 "새로 추가한 동작인데 회귀 방어가 없다"고 지적한 것이다. 주입 없이는
`detectCamoufox`가 먼저 false로 빠져 도달할 수 없었다.

실물 camoufox로도 회귀가 없다. WP3부터 쓰던 venv를 PATH에 올려 확인했다.

```
timeoutMs=15000  ok true | camoufox attempts 1 | 2106ms | warnings []
timeoutMs=1500   ok true | camoufox attempts 1 | 2421ms | warnings []
```

정상 경로에서는 경고가 붙지 않는다. **낮은 `timeoutMs`를 스모크에 넣은 것이 §2.1의
교훈이다** — 기본값만 재던 첫 검증이 그 회귀를 통과시켰다.

## 4. 게이트

```
npm run test:integration → 22 files / 221 tests
npm run test:unit        → 156 files / 1690 tests
npm run typecheck        → 0
npm run docs:counts      → 76
npm run docs:drift       → 164
```

## 5. 남는 것

- N3 뮤턴트(터지지 않는 signal)가 통합 테스트로는 고정되지 않는다. 유닛 쪽 예산
  단정이 실질을 메운다(§3.1, §3.2).
- `AbortSignal.timeout`의 `RangeError`(`--timeout-ms 5000000000`)는 이 라운드
  이전부터의 결함이다. `fetcher.mjs:47`이 이미 같은 호출을 하고 있어 HEAD 원본도
  똑같이 죽는다(리뷰어가 stash로 확인). camoufox 쪽은 `camoufoxBudgetMs`의 클램프로
  막았지만 `fetcher.mjs`는 그대로다. 별개 항목이다.
