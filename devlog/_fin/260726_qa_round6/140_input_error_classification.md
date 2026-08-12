# WP12 — 사용자 오타가 "버그 신고하세요"로 보고되고 있었다

130 §5의 후속 항목(`AbortSignal.timeout` RangeError)을 쫓다가 더 넓은 결함이 나왔다.

## 1. 입력 오류 전체가 `internal.unhandled`였다

```
$ agbrowse fetch "not-a-url" --browser never --json
{"error":{"name":"AdaptiveFetchInputError","errorCode":"internal.unhandled","stage":null}}
```

원인은 한 줄이다. `AdaptiveFetchInputError`(`safety.mjs:68`)는 `this.code`를
설정하는데, CLI 최상위 핸들러(`browser.mjs:3701`)는 `err.errorCode`를 읽는다.
이름이 다르니 항상 기본값으로 떨어졌다.

**직전 라운드 WP2가 고친 것과 같은 오분류다.** 오타를 친 사용자에게 "내부 오류이니
버그를 신고하라"고 말하는 것. 저장소는 이미 옳은 어휘를 갖고 있다 —
`web-ai/question.mjs:88`의 `errorCode: 'input.prompt-missing'` +
`stage: 'input-preflight'`.

### 1.1 그런데 전부 `input.*`은 아니다

처음에 여덟 개 생성 지점을 모두 `input.${code}`로 매핑했다. 리뷰어에게 물어보기 전에
스스로 걸렸어야 할 문제가 있다 — **거부는 오타가 아니다.**

`private-network`, `dns-rebinding`, `credential-url`, `sensitive-query`는 SSRF
가드가 의도적으로 막은 것이다. 여기에 `retryHint: 'fix-arguments'`를 붙이면 "인자를
고쳐서 다시 해보라"는 말이 되고, 그건 우리가 일부러 막은 것을 다시 시도하라는
안내다.

`web-ai/policy`가 같은 선을 이미 긋고 있다 — `policy.*` + `retryHint: 'policy'`.
그래서 `REFUSAL_CODES` 집합을 만들어 갈랐다.

```
http://localhost:8080/x         -> safety.private-network   safety-preflight  (hint 없음)
https://user:pw@example.com/x   -> safety.credential-url    safety-preflight  (hint 없음)
not-a-url                       -> input.invalid-url        input-preflight   fix-arguments
ftp://example.com/x             -> input.unsupported-scheme input-preflight   fix-arguments
```

### 1.2 열거형 오타도 같은 부류였다

리뷰어가 찾았다. `normalizeEnum`이 평범한 `Error`를 던져서 `--browser bogus`도
`internal.unhandled`였다. 같은 라운드에서 안 고치면 일관성이 깨진다.

```
--browser bogus  -> input.invalid-browser   "invalid browser: bogus (expected auto|never|required)"
--identity nope  -> input.invalid-identity
```

기대값 목록을 메시지에 넣었다. 오타를 고치라고 하면서 무엇이 유효한지 안 알려주는
것은 절반만 도와주는 것이다.

처음 구현은 `name.toLowerCase()`로 코드를 만들었는데, 그러면 `browserSession`이
`invalid-browsersession`이 된다. 나머지 코드는 전부 kebab-case
(`input.invalid-url`, `safety.private-network`)라 이것만 관례에서 벗어났다.
리뷰어가 찾았고 — 내 테스트가 `browser`/`identity` 두 개만 커버해서 안 걸렸다 —
kebab 변환을 넣고 케이스를 추가했다.

## 2. 상한 검증 — 두 번 틀렸다

원래 항목은 이것이었다. `--timeout-ms 5000000000`이 크래시한다.

```
RangeError: The value of "delay" is out of range. It must be >= 0 && <= 4294967295.
```

`positiveInteger`가 하한만 봤고, 값이 `fetcher.mjs:47`의 `AbortSignal.timeout`까지
갔다. WP6 이후로는 cause 없는 `RangeError`라 `isProgrammerError`가 rethrow까지 한다.

### 2.1 첫 상한값이 조용한 오작동을 만들었다

오류 메시지의 `4294967295`를 그대로 상한으로 썼다. **틀렸다.** 리뷰어가 실측했다.

```
2147483647  aborted@31ms = false   ← 정상
2147483648  aborted@31ms = true    ← 즉시 abort
4294967295  aborted@31ms = true    ← 즉시 abort
```

`AbortSignal.timeout`은 2^31-1을 넘으면 **거부하지 않고** `TimeoutOverflowWarning`을
낸 뒤 delay를 1ms로 리셋한다. 즉 "아주 긴 타임아웃"을 요청하면 즉시 실패한다.
크래시보다 나쁘다 — 조용하기 때문에 진단이 어렵다.

같은 저장소가 이미 정답을 알고 있었다. `camoufox-session.mjs:32`가
`Math.min(..., 2_147_483_647)`로 클램프한다. **이 라운드에서 여섯 번째로 정답이 같은
저장소 안에 있었다.**

### 2.2 내 테스트가 그 오류를 은폐했다

"천장에서도 성공한다"는 테스트를 썼는데, mock `fetch`가 `init.signal`을 무시해서
통과했다. 실행 중 `TimeoutOverflowWarning`이 출력되고 있었는데 그게 경고였다.

signal을 존중하는 mock으로 고쳤고, 경계값(`2_147_483_648`)을 직접 단정하도록 바꿨다.
"아주 큰 수 5e9를 거부한다"만 보면 틀린 천장에도 통과한다.

### 2.3 `maxBytes`에 타임아웃 상한을 재사용한 것도 혼동이었다

`MAX_POSITIVE_OPTION` 하나로 둘을 묶었는데, 두 값은 다른 기계에 들어간다.
`maxBytes`는 타이머에 안 가고 문자열로 디코딩되는 본문을 제한한다. 실제 한계는
`buffer.constants.MAX_STRING_LENGTH`(이 Node에서 536,870,888)이고 그걸 넘으면
디코드에서 죽는다. 상수 이름 자체가 혼동을 드러내고 있었다.

```js
const MAX_TIMEOUT_MS = 2_147_483_647;                     // AbortSignal이 실제로 지키는 한계
const MAX_MAX_BYTES = bufferConstants.MAX_STRING_LENGTH;  // 디코드 한계
positiveInteger(raw.maxBytes, DEFAULT_MAX_BYTES, MAX_MAX_BYTES, 'maxBytes')
```

메시지에 어느 옵션인지도 넣었다 — `maxBytes out of range: ... (max 536870888)`.

## 3. 검증

테스트 9건을 추가했다(43 → 52건). 뮤테이션 8종 RED.

| Mutant | 결과 |
|--------|------|
| R1 `errorCode`/`stage`/`retryHint` 노출 제거 (**원래 결함**) | 2 failed / 44 |
| R2 상한 검증 제거 (**원래 결함**) | 1 failed / 45 |
| R3 상한을 1로 | 3 failed / 43 |
| R4 `stage` 제거 | 2 failed / 44 |
| R5 거부를 `input.*`으로 되돌림 | 2 failed / 46 |
| R6 거부에도 `retryHint` 부여 | 2 failed / 46 |
| S1 천장을 2^32-1로 (**리뷰어가 찾은 조용한 오작동**) | 1 failed / 51 |
| S2 `maxBytes`가 타임아웃 천장 재사용 | 1 failed / 51 |
| S3 `normalizeEnum`을 plain `Error`로 | 2 failed / 49 |
| S4 천장을 2^30으로 (더 낮게) | 1 failed / 51 |
| U1 kebab 변환 제거 (`invalid-browsersession`) | 1 failed / 52 |

리뷰어가 교차로 5종을 더 돌렸고 전부 RED다 — `MAX_MAX_BYTES`를 더 느슨한 상수로,
메시지에서 `label`/`max` 제거, enum 코드를 하나로 뭉갬, 상한 검사를 `maxBytes`에만
적용, 그리고 **테스트의 천장값만** 2^32-1로 되돌리기(소스 무변경). 마지막 것이
§2.2의 증명이다 — 이전 mock으로는 같은 값이 통과했다.

S1/S4가 양방향으로 잡히는 것이 §2.2의 교훈이다. 경계를 단정해야 값이 고정된다.

CLI 실경로(파이프 없이 종료코드 측정):

```
--browser bogus         exit=1  input.invalid-browser
--timeout-ms 4294967295 exit=1  input.value-out-of-range  "timeoutMs out of range: ... (max 2147483647)"
--max-bytes 5000000000  exit=1  input.value-out-of-range  "maxBytes out of range: ... (max 536870888)"
not-a-url               exit=1  input.invalid-url
http://localhost:8080/x exit=1  safety.private-network
```

## 4. 게이트

```
npm run test:integration → 22 files / 231 tests
npm run test:unit        → 156 files / 1690 tests
npm run test:e2e         → 1 file / 1 test
npm run typecheck        → 0
npm run docs:counts      → 76
npm run docs:drift       → 164
```

## 5. 남는 것

### 5.1 천장값은 Node 버전에 안 흔들린다 — 리뷰어 확인

`engines: >=18`이라 드리프트를 물었고, 리뷰어가 로컬 세 버전으로 확인했다.

| Node | 2^31-1 | 2^31 | 2^32-1 | 2^32 |
|------|--------|------|--------|------|
| v20.20.2 | 정상 | 1ms 리셋 | 1ms 리셋 | RangeError |
| v22.22.3 | 정상 | 1ms 리셋 | 1ms 리셋 | RangeError |
| v24.17.0 | 정상 | 1ms 리셋 | 1ms 리셋 | RangeError |

`TIMEOUT_MAX`는 libuv의 32비트 signed 밀리초 표현에서 오는 구조적 상수라 튜닝
파라미터가 아니다. `MAX_STRING_LENGTH`도 세 버전 모두 536,870,888이다.

런타임 유도는 검토 후 기각했다 — `TIMEOUT_MAX`는 export되지 않고,
`process.on('warning')`은 비동기라 프로브 시점에 안 잡힌다. 상수 하나 대신 전역
리스너를 다는 것은 순손실이다.

### 5.2 `maxBytes`는 바이트를 센다 — 단위를 섞지 않았다

`MAX_STRING_LENGTH`(문자 길이)를 바이트 한계로 쓰는 게 혼동 아니냐고 리뷰어에게
물었고, 실측으로 갈렸다. 한글 1000자(UTF-8 3000바이트)로:

```
maxBytes 2999 → ok=false  body-exceeds-max-bytes
maxBytes 3000 → ok=true
```

`readTextWithLimit`은 `bytes += value.byteLength`로 바이트를 센다. 그리고 천장으로서
방향이 안전하다 — M 바이트는 M자보다 긴 문자열을 만들 수 없고, 멀티바이트면 오히려
더 적은 문자가 된다. 위험한 것은 반대 방향(문자 한계를 바이트에 적용해 초과 허용)인데
그건 아니다.

- 사람이 읽는 경로(`❌ <message>`)에는 `errorCode`/`retryHint`가 안 나온다. 거부와
  오타의 구분이 `--json`에서만 보인다. 이번 범위로는 수용했다.
- `BrowserRequiredError`(`browser-runtime.mjs:10`)도 `code`만 갖는다. 다만 스케줄러가
  내부에서 흡수해 verdict로 바꾸므로 CLI까지 새지 않는다 — 현재는 무해하고, 그
  흡수에 의존하는 안전이다.
