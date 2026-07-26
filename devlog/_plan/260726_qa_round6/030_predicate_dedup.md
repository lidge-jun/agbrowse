# WP2b — 컨텍스트 소스 술어의 사본 제거

WP2의 A-gate에서 리뷰어가 남긴 지적. `cli.mjs`의 `hasContextPackage`는 정본
`hasContextPackaging`(`builder.mjs:172`)을 **손으로 다시 쓴 사본**이었고, WP2가
조건을 하나 줄였을 뿐 구조는 그대로였다.

## 1. 왜 지금 고치나

같은 술어를 손으로 건드릴 때마다 틀렸다.

| 시점 | 무엇이 틀렸나 |
|------|---------------|
| 최초 | `contextTransform` 기본값 `'raw'`를 소스로 착각 |
| `4a2fb87` | `--context-file` 누락 → 멀쩡한 호출이 거부됨 |
| `4a2fb87` (같은 커밋) | `--file`을 소스로 인정 → 정본과 어긋나 크래시 |

세 번 다 "정의를 다시 쓰는" 행위에서 나왔다. 그래서 다시 쓰지 않게 만든다.

## 2. 변경

```diff
-const hasRepomixContext = contextTransform === 'repomix';
-const hasContextPackage = Boolean(
-    values['context-file'] ||
-    (Array.isArray(values['context-from-files']) && values['context-from-files'].length > 0) ||
-    hasRepomixContext
-);
+const hasContextPackage = hasContextPackaging({
+    contextFile: values['context-file'],
+    contextFromFiles: values['context-from-files'],
+    contextTransform,
+});
```

`hasContextPackaging`은 `context-pack/index.mjs` 배럴이 `builder.mjs`를
re-export하므로 그대로 import된다.

넘기는 `contextTransform`은 `:663`의 정규화와 deep-research 오버라이드를 모두 거친
값이다. 즉 이 커맨드가 실제로 수행할 모드를 정본에게 묻는다.

## 3. 리뷰어 지적 중 사실이 달랐던 것

리뷰어는 두 사본이 이미 어긋나 있다고 했다 — 정본은 `repomix` 비교 전에
`trim().toLowerCase()`를 하는데 사본은 정확 비교라, `--context-transform REPOMIX`가
두 곳에서 다르게 판정된다는 것이었다.

**실사용 경로에서는 그렇지 않다.** `cli.mjs:663`이 `normalizeContextTransformMode`로
**먼저** 정규화하므로 사본이 보는 값은 이미 `repomix`다. 수정 전에 확인했다:

```
$ agbrowse web-ai context-dry-run --prompt hi --context-transform REPOMIX --json
context.transform-failed          ← 가드는 통과했다는 뜻
```

`input.context-source-missing`이 아니라 그 뒤 단계 오류가 났다. 즉 사본도 대문자를
올바르게 처리하고 있었다.

더 정확히 말하면 사본이 대문자를 **처리한** 것이 아니라 대문자를 **볼 일이
없었다.** `normalizeContextTransformMode`는 `raw`/`repomix`가 아닌 값을
`context.transform-invalid`로 **던진다**(`transformer.mjs:52-57`). 그래서 정규화
이후 `contextTransform`이 가질 수 있는 값은 두 개뿐이고, `REPOMIX`,
`  repomix  `, `RePoMiX`가 모두 `repomix`로 수렴한다. 사본과 정본이 갈라질 입력이
실사용 경로에 존재하지 않는다.

그래도 수정은 유효하다. 사본이 **우연히** 맞았을 뿐이고, 그 우연은 호출부가 미리
정규화한다는 사실에 의존한다. 정규화 순서가 바뀌면 조용히 깨진다. 사본을 지우는
이유는 "지금 틀려서"가 아니라 "틀릴 자리를 없애기 위해서"다.

수정 후에는 가드(`:680`)와 실제 빌더 호출(`:772`)이 **같은 `contextTransform`
변수**를 같은 술어에 넘긴다. 정규화 순서가 바뀌어도 둘이 함께 움직이므로,
"우연히 맞는" 상태에서 "구조적으로 어긋날 수 없는" 상태로 옮긴 것이 이 변경의
실질이다.

## 4. 검증

| 입력 | 결과 |
|------|------|
| 소스 없음 | `input.context-source-missing` exit 1 |
| `--file` 만 | `input.context-source-missing` exit 1 |
| `--context-from-files` | `ok:true` exit 0 |
| `--context-file <목록>` | `ok:true`, files 1 exit 0 |
| `--context-transform REPOMIX` | 가드 통과 (뒤 단계 오류) |

회귀 테스트는 정본이 인정하는 **세 소스를 모두** 검사한다. 처음에는 `REPOMIX`
한 케이스만 넣었는데 뮤테이션에서 통과해 버렸다 — 앞서 확인했듯 그 케이스는 사본도
맞히기 때문이다. 세 소스를 순회하도록 고치니 `--context-file`을 빠뜨린 사본에
대해 2건 RED가 나온다.

테스트가 무엇을 지키는지 잘못 짚었다가 뮤테이션으로 걸러낸 사례다.

`send`/`query`의 첨부 프리플라이트(`:709`)도 같은 술어를 쓰므로 함께 확인했다.
소스 없는 `send`/`query`는 여전히 `provider.attachment-preflight`로 차단되고,
`--inline-only`·`--context-file`·`--file`은 프리플라이트를 지나 뒤 단계로 간다.
차단 조건이 넓어지지도 좁아지지도 않았다.

인자 매핑에서 한 가지 차이가 있다. 가드는 `values['context-from-files']`를 날것으로
넘기고 빌더 호출부(`:763`)는 `|| []`를 붙인다. 정본에 직접 물어보니 `undefined`와
`[]`가 모두 `false`로 같고 빈 문자열 `contextFile`도 `false`라, 두 호출부가 다른
답을 얻을 여지는 없다.
