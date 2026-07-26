# WP2 — 생명주기 · 관찰 · 상호작용 실행 QA

WP1이 기본 경로를 확인했으므로 이번에는 플래그 변형과 경계조건을 판다.

실행 환경: 격리 `BROWSER_AGENT_HOME`, 포트 9333(생명주기 절만 9344), headless,
fixture는 `/tmp/qa-site`(WP1의 `test/fixtures/site`에 없던 checkbox·radio·file
input을 넣은 QA 전용 페이지). 사용자 Chrome(9222)은 건드리지 않았다.

## 1. 새로 나온 결함

### Q7 — 브라우저 커맨드의 실패는 `--json`을 무시한다 (중)

성공하면 JSON, 실패하면 평문이다. 파싱하는 쪽에서는 성공만 읽히고 실패는 깨진다.

```
$ agbrowse check e8 --json          # 성공
{"ok":true,"ref":"e8","checked":true}

$ agbrowse check e99 --json         # 실패
❌ ref e99 not found — re-run snapshot

$ AGBROWSE_JSON_ERRORS=1 agbrowse check e99 --json
❌ ref e99 not found — re-run snapshot        # 강제해도 동일
```

`click` / `check` / `select` / `scroll --ref` 모두 같다. 종료 코드는 1로 정상이라,
실패했다는 사실은 알 수 있고 실패의 내용만 기계적으로 못 읽는다.

문서와 어긋나는 지점이 분명하다. `browser.mjs:3551`의 **환경변수 절**은 web-ai
영역 밖 전역 위치인데 이렇게 적혀 있다:

```
AGBROWSE_JSON_ERRORS=1 Force JSON failure envelopes regardless of --json
```

`README.md:706`도 범위를 한정하지 않는다: "Set `AGBROWSE_JSON_ERRORS=1` (or pass
`--json`) for machine-readable failures. **Every error becomes:**". 실제 봉투
구현은 `web-ai/cli.mjs:511`에만 있고 브라우저 커맨드 경로에는 없다.

WP1의 Q1(`status --json`)과 같은 계열이지만 범위가 더 넓다. Q1은 한 커맨드의
성공 출력이었고, 이쪽은 브라우저 커맨드 전체의 실패 출력이다.

문서 근거의 무게는 둘이 다르다. 정직하게 나눠 적는다.

- `browser.mjs:3551`은 **강한 근거다.** 바로 위 섹션 헤더가 `:3541`의
  `Environment:`이고 web-ai 블록보다 두 단계 바깥이라, 이 약속은 CLI 전체에
  걸리는 것으로 읽힌다.
- `README.md:706`은 **약한 근거다.** `## Web AI`(:578) 아래
  `### Failure envelope` 안에 있고 예시 봉투도 `"name": "WebAiError"`다. 문맥
  안에서 읽는 사람은 "Every error"를 web-ai의 모든 에러로 받아들인다.

Q7은 help 텍스트만으로 충분히 성립한다. README는 web-ai 범위로 표시해 남긴다.

### Q8 — 플래그의 **값**이 위치 인자로 새는 커맨드가 셋 더 있다 (높음)

WP1의 Q2(`evaluate`)와 같은 계열이다. Q2를 고칠 때 그 커맨드만 보고 계열 전체를
훑지 않았는데, 같은 패턴이 세 군데 더 남아 있었다.

공통 원인은 `--`로 시작하는 토큰만 걸러내는 필터다. 플래그 이름은 지워지지만 그
**값**은 위치 인자로 남는다.

| 위치 | 커맨드 | 코드 |
|------|--------|------|
| `browser.mjs:3115` | `upload` | `process.argv.slice(4).filter(a => !a.startsWith('--'))` |
| `browser.mjs:2618` | `type` | `rest.filter(a => !a.startsWith('--')).join(' ')` |
| `browser.mjs:3055` | `wait-for-text` | `--timeout`만 값까지 건너뛰고 나머지는 이름만 제거 |

셋 다 재현했다.

```
$ agbrowse upload e11 /tmp/qa-up.txt --json                    # 정상
{"ok":true,"ref":"e11","files":["/tmp/qa-up.txt"]}

$ agbrowse upload e11 /tmp/qa-up.txt --json --port 9333
❌ ENOENT: no such file or directory, stat '9333'

$ agbrowse type e2 "hello" --port 9333
$ agbrowse evaluate "document.getElementById('name').value"
"hello 9333"                                    # 페이지에 실제로 이렇게 입력됨

$ agbrowse wait-for-text "QA Fixture" --timeout 2000 --port 9333
❌ Timeout … waiting for getByText('QA Fixture 9333')
```

`type`이 제일 나쁘다. 에러 없이 **사용자 페이지에 오염된 문자열을 실제로
입력한다.** Q2의 무증상 오실행과 같은 성질이고, 이쪽은 페이지 상태를 바꾼다.

`upload`는 보통 존재하지 않는 경로라 ENOENT로 죽는다. 그런데 값과 같은 이름의
파일이 실재하면 조용히 업로드된다. 추론으로 적지 않고 충돌을 실제로 만들어
확인했다 — cwd에 `9333`이라는 파일을 두고 multiple 입력에 업로드하면:

```
$ ls           →  9333
$ agbrowse upload e2 /tmp/qa-up.txt --json --port 9333
{"ok":true,"ref":"e2","files":["/tmp/qa-up.txt","9333"]}     exit=0
```

**요청하지 않은 파일이 실제로 업로드되고 명령은 성공으로 끝난다.** 단일 파일
입력에서는 `Non-multiple file input can only accept single file`로 죽는데, 이
에러 자체가 파일 두 개가 전달됐다는 증거다.

## 2. 정상 확인 (실행 근거)

### 2.1 check / uncheck — WP1에서 fixture가 없어 미검증이던 항목

`aria-label`을 붙인 checkbox 두 개와 radio 하나를 fixture에 넣고 확인했다.

```
초기            [false, true, false]      # cb1, cb2, r1
check e8    →   {"ok":true,"ref":"e8","checked":true}
uncheck e9  →   {"ok":true,"ref":"e9","checked":false}
check e8    →   {"ok":true,"ref":"e8","checked":true}   # 멱등, 토글 아님
check e10   →   {"ok":true,"ref":"e10","checked":true}  # radio
최종            [true, false, true]
```

멱등성이 중요하다. 이미 체크된 요소에 `check`를 다시 걸어도 해제되지 않는다.
토글이었다면 재시도가 상태를 뒤집었을 것이다.

### 2.2 screenshot — 네 모드가 실제로 다른 이미지를 만든다

JSON만 보면 `--full-page`와 `--ref`는 흔적이 없고 `--clip`만 `clip` 필드에
나타난다. 그래서 출력 파일의 실제 픽셀을 쟀다.

| 명령 | 실제 크기 |
|------|-----------|
| `screenshot --json` | 1024x681 (뷰포트) |
| `screenshot --full-page --json` | 1024x681 |
| `screenshot --ref e3 --json` | **64x22** (Probe A 버튼 크기) |
| `screenshot --clip 0 0 100 50 --json` | **100x50** |

뷰포트 수치는 환경에 따라 다르다. 위 표는 `resize 1024 768`을 먼저 실행한 상태의
값이다(창 크롬 보정으로 실제 뷰포트는 1024x681). 이 줄이 없으면 다른 화면에서는
재현되지 않는 표가 된다 — 리뷰어는 기본 1440x813이었다.

`--ref`와 `--clip`은 확실히 동작한다. `--full-page`가 뷰포트와 같게 나온 것은 이
fixture 본문이 뷰포트보다 짧기 때문이지 플래그가 무시된 것이 아니다. 3000px짜리
페이지를 따로 만들어 확인했다:

| 명령 (tall.html, 본문 3000px) | 실제 크기 |
|------|-----------|
| `screenshot --json` | 1024x681 |
| `screenshot --full-page --json` | **1024x3021** |

네 모드 모두 정상이다. 짧은 페이지 하나만 보고 "`--full-page`가 무시된다"고 적었으면
없는 결함을 만들 뻔했다.

### 2.3 나머지

| 명령 | 근거 |
|------|------|
| `start --headless --port 9344` | `🌐 Chrome started (CDP: http://127.0.0.1:9344)` |
| `stop` → `status --json` | `Chrome stopped` 후 `{"running":false,"tabs":0}` |
| `snapshot --interactive --max-nodes 3` | 3행 + `note "3 of 11 shown (--max-nodes)"` |
| `text --format html` | `<!DOCTYPE html>...` 원문 |
| `get-dom --selector h1 --max-chars 40` | `<h1>QA Fixture</h1>` |
| `click --double` / `--right` | `clicked e3` / `clicked e4` |
| `type --submit` | `typed into e2` |
| `scroll down --ref e12 --amount 50 --json` | `{"direction":"down","pixels":50,"ref":"e12"}` |
| `drag e3 e4` | `dragged e3 → e4` |
| `snapshot` (플래그 없이) | `e1 heading "QA Fixture"` 등 비대화 노드까지 포함 |
| `text --format text` | 본문 텍스트 |
| `mouse-click 20 20 --double` | `🖱️ clicked at (20, 20)` |
| `mouse-down --right` / `mouse-up --right` | `mouse down (right)` / `mouse up (right)` |
| `press Escape` | `pressed Escape` |
| `resize --fullscreen` | `resized to fullscreen (window-bounds)` |
| `upload e11 <file> --json` | `{"ok":true,"ref":"e11","files":[...]}` — 단, `--port` 동반 시 Q8 |

### 2.4 플래그 충돌은 조용히 해소된다

`--ref`와 `--full-page`를 함께 주면 에러 없이 `--ref`가 이긴다.

```
$ agbrowse screenshot --ref e3 --full-page --json     → 64x22   (full-page라면 1024x681)
```

결함으로 올리지는 않는다. 다만 충돌하는 플래그 쌍이 경고 없이 한쪽으로 결정되는
것은, 플래그 변형을 파는 이 단계가 짚어둘 만한 동작이다.

같은 계열로 `--max-nodes 0`도 조용히 무시된다. 잘림 표시 없이 11행이 전부 나오며,
플래그를 안 준 것과 결과가 같다. falsy-0 처리로 보인다.

```
$ agbrowse snapshot --interactive --max-nodes 0   → 11행, note 없음
$ agbrowse snapshot --interactive --max-nodes 3   → 3행 + note "3 of 11 shown"
```

에러 경로의 종료 코드도 확인했다. 없는 ref로 `click`/`type`/`hover`, 텍스트박스에
`check` — 모두 exit 1이다.

## 3. 결함 아님으로 정정한 것

### 3.1 ref 무효화 — 원인을 두 번 틀리게 짚었다

처음에는 "`type --submit`이 DOM을 바꿔 ref가 무효가 된다"고 적었다. A-gate에서
리뷰어가 그 순서를 그대로 돌려 **성공**시켰고, 이유까지 짚었다. 이 fixture의
`<input id="name">`은 `<form>` 안에 있지 않아서 `--submit`이 Enter만 누르고 아무
것도 제출하지 않는다. 재현해 보니 그 말이 맞다:

```
navigate → snapshot → type e2 'hello' --submit   → typed into e2      exit=0
                      scroll down --ref e12 --json → {"ok":true,...}   exit=0
```

그럼 내가 처음 본 실패는 무엇이었나. 그때는 **fixture 서버가 죽어 탭이
`chrome-error://chromewebdata/`에 있었다.** 스냅샷이 Chrome 에러 페이지의
`Reload`/`Details` 버튼을 잡고 있었고, 그 상태에서 `type e2`가 먼저 실패했다.
`--submit`과는 아무 상관이 없었다.

원리 자체는 맞다. 실제 네비게이션을 시키면 ref는 무효가 된다:

```
$ agbrowse navigate .../tall.html
$ agbrowse scroll down --ref e12 --json
❌ ref e12: no per-tab snapshot found
  💡 Fix: Run 'snapshot' first to generate a per-tab snapshot     exit=1
```

에러 문구도 처음 인용한 `re-run snapshot`이 아니라 `no per-tab snapshot found`다.

**이 항목이 특히 나쁜 종류의 오류였다.** 무언가가 결함이 *아니라고* 주장하는
절이었기 때문이다. 재현되지 않는 관찰로 결함을 주장하는 것과, 재현되지 않는
관찰로 결함을 철회하는 것은 같은 잘못이고, 후자는 눈에 덜 띈다.

### 3.2 에러인데 exit 0으로 보임

파이프라인(`| tail`) 때문에 마지막 명령의 코드를 읽은 것이었다. 리다이렉트로 다시
재면 전부 exit 1이다. WP1에서 `release-gates`를 두고 똑같이 착각했던 것과 같은
실수라, 종료 코드는 항상 파이프 없이 잰다.

### 3.3 QA 하네스가 증거를 오염시킨 경로

§3.1의 뿌리는 fixture 서버가 조용히 죽은 것이다. 서브셸 백그라운드로 띄운
`python3 -m http.server`가 셸 종료와 함께 사라졌고, 그 뒤로도 몇 번 더 죽었다.
브라우저는 에러 페이지를 정상 페이지처럼 스냅샷하므로 **하네스 고장이 도구 결함처럼
보인다.**

이후로는 Node 기반 fixture(`/tmp/qa-serve.mjs`)를 관리형 백그라운드 세션으로
띄워 수명을 턴에 묶었다. 그리고 증거를 적기 전에 `location.href`를 확인해 에러
페이지가 아닌지 본다.

## 4. 미검증으로 남기는 것

| 항목 | 사유 |
|------|------|
| `reset --force` | 프로파일 삭제. 격리 HOME이라도 실익 대비 위험이 큼 |
| `start --heavy-site-compat` | COEP/COOP 완화 효과를 로컬 fixture로는 관측할 수 없음 |
| `start --headed` | headless 규약 위반. 사용자 화면을 뺏음 |
