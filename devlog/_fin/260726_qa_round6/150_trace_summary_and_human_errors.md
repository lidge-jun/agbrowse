# WP13 — 결과를 잘못 말하는 두 출력

120 §5와 140 §5가 남긴 항목 둘이다. 둘 다 "결함은 없는데 사용자에게 틀린 것을
보여준다"는 부류다.

## 1. 요약이 결과를 내지 않은 레인을 결과라고 말했다

WP10이 `discovered` verdict를 도입했다 — 발견만 하고 가져오지 않은 URL을 표시하는
값이다. 그런데 `summarizeAttempts`(`trace.mjs:35`)가 **마지막** attempt의 verdict를
요약으로 내보내므로, 발견이 마지막이면 이렇게 된다.

```
result.verdict = weak_ok, ok = true
_traceSummary  = "3 attempt(s); last source=metadata verdict=discovered"
```

성공한 fetch인데 요약은 채점되지 않았다고 말한다. 요약문 하나만 보는 사람에게는
거짓이다.

노출 범위를 정확히 적는다 — `_traceSummary`는 CLI 출력에 나오지 않는다. `--json`은
구조분해로 제거하고(`index.mjs:620`), `formatAdaptiveFetchHuman`은 여섯 줄만 낸다.
`runAdaptiveFetch`를 직접 부르는 라이브러리 소비자가 유일한 독자다. 리뷰어가 짚었고,
처음 이 문서에 쓴 "요약문 하나만 보는 사람"은 그 범위에서 과장이었다.

### 1.1 첫 수정은 증상 하나만 없앴다

처음에는 `discovered`를 걸러내고 마지막 **채점된** attempt를 쓰도록 고쳤다. 리뷰어가
같은 거짓말이 다른 값으로 남아 있음을 실측했다.

```
returned: source=fetch verdict=weak_ok (ok=true)
summary : 3 attempt(s); last scored source=browser verdict=browser_required
```

`browser_required`는 채점된 verdict라 필터를 통과한다. Chrome이 없는 흔한 환경에서
바로 나온다.

**원인은 선택 기준 자체였다.** 사다리는 마지막 attempt가 아니라
`chooseBestReaderCandidate`가 고른 후보를 반환한다. "마지막"이든 "마지막 채점된"이든
반환값과 무관한 축이다. `discovered`만 거른 것은 증상 하나를 지운 것이지 원인을
없앤 게 아니었다.

**고친 방향**: 요약은 **반환된 것**을 말한다. `finishResult`가 `result.source`와
`result.verdict`를 이미 쥐고 있으므로 그것을 넘긴다.

```
"3 attempt(s); selected source=fetch verdict=weak_ok"
```

호출자가 결과를 모르는 경우(직접 `summarizeAttempts`를 부르는 쪽)에는 지어내지 않고
마지막 attempt를 그대로 보고한다. `UNSCORED_VERDICT` 필터는 필요 없어져 지웠다 —
올바른 기준을 쓰면 `discovered`는 자연히 선택되지 않는다.

두 케이스 모두 실측으로 확인했다.

```
browser_required 케이스 | returned fetch/weak_ok | selected source=fetch verdict=weak_ok
discovered 케이스       | returned fetch/weak_ok | selected source=fetch verdict=weak_ok
```

### 1.1 기존 테스트 하나가 문구를 고정하고 있었다

`browser-adaptive-fetch-trace.test.mjs`가 `last source=validation`을 단정했다.
수정으로 문구에 `scored`가 끼면서 깨졌다.

**던져야 할 질문은 "이게 의도된 동작을 검증하는가, 현재 문구를 검증하는가"다.**
직전 라운드 070 §5.1이 같은 함정을 기록했다. 이 테스트의 의도는 "결과를 낸 레인을
이름으로 밝힌다"이지 특정 문장이 아니므로, `source=`와 `verdict=`를 각각 단정하도록
바꿨다.

## 2. 사람이 읽는 오류에는 코드가 없었다

WP12가 `input.*`과 `safety.*`를 갈랐는데, 그 구분이 `--json`에서만 보였다. 손으로
명령을 치는 사람에게는 둘이 같은 모양이었다.

```
❌ private or local host is not allowed: localhost
❌ invalid URL: not-a-url
```

앞은 우리가 의도적으로 막은 것이고 뒤는 오타인데, 화면상 구분이 없다.

```
❌ private or local host is not allowed: localhost
   safety.private-network
❌ invalid URL: not-a-url
   input.invalid-url · fix-arguments
```

메시지가 여전히 앞서고 코드가 주석처럼 붙는다. `internal.unhandled`는 붙이지
않는다 — 분류되지 않은 실패에 코드를 보여주는 것은 정보가 아니라 소음이다.

## 3. 검증

테스트 7건을 추가했다(유닛 3, 통합 4). 전부 수정 전 RED다.

뮤테이션 결과.

| Mutant | 결과 |
|--------|------|
| X1 `outcome` 무시 (**마지막 attempt로 회귀**) | 2 failed / 5 |
| X2 `index.mjs`가 `outcome`을 안 넘김 (배선 끊기) | 1 failed / 53 |
| X3 fallback 경로 제거 | 2 failed / 5 |
| W1 errorCode 줄 제거 (**원래 결함**) | 2 failed / 24 |
| W2 `internal.unhandled` 제외 조건 제거 | 26 passed — §3.1 |
| W3 `retryHint` 생략 | 1 failed / 25 |

X2는 처음에 살아남았다. 유닛 테스트가 함수를 직접 부르니 **배선**은 안 보였다.
통합 레벨 테스트를 넣어 닫았다 — 유닛과 통합이 서로 다른 것을 본다는 사례다.

**일반화할 값어치가 있는 규칙**: 유닛 테스트는 함수의 계약을 지키지만 **호출자가 그
계약을 쓰는지는 못 지킨다.** 함수에 새 인자를 더할 때는 배선 테스트를 같이 넣는다.
이 라운드의 (c)와 X2가 같은 뿌리다.

### 3.1 W2는 잡을 수 없다 — 그리고 그게 맞다

W2가 통과한다. 처음에는 테스트 공백으로 보고 분류되지 않은 실패
(`skills get nonexistent`)를 단정하는 테스트를 넣었는데 **여전히 통과했다.**

조사해 보니 공백이 아니라 조건이 도달 불가였다. 분류되지 않은 오류는 `errorCode`가
**없다** — `internal.unhandled`는 JSON 봉투가 채우는 기본값이지 오류 객체에 붙는
값이 아니다. 그래서 `code &&`에서 이미 걸러지고, `!== 'internal.unhandled'`는
실행되지 않는다.

스스로 그 값을 설정하는 오류는 실재한다(`cli-sessions.mjs:31`,
`cli.mjs:1925` 등 `WebAiError`). 그런데 `web-ai`는 자기 오류를 자기가 출력하므로
(`[web-ai error] internal.unhandled: ...`) 이 핸들러까지 오지 않는다.

**즉 W2는 현재 도달 불가한 방어다.** 테스트로 잡을 수 없는 것을 억지로 잡으려
하는 대신, 왜 남겨 두는지를 코드 주석에 적었다. 지우면 나중에 그 값을 스스로
설정하는 오류가 이 경로로 오게 될 때 소음이 새어 나온다.

리뷰어가 기계적 차단기를 정확히 짚었다 — `web-ai`가 자기 오류를 출력한다는 것보다,
`cli.mjs:502`가 출력 후 `alreadyReported = true`를 세우는 것이 실제 차단 지점이다.
즉 이 가드는 그 플래그가 떨어졌을 때를 막는 2차 방어다. 주석을 그 사실로 고쳤다.

**"뮤턴트가 살아남으면 테스트 공백"이라는 가정이 여기서 틀렸다.** 살아남은 이유가
도달 불가일 수도 있고, 그 구분은 코드를 읽어야만 난다.

이 라운드에서 뮤턴트 생존을 만난 게 다섯 번째인데(M5/M6, M9, WP12의 천장, N3,
그리고 W2), 처음으로 **테스트를 추가하는 게 답이 아닌** 경우였다.

CLI 실경로(파이프 없이 종료코드 측정):

```
fetch not-a-url                 exit=1  ❌ invalid URL / input.invalid-url · fix-arguments
fetch http://localhost:8080/x   exit=1  ❌ private or local host / safety.private-network
fetch --browser bogus           exit=1  ❌ invalid browser (expected auto|never|required) / input.invalid-browser · fix-arguments
snapshot (브라우저 없음)         exit=1  코드 줄 없음
```

## 4. 게이트

```
npm run test:integration → 22 files / 235 tests
npm run test:unit        → 156 files / 1693 tests
npm run typecheck        → 0
npm run docs:counts      → 76
npm run docs:drift       → 164
```
