# QA 발견 사항

각 항목은 재현 명령과 실제 출력을 함께 적는다. 재현되지 않는 것은 결함으로
올리지 않는다.

공통 전제:

```
export QAHOME=$(mktemp -d /tmp/agbqa-XXXX)
export BROWSER_AGENT_HOME=$QAHOME AGBROWSE_UPDATE_CHECK=0
agbrowse start --headless --port 9333
```

## Q1 — `status --json`이 JSON을 내지 않음 (중)

`--json`은 다른 커맨드에서 기계 판독 계약이고, help도 자동화 시 `--json`을 쓰라고
안내한다. `status`는 그 플래그를 조용히 무시한다.

```
$ agbrowse status --json
running: true
tabs: 1
cdpUrl: http://127.0.0.1:9333

$ agbrowse status --json | node -e "...JSON.parse..."
NOT JSON: Unexpected token 'r', "running: t"... is not valid JSON
```

구현: `skills/browser/browser.mjs`의 `case 'status'`가 `--json` 분기 없이 평문만
출력한다. 바로 위 `doctor`는 같은 자리에서 `--json`을 처리하므로, 이 저장소의
의도된 계약은 분명하다.

영향: 에이전트가 `status --json`을 파싱하면 실패한다. 조용한 실패이므로 더 나쁘다.

## Q2 — `evaluate`가 뒤따르는 플래그를 표현식에 합침 (높음)

가장 심각한 축. 표현식이 오염되어 **엉뚱한 코드가 페이지에서 실행된다.**

```
$ agbrowse evaluate "1+1"
2                                     # 정상

$ agbrowse evaluate "1+1" --port 9333
❌ page.evaluate: SyntaxError: Invalid left-hand side expression in postfix operation

$ agbrowse evaluate "1+1" --json
❌ page.evaluate: SyntaxError: Invalid left-hand side expression in postfix operation

$ agbrowse evaluate --port 9333 "1+1"
❌ page.evaluate: SyntaxError: Unexpected number
```

구현: `case 'evaluate'`가 `process.argv.slice(3)`을 통째로 `join(' ')` 한다.
`--unsafe-allow`만 필터에서 제외되고 `--port`/`--json` 등 나머지 플래그는 그대로
표현식에 붙는다. 즉 `1+1 --port 9333`이 평가된다.

`1+1 --port 9333`이 왜 postfix 에러인지도 일치한다: `9333`은 `--`(감소 연산자)의
피연산자로 파싱되고, 숫자 리터럴은 유효한 좌변이 아니다. 우연한 문법 오류가 아니라
정확히 문자열 결합의 결과다.

SyntaxError로 죽는 편이 차라리 낫다. 문법적으로 유효하면서 의도와 다른 표현식이
되면 **에러 없이 그대로 실행된다.** 추정이 아니라 재현했다:

```
$ agbrowse evaluate "globalThis.json = 41; 1 +" --json
41
```

평가된 실제 표현식은 `globalThis.json = 41; 1 + --json`이다. 문법적으로 멀쩡하고,
`2`가 아니라 `41`을 조용히 돌려준다. 경고도 없다.

이 사례 자체는 작위적이다(플래그 이름과 같은 전역 + 끝에 걸린 연산자가 필요하다).
심각도를 High로 두는 진짜 근거는 다른 데 있다: **일부러 걸러낸 단 하나의 플래그가
`--unsafe-allow`**, 즉 보안 게이트라는 점이다. 임의 JS 실행 커맨드에서 보안 플래그만
특별 취급하고 나머지 플래그는 전부 표현식으로 새게 두었다.

기존 테스트가 못 잡은 이유: `test/integration/cli-dom-commands.test.mjs`는
`['evaluate', '<expr>']`처럼 플래그 없이만 호출한다.

## Q3 — `web-ai claim-audit`이 FAIL인데 종료 코드 0 (높음)

```
$ agbrowse web-ai claim-audit; echo "exit=$?"
result: FAIL — 1 offending hit(s)
  README.md:334  [stealth]  section="Fetch Modules (203.x)"  reason=no stealth/anti-detection support
exit=0

$ agbrowse web-ai claim-audit --json >/dev/null 2>&1; echo "exit=$?"
exit=0
```

구현: `web-ai/cli.mjs`의 `claim-audit` 분기는 `{ ok: report.ok, ... }`를 올바르게
반환하지만, `skills/browser/browser.mjs`의 `case 'web-ai'`가 `runWebAiCli(...)`를
await만 하고 반환값을 버린다. `doctor`가 `if (!r.ok) process.exit(2)` 하는 것과
대조적이다.

대조 확인 — 같은 감사를 릴리스 게이트로 돌리면 종료 코드가 정상이다:

```
$ node scripts/release-gates.mjs no-cloud-claims >/dev/null 2>&1; echo "exit=$?"
exit=1
```

즉 감사 로직이 아니라 CLI 종료 코드 배선만의 문제다.

영향: help가 `claim-audit`을 검증 수단으로 안내하는데
(`"agbrowse web-ai claim-audit" to verify`), CI에서 `set -e`나 `&&` 체인에 걸면
위반이 있어도 통과한다.

## Q4 — `README.md:334`가 죽은 레인을 광고함 (중, Q3이 드러냄)

Q3을 파다 나온 실제 문서 위반이다.

```
README.md:334
| 203.3 Camoufox stealth lane | Firefox-based stealth browser session via Camoufox for anti-bot-heavy targets |
```

같은 저장소가 `--help` 최상단에 "no stealth, no CAPTCHA/Cloudflare bypass"를
내걸고 감사기도 그 정책을 강제한다. 처음엔 "둘 중 하나가 틀렸다"고만 적었는데,
A-gate에서 코드를 읽고 더 정확한 답이 나왔다. **`--help`가 운영상의 진실이고,
README가 한 번도 동작한 적 없는 레인을 광고하고 있다.**

Camoufox는 배선은 되어 있다(`adaptive-fetch/index.mjs:24` import, `:322` 호출).
그런데 두 가지 독립된 이유로 죽어 있다.

1. **필드 이름 불일치.** 생산자는 `html`, 소비자는 `content`를 읽는다.

   ```
   camoufox-session.mjs:50   @typedef {{ ok, html, title, url }} CamoufoxResult
   camoufox-session.mjs:76   print(json.dumps({"ok": True, "title": title, "html": html, "url": url}))
   index.mjs:324             text: camoResult.content || '',      ← 항상 ''
   index.mjs:332             if (camoCandidate.text) readerCandidates.push(...)  ← 항상 버려짐
   ```

   Camoufox가 설치돼 있어도 이 레인은 증거를 만들 수 없다.

2. **의존성 미설치.** `camoufox`는 선언되지 않은 선택적 Python 의존성이라
   `detectCamoufox()`가 false를 반환하고 함수가 no-op으로 끝난다. 유일한 유닛
   테스트는 abort 신호 경로만 검사해서 실제 spawn을 피한다.

즉 이 행은 "존재하지만 한 번도 end-to-end로 동작한 적 없는 코드"를 기능으로
광고한다. WP6의 과제는 "어느 편을 들지"가 아니라 **README 행을 지우는 것**이고,
`content`/`html` 버그는 별도 항목으로 분리한다(Q6).

## Q5 — 인자 누락이 `internal.unhandled` 크래시로 표면화 (중하)

A-gate 중 리뷰어가 찾았다.

```
$ agbrowse web-ai context-dry-run --vendor chatgpt --prompt hi --json; echo $?
{
  "ok": false,
  "error": {
    "errorCode": "internal.unhandled",
    "stage": "internal",
    "message": "Cannot read properties of undefined (reading 'map')",
    "retryHint": "report"
  }
}
1
```

컨텍스트 파일을 안 준 것은 사용자 입력 오류인데, `retryHint: report`가 붙은 내부
크래시로 보고된다. 종료 코드는 1로 맞다. 사용자가 고칠 수 있는 문제를 버그 신고
대상으로 오분류하는 것이 문제다.

A-gate 2차에서 형제 커맨드도 같은 증상임을 확인했다. 단발 실수가 아니라 컨텍스트
계열 공통 경로의 문제다.

```
$ agbrowse web-ai context-render --vendor chatgpt --prompt hi --json
{ "ok": false, "error": { "errorCode": "internal.unhandled", ... } }
```

## Q6 — Camoufox 결과 필드 불일치 (중, Q4에서 분리)

Q4의 근거 1을 독립 결함으로 올린다. 문서를 고치는 것과 코드를 고치는 것은 다른
판단이므로 분리한다. `index.mjs:324`가 `camoResult.content`를 읽지만 생산자는
`html`만 내보낸다. 레인 전체가 무력하다.

## 정상 확인된 표면 (실행 근거 있음)

아래는 실제로 실행해 기대대로 동작한 것들이다.

| 커맨드 | 근거 |
|--------|------|
| `start --headless --port` | 격리 프로파일로 기동, `user-data-dir`이 QAHOME 하위 |
| `status` (평문), `--port` 반영 | 9333 기동 후 `running: true`, 미기동 포트는 `false` |
| `navigate` | `navigated → http://127.0.0.1:.../` |
| `snapshot --interactive` | `e3` textbox … `e10` button, ref 부여 정상 |
| `click` / `type` / `hover` / `press` | 각각 `clicked e4`, `typed into e3`, `hovered e4`, `pressed Tab` |
| `select --json` | `{"ref":"e6","value":"Beta"}` |
| `scroll --json` | `{"direction":"down","pixels":100}` |
| `text` / `get-dom --selector` | 본문 텍스트, `<h1>Smoke Browser</h1>` |
| `screenshot --json` | 파일 경로 + dpr + viewport, 격리 HOME 하위에 기록 |
| `wait-for-selector --json` | `{"selector":"h1","state":"visible"}` |
| `tabs --json` / `new-tab --json` / `active-tab --json` | 3탭 상태와 targetId 일치 |
| `tab-switch --json` | 인덱스로 전환, 제목 반환 |
| `tab-cleanup --dry-run --json` | `wouldClose: []`, 카운터 구조 정상 |
| `console --clear --reload --duration 2000 --limit 10` | `loaded`, `fetched ping`, `fetched late ping` |
| `network --clear --reload --duration 2000 --live-only --filter ping` | 2 requests captured (0 existing, 2 live) |
| `fetch https://example.com --json` | `ok:true`, `verdict: weak_ok` |
| `extract --from-file --schema` | `verdict: extracted`, `{"title":"Hello QA"}` |
| `research plan --json` | `research-plan-v1` 스키마로 제약 분해 |
| `skills list --json` / `skills path` | 번들 스킬 경로 정상 |
| `web-ai render --json` | 프롬프트 봉투 렌더, 브라우저 미기동 |
| `web-ai sessions list --json` | 세션 스토어 조회 |
| `web-ai context-dry-run --json` | 토큰 예산 + transport 판정 |

### A-gate 후 추가 실행분

A-gate 1차에서 "21개 커맨드가 어느 표에도 없다"는 지적을 받고 전부 실행했다.
지적이 맞았다 — 침묵은 검증이 아니다.

| 커맨드 | 근거 |
|--------|------|
| `doctor --port 9333 --json` | `port: 9333`, `persisted.port: 9333`, `ok: true` |
| `reload` | `reloaded → http://127.0.0.1:.../` |
| `resize 1024 768` | `resized to 1024x681 (window-bounds)` — 크롬 크롬바 보정 |
| `wait 100 --json` | `{"waitedMs":100}` |
| `wait-for-text "Smoke" --json` | `{"text":"Smoke","state":"visible"}` |
| `wait-for e4 --json` (deprecated) | ref 이름/occurrence 반환, 경로 살아있음 |
| `move-mouse 10 10` | `mouse moved to (10, 10)` |
| `mouse-click 12 12` | `🖱️ clicked at (12, 12)` |
| `mouse-down` / `mouse-up` | `mouse down (left)` / `mouse up (left)` |
| `drag e4 e5` | `dragged e4 → e5` |
| `select-tab 1 --json` | 전환 성공, `alias: "select-tab"` |
| `tab-close <targetId> --json` | `closed: true`, 이후 `tabs` 3 → 2 |
| `search "example domain" --json` | `agbrowse-search-v1`, 라우트 계획 생성 |
| `install-skills --target <tmp> --json` | `mode: copy`, browser 등 복사 |
| `action-memory list --json` | `{"count":0,"entries":[]}` |
| `observe-actions --json` | 후보 ref 목록 반환 |
| `observe-bundle --json` | `observation-bundle-v1`, targetId/url 일치 |
| `upload e2 <file> --json` | `ok:true` — 임시 fixture 페이지에 file input을 두고 확인 후 원복 |
| `stop` | WP2에서 세션 종료와 함께 확인 |
| `web-ai eval --json` | `ok:true`, `status: pass`, runId/gitCommit 포함. 오프라인 fixture 평가 |
| `web-ai context-render` | 인자 누락 시 Q5와 동일 증상 — 결함으로 기록 |

`upload` 검증용으로 `test/fixtures/site/qa-upload.html`을 잠시 두었다가 지웠다.
작업 트리에 남기지 않았다.

표의 명령은 전부 플래그까지 실제로 실행한 그대로다. 이 표가 처음에는 `console`과
`network` 행에서 `--duration 2000`을 빠뜨린 채 그 플래그가 있어야만 나오는 출력을
인용했고, A-gate에서 걸렸다. 이 유닛이 막으려는 실패가 이 유닛의 증거표에서 났으니
기록해 둔다.

`--duration`은 **밀리초**이고 기본값이 0이라, 없으면 관측 창이 열리지 않는다.
fixture의 late ping은 +300ms에 발생하므로 짧은 창으로는 잡히지 않는다.

```
$ agbrowse console --clear --reload                       # 창 없음
[log] loaded
[log] fetched ping

$ agbrowse console --clear --reload --duration 2000        # late ping까지
[log] loaded
[log] fetched ping
[log] fetched late ping

$ agbrowse network --clear --reload --live-only --filter ping    # 창 없음
0 requests captured (0 existing, 0 live)

$ agbrowse network --clear --reload --duration 2000 --live-only --filter ping
2 requests captured (0 existing, 2 live)
```

결함은 아니다. 다만 `--duration` 없이 부르면 조용히 0건이 나오므로, 진단 커맨드로는
오해하기 쉬운 기본값이다. WP3에서 문서/기본값 관점으로 다시 본다.

### `network`의 `existing`은 무엇이고, 왜 관측자마다 달랐나 (A-gate 2-3차)

이 행은 세 라운드 연속 틀렸다. 수치를 또 손보는 대신 메커니즘을 적는다.

집계는 두 갈래다. `live`는 CDP `Network.requestWillBeSent` 이벤트이고,
`existing`은 `collectPerformanceRequests()`가 페이지의 performance 타임라인에서
긁어오는 값이다. `--live-only`는 `includeExisting: !values['live-only']`로
후자를 통째로 끈다(`browser.mjs:2973`, 소비는 `:2036`). **결정적인 스위치이고,
"붙여도 같다"고 적었던 앞 판은 틀렸다.**

`--clear`가 `existing`을 0으로 만들어 주지도 않는다.
`performance.clearResourceTimings()`는 리로드 **전**에 호출되고(`:2002`),
`existing` 수집은 리로드가 끝난 **뒤**에 일어난다(`:2036`). 그래서 그 리로드가
만든 요청은 정상적으로 타임라인에 남고 `existing`으로 다시 세어진다. 앞 판에
적었던 "직전 로드 이력에 따라 달라진다"는 설명은 이 순서 때문에 성립하지 않는다.

그러면 왜 리뷰어는 `4 (2 existing, 2 live)`, 나는 `2 (0 existing, 2 live)`였나.
내 Chrome에서는 fixture의 ping이 애초에 타임라인에 남지 않는다:

```
$ agbrowse evaluate "JSON.stringify(performance.getEntriesByType('resource').map(e=>e.name))"
"[\"http://127.0.0.1:58391/favicon.ico\"]"
```

`--filter ping`이 favicon을 걸러내니 내 쪽 `existing`이 0이 된다. 필터를 빼면
차이가 즉시 드러난다:

```
$ agbrowse network --clear --reload --duration 2000               # 6 requests (2 existing, 4 live)
$ agbrowse network --clear --reload --duration 2000 --live-only   # 4 requests (0 existing, 4 live)
```

즉 `existing`은 **`fetch()` 응답이 그 시점에 resource 타임라인에 올라와 있는지**에
달려 있다. 왜 관측자마다 달랐는지는 끝까지 특정하지 못했다. 처음엔 브라우저
빌드 차이(설치된 Chrome vs Chrome for Testing)로 적었는데, 리뷰어가 자신도 설치된
Chrome이었고 ping 항목이 정상적으로 잡혔다고 확인해 주면서 그 가설은 무너졌다.
타이밍이나 캐시 상태처럼 환경에 따라 달라지는 무언가로 보이지만, 증거가 없으니
**원인 미상**으로 남긴다.

결론은 그대로다. 원인을 몰라도 `--live-only`가 이 변동 요인 자체를 제거하므로,
증거로 인용할 값은 그쪽을 쓰면 된다.

활성 탭이 결과를 바꾼다는 관찰 자체는 유효하다. `upload` 검증 때문에 활성 탭이
`qa-upload.html`(ping 없음)로 남아 있던 동안 같은 명령이 `0 requests`를 냈다.

결론 두 가지. 재현 가능한 증거로 쓰려면 **`--live-only`를 붙여 `existing`을 아예
빼야 한다.** 그리고 `network` 카운트를 인용할 때는 활성 탭과 브라우저 빌드를 함께
적어야 한다. 이 문서 표의 수치는 활성 탭이 fixture 인덱스이고 `--live-only`가
붙은 상태의 값이라, 두 환경에서 모두 `2 (0 existing, 2 live)`로 일치한다.

### 결함 아님으로 정정한 것

- **`fetch`가 `127.0.0.1`을 거부**: `private or local host is not allowed`. SSRF
  방어로 의도된 동작이라 결함이 아니다. 로컬 fixture로는 `fetch`를 검증할 수 없고
  공개 URL을 써야 한다는 제약으로 기록한다.
- **`new-tab`이 `about:blank`를 염**: 최초 관찰은 셸 변수 미확장 때문이었다. URL을
  정상 전달하면 해당 URL로 열린다.
- **`status`가 `--port`를 무시**: 처음에 의심했으나 `getCliPort()`가 `process.argv`를
  직접 스캔하므로 반영된다. 미기동 포트 9333에 대해 `running: false`로 확인.
