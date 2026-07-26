# WP2 — `context-dry-run --file`이 크래시하던 문제

직전 QA의 §7 이월 2번. Q13은 세 경로에서 닫혔지만 `--file` 경로는 열려 있었다.

```
$ agbrowse web-ai context-dry-run --prompt hi --file web-ai/errors.mjs --json
internal.unhandled | Cannot read properties of undefined (reading 'map')   exit=1
```

## 1. 원인 — 두 술어가 서로 다른 답을 갖고 있었다

"컨텍스트 소스가 무엇인가"를 판단하는 곳이 두 군데인데 정의가 어긋났다.

| 위치 | 인정하는 것 |
|------|-------------|
| `builder.mjs:172` `hasContextPackaging` | `contextFile`, `contextFromFiles`, `contextTransform === 'repomix'` |
| `cli.mjs` 가드 (직전 라운드에 내가 넣음) | 위 셋 **+ `filePaths`** |

`--file`만 주면 가드는 통과시키고, `prepareContextForBrowser`는
`hasContextPackaging`이 false라 즉시 `null`을 반환한다(`builder.mjs:60-61`).
그 `null`이 `renderContextDryRunReport`까지 흘러가 `result.files.length`에서
터진다(`report.mjs:103`).

즉 **가드가 막으려던 바로 그 크래시를, 가드가 통과시켜서 만들고 있었다.**

## 2. 판단 — `--file`은 컨텍스트 소스가 아니다

고칠 방향이 둘이었다. `--file`을 유효한 소스로 만들거나, 가드에서 빼거나.

저장소의 도움말이 답을 준다.

```
--file <path>                    Upload a file; repeat for several files ...   (cli.mjs:158)
--context-from-files <glob|path> Add files to a context package; repeatable    (cli.mjs:197)
```

`--file`은 업로드이고 컨텍스트 패키지와 다른 개념이다. `hasContextPackaging`이
원래 맞았고, 내가 가드에 `filePaths`를 더한 것이 틀렸다. 조건에서 뺐다.

에러 메시지도 고쳤다. 이전 메시지는 `--file`을 유효한 소스로 **광고하고** 있어서
그 자체가 잘못이었다.

```
web-ai context-dry-run requires a context package: pass --context-from-files <glob>
or --context-file <path> (--file uploads a file, it does not build a context package)
```

## 3. 검증

```
--file 만                    → input.context-source-missing | add-context-source   exit=1
--context-from-files         → ok:true, dry-run                                    exit=0
--context-file <목록>        → ok:true, dry-run                                    exit=0
context-render               → exit=0
```

뮤테이션: 가드에 `filePaths.length === 0`을 되돌리면 새 테스트 1건이 RED.

## 4. 이 결함이 말해주는 것

직전 QA(§5.2)가 정리한 패턴의 또 다른 사례다. **저장소 안에 이미 옳은 답이
있었는데**(`hasContextPackaging`) 내가 가드를 쓰면서 조건을 하나 더 붙여 어긋나게
만들었다.

같은 술어를 손으로 건드릴 때마다 틀렸다. 처음엔 `contextTransform` 기본값 `'raw'`를
소스로 착각했고, 다음엔 `--context-file`을 빠뜨렸고, 세 번째가 `--file`이다.

시간순은 정확히 적어 둔다. A-gate에서 리뷰어가 git 이력을 확인했는데, `--file` 항은
별도의 세 번째 사건이 아니라 **가드가 처음 커밋될 때부터 있었다**(`4a2fb87`의 최초
라인이 이미 `&& filePaths.length === 0`을 포함한다). 즉 `--context-file` 누락을
고치던 그 수정에 이번 결함이 함께 들어 있었다. 세 번 틀린 것은 맞고, 두 번째와
세 번째가 같은 커밋이다.

### 4.1 아직 안 고친 것 — 사본은 여전히 사본이다

"이제 조건은 `hasContextPackage` 하나"라고 쓸 뻔했는데, 그건 실제보다 강한 말이다.
그 `hasContextPackage`(`cli.mjs:671-675`) 자체가 정본을 import한 것이 아니라
**손으로 쓴 사본**이다. 조건을 하나 줄였을 뿐 구조는 그대로다.

두 사본은 이미 미묘하게 다르다.

```
정본  builder.mjs:176   String(input.contextTransform || '').trim().toLowerCase() === 'repomix'
사본  cli.mjs:674       hasRepomixContext        ← 정규화 없는 정확 비교
```

그래서 `--context-transform REPOMIX`는 CLI 가드에선 소스로 인정되지 않고 정본에선
인정된다. 지금은 두 경우 모두 뒤쪽 `context.transform-failed`로 떨어져 사용자에게
보이지 않는다. 하지만 이것이야말로 **이번 결함과 같은 구조가 남아 있다**는 뜻이다.

`hasContextPackaging`은 `context-pack/index.mjs` 배럴로 이미 export되어 있어
`cli.mjs`가 그대로 import할 수 있다. 사본을 정본 호출로 대체하는 것을 다음
work-phase 후보로 올린다.
