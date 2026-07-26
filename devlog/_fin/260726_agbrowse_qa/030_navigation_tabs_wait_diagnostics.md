# WP3 — 네비게이션 · 탭 · wait · 진단 실행 QA

WP2에서 세운 규약을 그대로 쓴다. 증거를 적기 전에 `location.href`로 에러 페이지가
아닌지 확인하고, 종료 코드는 파이프 없이 재고, 수치가 환경에 의존하면 그 조건을
함께 적는다.

실행 환경: 격리 `BROWSER_AGENT_HOME`, 포트 9333, headless, fixture는
`/tmp/qa-serve.mjs`가 58500에서 서빙. 사용자 Chrome(9222)은 건드리지 않았다.

## 0. 이 단계에서 함께 처리한 코드 수정 (범위 정정)

WP3는 QA 문서 단계지만, WP2가 남긴 Q8이 위험도가 높아 A-gate 대기 중에 고쳤다.
WP1 §4.1과 같은 종류의 범위 이탈이므로 여기에 기록한다.

커밋 `ad7f259`:

| 파일 | 내용 |
|------|------|
| `skills/browser/browser.mjs` | `collectEvaluateExpression`을 `collectPositionalArgs`로 일반화하고 값-소비 플래그 집합을 명시, `type`/`upload`/`wait-for-text` 세 호출부를 교체 |
| `test/integration/cli-contract-regressions.test.mjs` | Q8 회귀 2케이스 추가 (총 10) |
| `structure/str_func.md` | 카운트 3행 동기화 |

두 회귀 테스트 모두 뮤테이션으로 RED를 확인한 뒤에 커버리지로 인정했다.

### 0.1 그 수정은 절반만 맞았다 — 커밋 `86bf3d5`

A-gate 2차에서 리뷰어가 `VALUE_TAKING_FLAGS`에 빠진 플래그 14개를 짚었다. 내가
`rg -o "indexOf('--[a-z-]+')"` 한 번으로 8개를 뽑아 목록을 만들었는데,
`parseArgs`로 선언된 플래그들은 그 스캔에 안 잡혔다. 두 개는 실제로 누출됐다:

```
$ agbrowse type e2 "hello" --file /tmp/qa-up.txt
"hello /tmp/qa-up.txt"                  ← 그대로 새어 들어감

$ agbrowse type e2 "world" --browser never
"world never"
```

`--file`은 실재하는 플래그이고 `upload --file <path>`는 자연스럽게 쓸 법한
형태다. 가상의 조합이 아니었다.

더 중요한 건 설계였다. **값-소비 플래그 목록은 fail-open이다.** 목록에 없는
플래그는 전부 값을 흘리고, 나중에 추가되는 플래그는 아무도 이 파일을 기억하지
않는 한 같은 버그를 그대로 물려받는다.

그래서 집합을 뒤집었다. 이제 **불리언 플래그**를 나열하고, 모르는 `--flag`는
값을 받는다고 가정한다. fail-closed다.

- 실수의 결과가 "값이 조용히 오염됨"에서 "인자가 빠짐"으로 바뀐다.
- 불리언 쪽이 더 작고 덜 변한다 — 이 CLI에서 18개 대 29개.
- `--flag=value`는 값을 안에 품고 있으므로 다음 토큰을 삼키면 안 된다. 별도
  분기와 테스트를 뒀다.

뮤테이션: fail-open으로 되돌리면 6건, inline `=` 분기를 지우면 1건 RED.

한 번의 grep으로 만든 목록을 근거로 "everywhere"라고 커밋 메시지에 적었던 것이
이 라운드에서 제일 부끄러운 부분이다. 리뷰어가 그 단어를 정확히 지적했다.

### 0.2 뒤집은 뒤에도 남은 구멍 두 개 (WP6 이월)

A-gate 3차에서 자동 추출한 18개(`type: 'boolean'` 선언)는 전부 들어갔지만, 내가
손으로 더한 부분에 `--fullscreen`(`browser.mjs:2731`, `resize`)과
`--inspect`(`:2748`, `tabs`)가 빠졌다.

```
$ agbrowse type e2 "abc" --fullscreen --port 9333
"abc 9333"          ← --fullscreen이 --port를 값으로 삼키고 9333이 남음
```

뒤집기가 제 역할은 했다. 결과가 "값 오염"이 아니라 "인자 누락" 쪽으로 기울고,
두 플래그 모두 `collectPositionalArgs`를 쓰지 않는 커맨드 소속이라 실사용
경로에서는 닿지 않는다. 그래서 결함으로 올리지 않고 WP6의 한 줄 보강으로 넘긴다.

위험한 쪽이 수동 부분이라는 예상이 맞았고, 구멍도 정확히 거기에만 있었다.

**A-gate 진행 중에 소스를 고친 것은 잘못이었다.** 리뷰어가 감사 도중
`grep -c MUTANT`를 1로 읽었다가 곧 0으로 읽었다. 실제로는 뮤테이션이 즉시
복원된 상태였지만, 리뷰어 입장에서는 순간 상태와 실제 상태를 구분할 방법이
없다. 라운드3에서 "뮤테이션 창을 짧게"라고 정리했는데, 더 강한 규칙이 맞다:
**A-gate가 트리를 읽는 동안에는 소스를 건드리지 않는다.**

## 1. 새로 나온 결함

### Q10 — Chromium 트랜스포트 테스트가 기본 실행에서 조용히 건너뛰어진다 (높음)

A-gate 3차에서 리뷰어가 "통합 스위트가 4파일 FAIL을 찍는데 요약은 all-green으로
읽힌다"고 지적했다. 파보니 WP10 교훈이 그대로 재발한 자리였다.

```
$ npx vitest run test/integration                       # 오버라이드 없이
Error: browserType.launch: Executable doesn't exist at
  .../chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell

 Test Files  4 failed | 18 passed (22)
      Tests  168 passed | 15 skipped (183)     ← 실패한 테스트는 0건
```

파일 단위로 보면 더 분명하다.

```
$ npx vitest run test/integration/activity-state-transport.test.mjs
 Test Files  1 failed (1)
      Tests  8 skipped (8)                      ← 8개 전부 실행조차 안 됨
```

원인은 `beforeAll`이다. 이 파일들은 `beforeAll`에서 `chromium.launch()`를 하고,
거기서 던지면 그 파일의 테스트는 **실행되지 않고 skipped로 집계된다.** 실패 카운트는
0이므로 `Tests` 줄만 보는 사람에게는 통과로 보인다.

영향받는 파일과 그 내용이 특히 나쁘다:

| 파일 | 무엇을 지키는가 |
|------|-----------------|
| `activity-state-transport.test.mjs` | 라운드5 WP2/WP3/WP7의 `page.evaluate` 트랜스포트 왕복 (G7/G9/G12/G8, G11, G25) |
| `composer-menu-transport.test.mjs` | 라운드4 issue #81 메뉴 소유권 트랜스포트 |

즉 **"`page.evaluate`는 모듈 바인딩이 아니라 함수 본문만 직렬화한다"는 규칙을
지키라고 만든 바로 그 테스트들이, 기본 실행에서는 하나도 돌지 않는다.**

`playwright-core@1.58.2`가 기본으로 찾는 빌드는 `chromium_headless_shell-1208`인데
캐시에는 1217과 1228만 있다. WP10에서 정리한 것과 같은 버전 불일치이고, 그때는
`AGBROWSE_CHROMIUM_EXECUTABLE_PATH`로 우회했다. 이 라운드의 모든 통합 실행도 그
오버라이드를 걸었기 때문에 22/22 통과였다.

정리하면 이렇게 갈린다.

```
오버라이드 있음:  22 files passed,  183 tests
오버라이드 없음:   4 files failed,  168 passed + 15 skipped
```

두 커밋(`ad7f259`, `86bf3d5`) 중 어느 것도 이 4파일을 건드리지 않았으므로 회귀가
아니라 기존 환경 문제다. 그래도 결함으로 올린다. 이유는 WP10과 같다 — **안 돌아간
표면이 통과로 보이면 그건 침묵이 아니라 거짓 신호다.**

### Q9 — `tab-cleanup`의 JSON이 `--dry-run` 유무로 완전히 달라진다 (중)

같은 커맨드, 같은 플래그인데 응답 스키마에 **겹치는 키가 하나도 없다.**

```
$ agbrowse tab-cleanup --dry-run --max-tabs 1 --include-untracked --force --json
dry-run keys: ok, dryRun, wouldClose, counts, maxTabs, idleTimeoutMs, tabsTotal

$ agbrowse tab-cleanup --max-tabs 1 --include-untracked --force --json
real    keys: closed, idleClosed, limitClosed, untrackedClosed, providerClosed, leaseClosed, leaseClosedTabs
```

구체적으로 어긋나는 것들:

- 카운터가 dry-run에서는 `counts` 객체 안에 중첩되고(`counts.limitClosed`), 실제
  실행에서는 최상위 평면(`limitClosed`)에 있다.
- dry-run에는 `ok: true`가 있고 실제 실행에는 **없다.** `ok`로 성공을 판정하던
  코드는 실제 실행 결과를 실패로 읽는다.
- `--dry-run`을 먼저 돌려 계획을 확인하고 같은 파서로 실행 결과를 읽는 흐름이
  깨진다. help가 권하는 사용법(`tab-cleanup --dry-run`으로 미리보기)이 정확히 그
  흐름이다.

help(`browser.mjs:3407`)는 `--json`이 "cleanup counts, providerClosed,
leaseClosed, and leaseClosedTabs"를 낸다고 적는데, `leaseClosedTabs`는 실제
실행에만 있고 dry-run에는 없다. 즉 help는 실행 쪽 스키마만 서술한다.

동작 자체는 맞다. 3탭에서 `--max-tabs 1`로 2개가 닫히고, 남은 탭은 1개다.
문제는 그 결과를 기계적으로 읽는 계약이다.

## 2. 정상 확인 (실행 근거)

### 2.1 탭 안전 가드

`--include-untracked`는 `--force` 없이는 거부된다. 안전장치가 의도대로 작동한다.

```
$ agbrowse tab-cleanup --dry-run --max-tabs 1 --include-untracked --json
error: tab-cleanup --include-untracked requires --force        exit=1
```

`--dry-run`은 실제로 아무것도 닫지 않는다. 실행 전후 탭 수가 3으로 같다.

### 2.2 `new-tab --no-activate`

탭은 생기고 활성 탭은 유지된다.

```
$ agbrowse new-tab .../tall.html --no-activate --json
{"ok":true,"status":"created","url":"http://127.0.0.1:58500/tall.html","title":"Tall"}
$ agbrowse evaluate "location.href"
"http://127.0.0.1:58500/"          ← 활성 탭 그대로
```

### 2.3 나머지

| 명령 | 근거 |
|------|------|
| `navigate --wait-until commit` | `navigated → .../tall.html` |
| `navigate --timeout 5000` | `navigated → .../` |
| `navigate` (죽은 포트) | `ERR_CONNECTION_REFUSED`, exit 1 |
| `console --clear --expression "console.log('probe')" --limit 5` | `[log] probe` — Q8 계열 오염 없음 |
| `tab-cleanup --dry-run --max-tabs 1 --include-untracked --force --json` | `wouldClose` 2건, `reason: "max-tabs"` |
| `tab-cleanup` 실제 실행 | `{"closed":2,"limitClosed":2,...}`, 이후 1탭 |
| `wait-for-selector "#nonexistent" --timeout 1500` | `Timeout 1500ms exceeded`, exit 1 |
| `wait-for-text "절대없는문자열" --timeout 1500` | `Timeout 1500ms exceeded`, exit 1 |
| `tab-cleanup --dry-run --idle-after 30m --json` | `idleTimeoutMs: 1800000`, `maxTabs: 20` |
| `tabs` (사람용 포맷) | `1. Multi [idle 6m]` + URL + targetId |
| `navigate --wait-until domcontentloaded` | 성공 |

### 2.4 `tab-close`는 없는 탭도 성공으로 보고한다 (결함 아님)

```
$ agbrowse tab-close DEADBEEF0000 --json
{"ok":true,"status":"closed","closed":true,"targetId":"DEADBEEF0000","alreadyClosed":true}   exit=0
```

의도된 멱등 처리다. `tab-manager.mjs:315-318`이 `No target` 오류를 잡아 이미
닫힌 것으로 취급한다. 결함으로 올리지 않는다.

다만 기록해 둘 가치가 있다. 겉보기에는 결함처럼 읽히고, 호출자는 `alreadyClosed`를
보지 않는 한 **"내가 닫았다"와 "원래 없었다"를 구분할 수 없다.** Q9가 같은 커맨드
계열의 기계 판독 계약 문제인 만큼, 이 계약도 같은 자리에 적어 둔다.

## 3. WP1 이월 항목 재확인

`network`의 `--duration` 기본값과 `--live-only` 결정성은 WP1 §`network` 절에서
메커니즘까지 규명했다. WP3에서 다시 판정하지 않고 그 결론을 유지한다: 증거로
인용할 값은 `--live-only`를 붙여 `existing` 변동 요인을 제거한 쪽을 쓴다.

## 4. 미검증으로 남기는 것

| 항목 | 사유 |
|------|------|
| `tab-cleanup --provider <vendor>` / `--keep-provider-tabs` | 로그인된 프로바이더 탭이 있어야 의미 있는 판정이 나옴 |
| `tab-switch --force` | 강제 전환이 필요한 경합 상태를 로컬에서 안전하게 만들기 어려움 |
| `evaluate --unsafe-allow` | 정책 우회 플래그. QA 목적으로 켜는 것은 범위 밖 |
