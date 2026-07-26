# WP5 — web-ai 무로그인 표면 · skills · JSON 계약

로그인이나 과금이 필요 없는 표면만 다룬다. `send`/`query`/`work`/`poll` 등은
000_plan.md §3의 미검증 목록에 남는다.

## 1. 새로 나온 결함

### Q13 — 사용자 입력 오류를 담을 errorCode가 없다 (중)

WP1의 Q5를 파고들어 근본 원인에 닿았다. 인자를 빠뜨렸을 때 세 커맨드가 각각 다른
**틀린** errorCode를 낸다.

```
$ agbrowse web-ai render --vendor chatgpt --json
errorCode: context.over-budget   stage: context-preflight   msg: "prompt required"

$ agbrowse web-ai context-dry-run --vendor chatgpt --json
errorCode: internal.unhandled    msg: "Cannot read properties of undefined (reading 'map')"

$ agbrowse web-ai context-render --vendor chatgpt --json
errorCode: internal.unhandled    msg: "Cannot read properties of undefined (reading 'map')"
```

`render` 쪽이 특히 나쁘다. `question.mjs:80-86`에서 프롬프트가 비었을 때
`context.over-budget`을 던지는데, 같은 파일 `:161-167`은 **진짜** 예산 초과에
같은 코드를 쓴다.

```js
// :82  프롬프트 없음
errorCode: 'context.over-budget', retryHint: 'reduce-files', message: 'prompt required'

// :163 진짜 예산 초과
errorCode: 'context.over-budget', retryHint: 'reduce-files',
message: `inline prompt too large: ${composerText.length}/${INLINE_CHAR_LIMIT} chars`
```

두 사건이 코드로 구분되지 않고, `retryHint: 'reduce-files'`까지 딸려온다. 즉
**프롬프트를 안 쓴 사용자에게 "파일을 줄이라"고 안내한다.**

처음에는 원인을 "사용자 입력 오류를 담을 errorCode 계열이 없어서"로 적었다.
**그 진단은 틀렸다.** A-gate에서 리뷰어가 반증을 내놨고, 재현해 보니 맞았다:

```
$ agbrowse web-ai code --vendor chatgpt --json
errorCode: code-mode.prompt-missing   retryHint: add-prompt
message: "web-ai code requires --prompt <build-spec>"        exit=1
```

똑같이 `--prompt`가 없는 상황인데 이쪽은 전부 옳다. 전용 코드, 전용 stage,
실행 가능한 `retryHint`. `cli.mjs:904-912`에 구현돼 있고 `:321`의 문서화된
`Codes:` 목록에도 들어 있다. `errorCode`는 자유 문자열이라(`errors.mjs:69`)
새 값을 못 쓸 이유도 애초에 없었다.

정확한 진단은 더 좁고, 그래서 더 나쁘다. **올바른 방법이 이미 저장소 안에 있는데
나머지 경로가 따르지 않았다.** `code`는 저자가 이 문제를 어떻게 다뤄야 하는지 알고
있었음을 증명한다. `render`, `context-dry-run`, `context-render`, `sessions show`는
각자 가장 그럴듯해 보이는 코드를 집어 들었다.

Q8(한 커맨드만 고치고 형제들을 놔둠)과 Q11(`extract`만 옳음)과 같은 모양이다.
설계 공백이 아니라 일관성 실패다.

WP6에 미치는 영향이 크다. 처음 진단대로면 "`input.*` 계열을 설계한다"가 되지만,
정정된 진단대로면 **"이미 있는 `code-mode.prompt-missing` 선례를 나머지 입력
오류로 확장한다"**가 된다. 훨씬 작고, 동작하는 것에 대고 리뷰할 수 있다.

WP1의 Q5는 이 항목에 흡수한다. Q5는 한 커맨드의 증상이고 Q13은 네 커맨드에
걸친 패턴이라, 따로 두면 하나의 WP6 변경이 두 항목으로 쪼개진다.

### Q14 — `skills install`의 실패도 `--json`을 무시한다 (중하)

Q7 계열이 `skills`에도 있다.

```
$ agbrowse skills install --target <이미-있는-경로> --json
❌ target skill already exists: /tmp/qask2-zt95/browser (use --force to replace)   exit=1
```

가드 자체는 옳다. 덮어쓰기를 막고 해결 방법까지 알려준다. 형식만 계약을 어긴다.
Q7/Q11/Q12와 함께 §5.1 묶음에 들어간다.

## 2. 정상 확인 (실행 근거)

| 명령 | 근거 |
|------|------|
| `web-ai render --vendor chatgpt --prompt hi --json` | 봉투 렌더, 브라우저 미기동 |
| `web-ai render --vendor bogus --json` | `ok:false`, `provider.runtime-disabled`, exit 1 |
| `web-ai sessions list --json` | 세션 스토어 조회 |
| `web-ai eval --json` | `ok:true`, `status: pass`, runId/gitCommit 포함 |
| `web-ai claim-audit` | WP1 Q3 수정 후 위반 시 exit 1 |
| `skills list --json` | 4개 스킬, 경로 포함 |
| `skills get web-ai` | SKILL.md 원문 |
| `skills get nonexistent-qa` | `unknown skill: ... Run "agbrowse skills list"`, exit 1 |
| `skills path web-ai` | 번들 경로 |
| `skills install --target <tmp> --json` | `mode: copy`, 4개 설치 |
| `skills install --target <tmp> --link --json` | `mode: link`, 실제 심볼릭 링크 생성 확인 |
| `skills install` 재실행 + `--force` | `actions: copied,copied,copied,copied` |
| `skills install --target <없는-경로>` | 상위 디렉터리를 만들고 설치, exit 0 — 결함 아님 |

마지막 행은 A-gate에서 한 번 결함 후보로 올라왔다가 내려온 것이다. 리뷰어가
"없는 경로인데 exit 0"을 Q11 계열로 의심했는데, 확인해 보니 그 경로는 리뷰어
자신의 이전 실행이 만들어 둔 것이었다. 완전히 새 경로로 다시 돌리면 상위
디렉터리를 만들고 정상 설치한다.

WP2 §3.1에서 내가 겪은 것과 같은 종류다. 오염된 환경의 관찰을 발견으로 보고하는
것 — 감사하는 쪽도 예외가 아니다.
| `web-ai sessions prune --older-than 30d --json` | exit 0, 정상 JSON |
| `web-ai eval --concurrency 2 --json` | 정상 |
| `skills get core` / `skills path` (인자 없이) | 정상 |

`skills`의 에러 메시지는 사람이 읽는 쪽에서 가장 좋다. 무엇이 잘못됐는지와 다음에
무엇을 하면 되는지를 함께 준다(`Run "agbrowse skills list"`,
`use --force to replace`). 형식만 JSON이 되면 그대로 모범 사례다.

다만 유일한 모범은 아니다. `code-mode.prompt-missing` + `retryHint: add-prompt`는
같은 미덕을 **기계가 읽을 수 있는 형태로** 표현한다. Q13의 수정이 따라갈 선례는
그쪽이다.

## 3. 미검증으로 남기는 것

| 항목 | 사유 |
|------|------|
| `web-ai send`/`query`/`poll`/`watch`/`code`/`code-extract`/`stop`/`snapshot` | 로그인 세션 필요, 사용자 계정에서 실제 프롬프트 소비 |
| `web-ai work send` | 위와 같음 + Work 과금 |
| `web-ai status`/`doctor` | 활성 프로바이더 탭 전제 |
| `web-ai project-sources add` | 사용자 ChatGPT 프로젝트를 변형 |
| `web-ai mcp-server` | 장기 실행 stdio 브리지. 별도 하네스 필요 |
| `web-ai sessions resume`/`reattach` | 살아있는 프로바이더 세션 필요 |
