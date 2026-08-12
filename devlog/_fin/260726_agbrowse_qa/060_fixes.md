# WP6 — 결함 수정

WP1~WP5가 찾은 결함 중 아직 안 고친 것들을 처리한다. 설계 원칙은 000_plan §5.2
그대로다: **새로 설계하지 않고 이미 옳게 동작하는 선례를 형제 경로로 확장한다.**

## 1. 실패 계약 묶음 — Q7 · Q11 · Q12 · Q14

넷 다 "실패를 호출자에게 어떻게 전달하는가"의 문제였고, 두 곳만 고쳐서 전부
해결됐다.

### 1.1 `--json` 실패 봉투 (Q7 · Q12 · Q14)

세 결함이 `browser.mjs`의 최상위 catch 한 곳으로 수렴했다. 이전에는 무조건
`❌ <message>` 평문이었다.

```js
} catch (e) {
    if (!e?.alreadyReported) console.error(`❌ ${e.message}`);
    process.exit(1);
}
```

`wantsJsonErrors(argv, env)`를 추가해 `--json` 또는
`AGBROWSE_JSON_ERRORS=1`이면 봉투를 낸다. 봉투 모양은 `extract`가 이미 쓰는
것과 같다.

검증:

```
$ agbrowse click e99 --json          → {"ok":false,...,"message":"ref e99 not found — re-run snapshot"}  exit=1
$ agbrowse research normalize-results --file /tmp/nope.json --json  → JSON 봉투  exit=1
$ agbrowse skills install --target <이미있음> --json                 → JSON 봉투  exit=1
$ agbrowse click e3 --json           → clicked e3                    exit=0  (성공 경로 유지)
```

#### 던지지 않고 반환하는 경로 (A-gate에서 발견)

처음 수정은 최상위 catch만 건드렸는데, `research`의 **인자 검증**은 예외를 던지지
않고 `{stderr, exitCode}`를 반환한다. `browser.mjs:2374`에서 출력하고 바로
종료하므로 catch에 닿지 않는다. 그래서 `research plan --json`은 여전히 평문
usage를 냈다. 리뷰어가 "Q12 전체가 닫힌 것처럼 읽힌다"고 지적해서 마저 고쳤다.

```
$ agbrowse research plan --json    → {"ok":false,...,"errorCode":"input.invalid-arguments"}  exit=1
$ agbrowse research plan           → Usage: ...                                              exit=1
$ agbrowse research plan --query "테스트" --json                                             exit=0
```

### 1.2 `ok:false`를 종료 코드로 (Q11)

`fetch`와 `search`가 결과를 반환하지 않아 디스패치가 종료 코드를 낼 수 없었다.
두 CLI가 결과를 반환하게 하고, 디스패치에서 `extract.mjs:540`과 같은 판정을 건다.

`search` 파이프라인은 `ok` 대신 `evidenceStatus`로 실패를 알리므로 그 축을 읽는다.

```
fetch 실패            exit=1   (이전 0)
fetch 성공            exit=0
search --verify 실패  exit=1   (이전 0)
search --verify 성공  exit=0
search 파이프라인 빈 결과  exit=1   (이전 0)
search 파이프라인 정상     exit=0
```

**호환성**: 이 수정은 셸 의미를 바꾼다. `fetch`가 0을 낸다는 전제로 동작하던
호출자는 이제 실패로 읽는다. 그래도 고치는 쪽이 맞다 — `ok:false`에 exit 0은
계약 위반이고, 같은 저장소의 `extract`가 반대로 동작하므로 "이 CLI의 관행"이라고
방어할 근거가 없다.

## 2. 입력 오류 코드 — Q13 (Q5 흡수)

`cli.mjs:904-912`의 `code-mode.prompt-missing` 선례를 네 경로로 넓혔다.

| 위치 | 이전 | 이후 |
|------|------|------|
| `question.mjs:81` | `context.over-budget` + `reduce-files` | `input.prompt-missing` + `add-prompt` |
| `cli.mjs` `runContextCommand` | `internal.unhandled` + `report` (크래시) | `input.context-source-missing` + `add-context-source` |
| `cli-sessions.mjs` ×3 | `internal.unhandled` + `report` | `input.session-not-found` + `list-sessions` |

`question.mjs` 쪽이 특히 중요하다. 이전에는 프롬프트 누락과 **진짜 예산 초과**가
같은 코드를 써서 구분되지 않았고, 프롬프트를 안 쓴 사용자에게 파일을 줄이라고
안내했다.

`runContextCommand` 가드에서 한 번 헛짚었다. 처음엔 `input.contextTransform`이
있으면 컨텍스트 소스가 있다고 봤는데, 이 값은 기본이 `'raw'`라 항상 참이었다.
명시적 `'repomix'`만 인정하도록 좁혔다.

**그리고 그 가드가 회귀를 만들었다.** A-gate에서 리뷰어가 잡았다:

```
$ agbrowse web-ai context-dry-run --prompt hi --context-file <목록> --json
{"errorCode":"input.context-source-missing"}   exit=1     ← 수정 전에는 정상 동작
```

내가 쓴 `hasContextSource`가 `--context-file`을 빠뜨렸다. 게다가 에러 메시지는
사용자가 **올바르게 쓴 플래그를 빼고** 다른 것을 쓰라고 안내했다.

더 나쁜 건 이게 §5.2 위반이라는 점이다. 같은 파일 `:671-675`에 정본
`hasContextPackage`가 이미 있었는데, 나는 그걸 재사용하지 않고 손으로 다시
썼다. **결함을 찾아내는 문서를 쓰면서 같은 종류의 결함을 만들었다.**

정본을 재사용하는 자리로 가드를 옮겨 고쳤다. 한 술어에서 두 번(기본값 `'raw'`,
`--context-file` 누락) 틀렸다는 것은 손으로 쓰지 말라는 신호였다.

### 2.1 Q13은 세 경로에서만 닫혔다 — `--file`은 열려 있다

A-gate 2차에서 리뷰어가 짚었다. 가드를 통과한 뒤 원래의 Q13 크래시가 그대로 난다.

```
$ agbrowse web-ai context-dry-run --prompt hi --file web-ai/errors.mjs --json
internal.unhandled | Cannot read properties of undefined (reading 'map')   exit=1
```

리뷰어가 `cli.mjs`를 stash해 확인한 결과 WP6 이전부터 있던 문제이고 내가 만든
회귀는 아니다. 그래도 그냥 넘길 수 없는 이유가 있다. **가드가 내는 메시지가
`--file`을 유효한 컨텍스트 소스로 안내하는데, 그 경로가 Q13이 없애려던 바로 그
크래시를 낸다.**

그래서 Q13은 이렇게 갈라 적는다.

| 경로 | 상태 |
|------|------|
| `render` 프롬프트 누락 | 닫힘 (`input.prompt-missing`) |
| `context-dry-run`/`context-render` 소스 없음 | 닫힘 (`input.context-source-missing`) |
| `sessions show` 잘못된 id | 닫힘 (`input.session-not-found`) |
| `context-dry-run --file <path>` | **열림** — WP7로 이월 |

"세 경로에서 고쳤다"와 "Q13을 닫았다"는 다른 문장이다. 안 고친 것을 고쳤다고
적지 않는 것이 이 유닛의 출발점이다.

검증:

```
web-ai render --vendor chatgpt --json          → input.prompt-missing | add-prompt      exit=1
web-ai context-dry-run --vendor chatgpt --json → input.context-source-missing           exit=1
web-ai sessions show bogus-qa --json           → input.session-not-found | list-sessions exit=1
web-ai context-dry-run --prompt hi --context-from-files "web-ai/errors.mjs" --json → ok:true exit=0
```

## 3. Camoufox — Q4 · Q6

- **Q6**: `index.mjs:324`가 `camoResult.content`를 읽었지만 생산자
  (`camoufox-session.mjs:50`, `:76`)는 `html`을 낸다. `text`가 항상 `''`이 되어
  `:332`에서 후보가 버려졌다. `camoResult.html`로 고쳤다.
- **Q4**: `README.md:334`의 Camoufox stealth 행을 삭제했다. 이제 클레임 감사가
  통과한다.

```
$ agbrowse web-ai claim-audit
result: PASS — no forbidden cloud/stealth/external-CDP claims   exit=0
$ node scripts/release-gates.mjs no-cloud-claims                 exit=0
```

Q6은 필드명만 맞췄을 뿐, 이 레인이 실제로 동작하는지는 여전히 미검증이다.
`camoufox`는 선언되지 않은 선택적 Python 의존성이고 설치돼 있지 않다. 필드 불일치가
있는 한 설치해도 동작할 수 없었으므로 고칠 가치가 있지만, **동작 확인은 못 했다.**

## 4. `tab-cleanup` 스키마 — Q9

실행 경로에 `ok`, `dryRun`, `counts`를 더해 dry-run과 공통 구조를 갖게 했다.

```
dry  keys: counts dryRun idleTimeoutMs maxTabs ok tabsTotal wouldClose
real keys: closed counts dryRun idleClosed leaseClosed leaseClosedTabs
           limitClosed ok providerClosed untrackedClosed
```

이전에는 공통 키가 하나도 없었다. 이제 `ok`/`dryRun`/`counts`를 공유하므로 미리보기
후 실행하는 흐름을 같은 파서로 읽을 수 있다. 실행 쪽의 기존 평면 키는 그대로 둬서
기존 호출자를 깨지 않는다.

## 5. 트랜스포트 테스트 — Q10 (부분 수정)

진단을 정정한다. 처음에는 "실패가 통과로 보인다"고 적었는데, **종료 코드는
정상이다.**

```
$ npx vitest run test/integration >/dev/null 2>&1 ; echo $?
1
```

즉 CI는 이 실패를 잡는다. 실제 문제는 **사람이 읽는 요약**이다.

```
 Test Files  4 failed | 18 passed (22)
      Tests  168 passed | 15 skipped (183)     ← 실패한 테스트 0건
```

`beforeAll`이 던지면 그 파일의 테스트는 실행되지 않고 skipped로 집계된다. vitest의
구조라 바꿀 수 없다. 그래서 고친 것은 **실패 메시지**다. 네 파일이
`launchTransportChromium()`을 쓰게 해서, 기동 실패 시 원인과 해결책을 함께 낸다:

```
transport test could not launch Chromium. playwright-core resolves a build that is
not in the local cache; point AGBROWSE_CHROMIUM_EXECUTABLE_PATH at an installed
Chrome or Chrome for Testing binary and re-run.
```

오버라이드를 걸면 8/8 통과한다. 근본 해결은 `playwright-core` 버전을 캐시에 실재하는
빌드에 맞추는 것이고, 그건 이 QA 범위 밖이라 WP7 close-out에 라운드 6 항목으로
남긴다.

**분명히 해 둔다: 오버라이드 없이 돌리면 그 15개 테스트는 여전히 실행되지 않는다.**
메시지를 고쳐 구멍이 보이게 만들었을 뿐 메운 것이 아니다. 이 유닛의 출발점이
"안 돌아간 표면은 통과가 아니라 미검증"이므로, 그 15개는 **미검증**으로 남는다.
