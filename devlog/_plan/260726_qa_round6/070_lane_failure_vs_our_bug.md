# WP6 — 레인 실패와 우리 버그를 가른다

WP5의 A-gate에서 리뷰어가 실측한 잔여 항목이다. 브라우저 레인을 형제 다섯과 같은
규칙으로 옮겨 놓고 보니, 그 규칙 자체가 **프로그래밍 오류까지 삼키고 있었다.**

```
TypeError      -> ok=true content=142 | warnings: ["browser-escalation-failed: Cannot read properties ...
ReferenceError -> ok=true content=142 | warnings: ["browser-escalation-failed: someVar is not defined"]
```

왜 나쁜가. 삼키면 "우리가 터졌다"가 "그 출처에는 아무것도 없었다"로 바뀐다. fetch는
부분 증거를 완전한 결과처럼 보고하고, 호출자는 그것을 근거로 판단한다. 레인 실패를
삼키는 것이 옳은 이유(환경은 우리 잘못이 아니다)가 여기서는 그대로 반대로 작용한다.

## 1. 리뷰어 제안대로 하면 리그레션이 난다

제안은 "`TypeError`/`ReferenceError`/`SyntaxError`는 rethrow, 나머지는 기록"이었다.
그대로 쓰기 전에 이 저장소에서 실제로 어떤 오류가 오는지 쟀다.

```
$ fetch('https://nonexistent-domain-xyz-qa6.invalid')
ENOTFOUND    -> TypeError | cause: ENOTFOUND
$ fetch('http://127.0.0.1:59999/')
ECONNREFUSED -> TypeError | cause: ECONNREFUSED
```

**Node의 `fetch`는 평범한 네트워크 실패를 `TypeError`로 던진다.** 타입만 보는
규칙을 넣었으면 죽은 호스트명 하나에 fetch 전체가 크래시했을 것이다. WP5가 고친
결함과 정확히 같은 모양의 결함을, 고치려다 새로 만들 뻔했다.

## 2. 가르는 것은 타입이 아니라 `cause`다

```
ENOTFOUND       TypeError | cause: ENOTFOUND        (undici가 system error 부착)
ECONNREFUSED    TypeError | cause: ECONNREFUSED
ERR_INVALID_URL TypeError | cause: ERR_INVALID_URL
진짜 버그       TypeError | cause: undefined
```

undici는 밑단 시스템 오류를 `cause`에 붙여 던지고, 우리 코드의 결함은 `cause`가
없다. 그래서 판정은 **타입 ∧ `cause === undefined`**다.

```js
function isProgrammerError(error) {
    if (!(error instanceof TypeError || error instanceof ReferenceError
        || error instanceof RangeError || error instanceof SyntaxError)) return false;
    return error.cause === undefined;
}
```

`RangeError`를 넣은 것은 스택 오버플로가 이 부류이기 때문이고, `SyntaxError`는
`JSON.parse` 실패가 이 부류인데 그건 레인 안에서 이미 잡아 처리한다
(`metadata.mjs:61-65`, `structured-extractor.mjs:141-143`, `ytdlp-reader.mjs:62-64`,
`camoufox-session.mjs:86-88` — 넷 다 자체 catch). 즉 스케줄러까지 올라오는
`SyntaxError`는 파싱 실패가 아니라 우리 코드 문제다.

## 3. 여섯 곳을 한 헬퍼 아래로 모았다

`recordLaneFailure(trace, error, { source, url, fallbackReason })` 하나를 만들고
다섯 레인의 `appendAttempt` 블록을 대체했다. 브라우저 레인은 `browser_required`
분류가 따로 있어 헬퍼를 쓰지 않고 같은 가드만 앞에 넣었다.

| 위치 | 레인 | 적용 |
|------|------|------|
| `:169` | fetch candidate | `recordLaneFailure` |
| `:261` | public endpoint | `recordLaneFailure` |
| `:308` | third-party reader | `recordLaneFailure` |
| `:447` | user session | `recordLaneFailure` |
| `:482` | human loop | `recordLaneFailure` |
| `:769` | browser escalation | `isProgrammerError` 가드 + 기존 분류 유지 |

판정 기준이 한 곳에 있으므로, 브라우저 레인만 엄격해져 WP5가 없앤 비일관이 반대
방향으로 되살아나는 일이 없다.

## 4. 검증

테스트 4종을 추가했다(총 22 → 26건). 오류 타입 목록은 `it.each`로 네 생성자를 모두
고정했다 — 하나만 테스트하면 나머지를 가드에서 빼도 초록색이다.

뮤테이션 6종이 전부 RED다.

| Mutant | 결과 |
|--------|------|
| M1 `isProgrammerError`를 항상 false (수정 전 동작) | 2 failed / 20 passed |
| M2 `cause` 검사 제거 (타입만 보는 규칙) | 1 failed / 21 passed |
| M3 브라우저 레인 가드 제거 | 1 failed / 21 passed |
| M4 `recordLaneFailure`의 rethrow 제거 | 1 failed / 21 passed |
| M5 `RangeError` 제외 | 1 failed / 25 passed |
| M6 `SyntaxError` 제외 | 1 failed / 25 passed |

M2가 잡히는 것이 이번 WP의 핵심이다. 리뷰어 제안을 그대로 구현한 상태가 곧 M2이고,
그것이 RED라는 것은 `cause` 검사가 실제로 뭔가를 지킨다는 뜻이다.

M5/M6은 처음에 GREEN이었다. `it.each`를 넣기 전에는 `TypeError` 한 종류만
테스트하고 있었기 때문이다. 뮤테이션이 테스트의 구멍을 먼저 찾아냈다.

## 5. 뮤테이션 6종이 전부 RED인데도 리그레션 하나가 통과했다

리뷰어가 A-gate에서 찾았다. **원격 서버가 깨진 `Location` 헤더를 주면 fetch 전체가
크래시한다.** WP6이 만든 리그레션이다.

```
$ 301 + location: http://[bad
WP6 적용 후: CRASH  TypeError | cause: UNDEFINED | Invalid URL
HEAD (이전): ok=false verdict=blocked, fetch|error|Invalid URL  ← 기록하고 계속 갔음
```

`fetcher.mjs:50`이 리다이렉트를 따라갈 때 원격이 준 헤더로 `new URL()`을 만든다.
잘못된 값이면 `TypeError`가 나고 **`cause`가 없다**. 그래서 §2의 판정이 "우리 버그"로
읽고 rethrow한다. 그런데 이건 우리 버그가 아니라 상대 서버가 준 쓰레기다. 게다가
`fetcher.mjs`에는 레인 내부 catch가 없어서 그대로 스케줄러까지 올라온다.

트리거가 우리 통제 밖이라는 점이 특히 나쁘다. 오설정된 리다이렉트, 잘린 헤더,
비표준 스킴이면 된다. 임의의 웹을 읽는 도구에서 드문 상황이 아니다.

**고친 자리는 판정이 아니라 레인이다.** 원격 입력으로 URL을 만드는 곳이 그것을
검증해야 한다 — 계층상 그게 맞고, 판정 기준에 문자열 예외를 붙이는 방식(예:
메시지가 `Invalid URL`이면 제외)은 취약하고 §2의 원칙을 흐린다.

```js
const next = resolveRedirectTarget(response.headers.get('location'), current);
if (!next) return blockedResult(..., 'invalid-redirect-location');
```

수정 후:

```
ok=false verdict=blocked
evidence [... "http-301", "invalid-redirect-location"]
```

정상 리다이렉트는 그대로 따라간다. 테스트 2건을 추가했다(26 → 28건) — 깨진
`Location`이 레인 실패로 남는 것과, 상대 경로 `/moved`가 여전히
`https://example.com/moved`로 해석되는 것.

| Mutant | 결과 |
|--------|------|
| M7 가드 제거 (리그레션 복원) | 1 failed / 27 passed |
| M8 `resolveRedirectTarget`이 항상 null | 1 failed / 27 passed |
| M9 공백 검사(`location.trim() === ''`) 제거 | 1 failed / 28 passed |

M8이 중요하다. 가드를 넣으면서 정상 리다이렉트를 깨뜨리는 것이 가장 그럴듯한
실수인데, 그게 잡힌다.

M9는 처음에 GREEN이었다. 리뷰어가 찾았다. 공백 검사가 막는 것은 크래시가 아니라
**자기 리다이렉트 루프**다 — `new URL('   ', base)`는 던지지 않고 `base`를 그대로
돌려주므로, 검사가 없으면 공백 `Location`이 자기 자신으로의 리다이렉트가 되어
redirect budget을 다 태운다. 표준 `Headers`는 공백 값을 `''`로 정규화해 호출부의
진위 검사에 먼저 걸리지만, `headers.get`을 직접 구현한 `fetchImpl`은 그렇지 않다.
그 경로로 테스트를 넣어 고정했다(29건).

같은 교훈이 한 라운드에서 두 번 나왔다. §4의 M5/M6도, 여기 M9도, "고친 것"은
테스트했는데 "그 고침이 부수적으로 막고 있던 것"은 테스트하지 않아서 생긴 구멍이다.

**교훈을 정확히 적는다.** 뮤테이션 6종이 전부 RED였는데도 이 리그레션은 게이트를
그냥 통과했다. 뮤테이션은 "내가 쓴 코드가 지켜지는가"를 묻고, 리그레션은 "이전에
되던 것이 아직 되는가"를 묻는다. 이번에는 뒤쪽이 비어 있었다. 두 질문은 다르다.

### 5.1 같은 부류인데 이미 막혀 있는 곳

`tls-fetch.mjs:118`도 원격 `location`으로 `new URL()`을 만든다. 다만 그 레인 전체가
`try { ... } catch { return null; }` 안에 있어(`:123`) 스케줄러까지 오지 않는다.
지금은 안전하지만 그 catch에 의존하는 안전이라, 누가 catch를 좁히면 같은 문제가 된다.

`execFile`의 `maxBuffer` 초과도 `RangeError` + cause 없음이라 같은 부류다. 역시
`ytdlp-reader.mjs:63`, `tls-fetch.mjs:123`, `camoufox-session.mjs:87`의 자체 catch가
막고 있다. 리뷰어가 짚은 대로, **이 의존을 여기 적어 둔다.**

### 5.2 안전한 것들 (리뷰어 실측)

- `AbortSignal.timeout` / `AbortController.abort()` → `DOMException`. 네 생성자 중
  어디에도 안 걸린다. 타임아웃이 rethrow됐으면 흔한 크래시였을 것이다.
- `execFile`의 ENOENT/비정상 종료/타임아웃 → 평범한 `Error`. 통과.
- playwright CDP 실패 → 평범한 `Error`, 게다가 `browser_required` 분류가 앞에 있다.
- `Headers` 생성 → 원격 데이터로 헤더 이름을 만드는 자리가 없어 도달하지 않는다.

게이트:

```
npm run test:integration → 22 files / 207 tests
npm run test:unit        → 156 files / 1683 tests
npm run typecheck        → 0
npm run docs:counts      → 76
npm run docs:drift       → 164
```

WP5의 CLI 회귀도 다시 확인했다. `fetch <url> --json`은 여전히 `EXIT=0 ok=true`
content 142자, warnings 1건이다.
