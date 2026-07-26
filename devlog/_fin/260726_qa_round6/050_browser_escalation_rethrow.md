# WP5 — Chrome이 없으면 fetch가 이미 읽은 본문을 버리고 죽는다

WP3의 camoufox 검증을 CLI 실경로로 재현하다 발견했다. 이월 항목이 아니라 이번
라운드에서 새로 찾은 결함이고, **일반 사용자가 가장 흔히 밟는 경로**다.

## 1. 증상

Chrome을 띄우지 않은 상태에서 기본 사용법 그대로 실행하면:

```
$ BROWSER_AGENT_HOME=$(mktemp -d) node bin/agbrowse.mjs fetch https://example.com --json
[browser] CDP connect attempt 1/4 failed, retrying in 1000ms...   (×3)
{"ok":false,"status":"error","error":{
  "errorCode":"internal.unhandled",
  "message":"CDP connection failed after 4 attempts: ... ECONNREFUSED 127.0.0.1:9222"}}
exit=1
```

같은 조건에서 `--browser never`는 정상이다.

```
ok=true verdict=weak_ok source=fetch content=142
```

**본문 142자를 이미 읽어 놓고 죽는다.** 기본 모드가 `auto`이므로 조건이 붙는
결함이 아니라 기본 사용법이다. 그리고 `internal.unhandled`는 "버그를 신고하라"는
신호인데, Chrome이 안 떠 있는 것은 환경 상태다. 이 라운드 WP2가 고친 것과 같은
부류의 오분류다.

## 2. 원인

`tryBrowserEscalation`의 catch(`index.mjs:720`)만 형제들과 다르게 동작했다.

```js
if (error instanceof BrowserRequiredError || error?.code === 'browser_required') {
    appendAttempt(trace, { source:'browser', verdict:'browser_required', ... });
    return null;
}
throw error;          // ← 그 외 전부
```

CDP 연결 실패는 `browser.mjs`가 만드는 평범한 `Error`다. `BrowserRequiredError`도
아니고 `code`도 없으니 분류를 통과하지 못하고 rethrow되어 최상위 핸들러까지 올라간다.

오류 타입만 바꿔 주입하면 갈림이 분명하다.

```
plain Error (CDP-like)  -> 프로세스 사망
BrowserRequiredError    -> ok=true verdict=weak_ok content=142
```

같은 입력, 같은 실패 지점, 오류 타입만 다른데 하나는 죽고 하나는 142자를 살린다.

### 2.1 저장소는 이미 옳게 하는 곳을 다섯 군데 갖고 있었다

`index.mjs`의 catch를 전수 조사했다.

| 위치 | 레인 | 처리 |
|------|------|------|
| `:124` | fetch candidate | `verdict:'error'` 기록, 계속 |
| `:217` | feed/oembed | `verdict:'error'` 기록, 계속 |
| `:265` | third-party reader | `verdict:'error'` 기록, 계속 |
| `:404` | user session | `verdict:'error'` 기록, 계속 |
| `:440` | human loop | `verdict:'error'` 기록, 계속 |
| `:720` | **browser escalation** | **분류 통과 시에만 기록, 그 외 rethrow** |

여섯 중 다섯이 "기록하고 계속"이고 하나만 예외였다. `:404`와 `:440`이 정확한
대조군이다 — 둘 다 브라우저를 쓰는 레인인데도 실패를 삼킨다. 브라우저 에스컬레이션만
다르게 취급할 이유가 코드에 없다.

설계로도 후자가 맞다. `adaptiveFetch`의 계약은 여러 레인을 시도해 가장 좋은 후보를
반환하는 것이고 `:451`의 `if (best) return ...`이 그것을 구현한다. 마지막 레인의
인프라 실패가 앞선 레인의 성공을 무효화하는 것은 그 계약 위반이다.

## 3. 수정

**형제 다섯과 같은 형태로 정렬했다.** 항상 attempt를 기록하고 `null`을 반환하되,
verdict만 분류한다.

```js
const browserRequired = error instanceof BrowserRequiredError
    || error?.code === 'browser_required';
appendAttempt(trace, {
    source: 'browser',
    verdict: browserRequired ? 'browser_required' : 'error',
    url, reason: message,
});
if (!browserRequired) options.runtimeWarnings.push(`browser-escalation-failed: ${message}`);
return null;
```

오류 타입 분류에 의존해 "삼킬지 말지"를 정하지 않으므로, 새 오류 타입이 추가돼도
재발하지 않는다.

**진단 정보는 버리지 않는다.** `attempts`는 `--trace`일 때만 결과에 실리므로
(`:647`), 삼키기만 하면 기본 JSON 출력에 아무 흔적이 없다. `runtimeWarnings`를
`normalizeAdaptiveFetchOptions`에 추가해 `finishResult`의 `warnings`로 병합했다.
이미 옆에 있던 `optionWarnings`와 같은 구조다. `browser_required`는 verdict와
`chromeRequired`로 이미 표현되므로 중복 경고를 넣지 않았다.

## 4. 검증

회귀 테스트 2건을 먼저 쓰고 RED를 확인한 뒤 고쳤다.

```
수정 전: 2 failed | 17 passed   (두 테스트 모두 Error: CDP connection failed로 사망)
수정 후: 19 passed
```

뮤테이션 5종이 모두 RED다. 리뷰어가 독립으로 넓혔다.

| Mutant | 결과 |
|--------|------|
| M1 옛 rethrow 복원 | 2 failed / 17 passed |
| M2 verdict를 항상 `browser_required` | 1 failed / 18 passed |
| M3 `runtimeWarnings` 병합 제거 | 2 failed / 17 passed |
| M4 경고 push 조건 반전 | 2 failed / 17 passed |
| M5 `appendAttempt` 제거 | 1 failed / 18 passed |

M2와 M5가 각각 잡히는 것이 중요하다. verdict 분류와 attempt 기록이 서로 독립적으로
고정되어 있다는 뜻이다.

CLI 실경로 (종료코드는 파이프 없이 측정, **PATH에 camoufox venv 없음**):

```
$ fetch https://example.com --json
EXIT=0   ok=true verdict=weak_ok source=fetch len=142
warnings ["browser-escalation-failed: CDP connection failed after 4 attempts: ...
           💡 Fix: Ensure Chrome is running (agbrowse start) or check port 9222"]

$ fetch https://example.com --browser required --json
EXIT=1   ok=false verdict=browser_required chromeRequired=true
warnings [같은 이유 보존]
```

`required` 계약은 유지된다. 후보가 없으면 여전히 `browser_required`로 끝난다.

### 4.1 환경에 따라 `required`의 종료코드가 달라진다 — 결함이 아니다

리뷰어가 같은 명령에서 `EXIT=0 ok=true`를 봤다. 원인은 WP3에서 설치한 camoufox다.

```
required + camoufox 있음: EXIT=0  ok=true  verdict=weak_ok        chromeRequired=false
required + camoufox 없음: EXIT=1  ok=false verdict=browser_required chromeRequired=true
```

둘 다 맞다. `required`는 브라우저 사용을 요구하는 것이 아니라 후보 확보를 요구하고
(`:666` `shouldReturnWithoutBrowser`가 `required`에서 조기 반환만 막는다),
camoufox 레인이 후보를 만들면 그것으로 성립한다. 위 §4의 측정은 camoufox 없는
환경 값이다.

WP3이 남긴 656MB 캐시가 이렇게 측정에 끼어든다는 점을 040 문서 §6의 판단 재료로
같이 본다.

## 5. 남는 것

프로그래밍 오류도 함께 흡수된다. 리뷰어가 실측했다.

```
TypeError      -> ok=true content=142 | warnings: ["browser-escalation-failed: Cannot read properties ...
ReferenceError -> ok=true content=142 | warnings: ["browser-escalation-failed: someVar is not defined"]
SyntaxError    -> ok=true content=142 | warnings: ["browser-escalation-failed: Unexpected token"]
```

**이건 WP5가 만든 문제가 아니다.** 같은 실험을 형제 레인에 하면 `deps.fetch`가
`TypeError`를 던져도 `:124`가 `fetch | error | ...`로 기록하고 그대로 간다. 즉
"프로그래밍 오류를 구분하지 않는다"는 것은 이 스케줄러 전체의 기존 선택이고, WP5는
브라우저 레인을 나머지와 같은 규칙 아래로 옮긴 것이다. 오히려 가시성은 나아졌다 —
형제 다섯은 `--trace` 없이는 흔적이 없는데 WP5는 `warnings`에 남는다.

고칠 값어치는 있지만 범위가 다르다. 여섯 catch 전부를 대상으로, 판정 기준
(`TypeError`/`ReferenceError`/`SyntaxError`는 rethrow, 나머지는 기록)을 한 곳에 두는
헬퍼가 자연스럽다. 브라우저 레인만 예외적으로 엄격하게 만들면 방금 없앤 비일관이
반대 방향으로 되살아난다. 별도 work-phase로 남긴다.
