# 020 — WP10 fail-open 교정 처방 (B03, B06)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP10 (계획 표의 WP5 fail-open 교정분을 예산 계약과 분리해 선행)
- 선행: 없음 — **예산 모델 A의 reversal gate G1~G4와 독립이다**
- 대상: `021_stall_boundary_map.md` §3의 fail-open 여섯 중 유닛 A 담당 둘

## 왜 예산보다 먼저인가

두 유닛의 계획서가 같은 말을 한다. "예산 계약과 **독립적으로** 고쳐야 한다 —
예산을 씌워도 틀린 결론은 그대로다."

예산 계약은 정체를 **지연**에서 **반환**으로 바꾼다. B03·B06은 정체를
**틀린 답**으로 바꾼다. 데드라인이 아무리 정확해도, 그 안에서 "조용하니
끝났다"고 판정해 옛 답을 반환하면 사용자는 오답을 받는다. 게다가 이 교정은
`Page.reload` primitive에도, 동기 store의 async 전환에도 걸리지 않는다.
G1~G4가 전부 실패해 B/C로 복귀하더라도 이 처방은 그대로 유효하다.

## B03 — `readActivityState`가 실패를 quiet으로 위장한다

### 현재 계약

`web-ai/chatgpt.mjs:1030-1053`. 세 갈래가 전부 같은 값으로 수렴한다.

| 갈래 | 위치 | 반환 |
| --- | --- | --- |
| stop probe 실패 | `:1034-1036` catch | 아래로 진행 |
| `page.evaluate` throw/reject | `:1050` catch | `{strength:'none'}` |
| 반환값이 객체도 boolean도 아님 | `:1046-1049` 미매치 | `{strength:'none'}` |
| 정상 quiet | `chatgpt-response-dom.mjs:250` | `{strength:'none'}` |

**정상 quiet과 관측 실패가 구분되지 않는다.**

### 소비 지점의 비대칭

`'none'`을 읽는 곳이 둘인데 서로 반대 방향으로 해석한다.

| 소비자 | 위치 | `'none'`의 의미 |
| --- | --- | --- |
| poll 루프 | `chatgpt.mjs:682-683` | `streaming=false`, `weakActive=false` → 완료 판정 진입, 안정화 1초 |
| 이미지 shortcut | `chatgpt.mjs:693` | "완전 quiet" — 종결 증거 없이 첫 이미지로 반환 |
| `isActiveState` | `chatgpt-response-dom.mjs:260` | `'none'`만 false |
| recovery `readStreaming` | `chatgpt.mjs:871` → `:1059` | false → 복구된 텍스트를 최종 답으로 확정 |
| copy fallback | `chatgpt.mjs:923` | false → deferred 아닌 확정 경로 |

정체 중 evaluate가 실패하면 다섯 소비자 전부가 "생성이 끝났다"로 읽는다.
가장 나쁜 것은 이미지 shortcut(`:693`)이다 — 종결 증거를 요구하지 않는 유일한
반환 경로인데, 그 게이트가 바로 `strength === 'none'`이다.

### 처방

`ChatGptActivityStrength`에 **`'unknown'`을 추가**한다
(`chatgpt-response-dom.mjs:136-137`). 관측 실패 전용 값이며 DOM 리더는 이 값을
절대 만들지 않는다 — `readActivityState`의 catch/미매치 갈래만 만든다.

```
 * @typedef {'strong'|'weak'|'none'|'unknown'} ChatGptActivityStrength
```

`readActivityState`(`chatgpt.mjs:1030-1053`):

- `page.evaluate` catch → `{ strength: 'unknown', evidence: 'read-failed' }`
- 객체도 boolean도 아닌 반환 → `{ strength: 'unknown', evidence: 'read-malformed' }`
- 정상 quiet 경로는 `'none'` 그대로
- stop probe catch(`:1036`)는 지금처럼 DOM probe로 진행 — 여기서 실패해도
  아래 evaluate가 판정을 낸다

소비자별 해석을 **각각 명시**한다. 열거값 추가만으로는 안 된다 — 조사에서
확인됐듯 `unknown`은 `!== 'none'`이라 `isActiveState`에서 자동으로 active가
되고, poll 본문에서는 세 비교 전부에 걸리지 않아 quiet처럼 흘러간다. 두
경로가 반대로 갈린다.

| 소비자 | 처방 | 근거 |
| --- | --- | --- |
| `chatgpt.mjs:682` `streaming` | `'strong'`만 true — **변경 없음** | unknown을 streaming으로 보면 정체가 무한 대기가 된다. 데드라인은 예산 계약이 담당한다 |
| `chatgpt.mjs:683` `weakActive` | `'weak' \|\| 'unknown'` | 관측 불가면 최소 5초 quiet을 요구한다. 조기 확정을 늦추되 막지는 않는다 |
| `chatgpt.mjs:693` 이미지 shortcut | `'none'` 유지 — unknown 진입 금지 | **핵심 교정.** 종결 증거 없는 반환 경로는 확인된 quiet만 허용한다 |
| `isActiveState` | `'unknown'` → **false** | 아래 참조 — 안전한 이유는 "데드라인 이후"가 아니라 종결 증거가 별도로 게이트하기 때문이다 |
| recovery/copy | warning으로 표면화 | 아래 |

### `isActiveState`를 false로 두는 근거 — 그리고 그 예외

초판은 "데드라인 이후 경로라 진행이 옳다"고 썼다. **그 논거는 틀렸다.**
감사가 지적한 대로, 데드라인을 지났다는 사실 자체는 아무것도 보장하지 않는다.

실제로 안전한 이유는 두 소비자가 **독립적인 종결 증거를 따로 요구**하기
때문이다.

| 경로 | streaming=false 이후 | 게이트 |
| --- | --- | --- |
| recovery `:887-895` | `recovered.finished !== true` → `recovery-deferred-unverified` | `isResponseFinished`의 terminal actions |
| copy `:942-953` | `completion.finished !== true` → `copy-markdown-deferred-unverified` | 동일 |

즉 unknown이 false로 평탄화돼도 "종결됐다"는 판정은 activity가 아니라
`isResponseFinished`가 낸다. 텍스트 응답에서는 이 conjunct가 방어다.

**그런데 image-only 응답에는 이 방어가 없다.** 감사가 찾은 실제 회귀다.

```
outputImage 요청 + activity가 계속 unknown
  → 루프의 이미지 shortcut(:693)은 'none'이 아니라서 차단된다   ← 우리가 의도한 것
  → 데드라인 도달
  → recovery에서 unknown이 false로 평탄화
  → 'Edit' 같은 image chrome text가 terminal finished를 갖는다
  → status:'complete', answerText:'Edit' 반환                    ← 이미지 수집 없이
```

`isImageOnlyGeneratedImageChromeText`(`chatgpt-images.mjs:207-214`)가 `''`,
`'edit'`, `'creating image'`, `'stopped thinking'`을 image chrome으로 판정한다.
사용자는 요청한 이미지 대신 UI 조각을 성공 답으로 받는다.

**교정 전보다 나빠진다.** 지금은 unknown이 `'none'`으로 뭉뚱그려지므로 루프
안에서 이미지 shortcut이 발화해 실제로 이미지를 수집한다. shortcut만 막고
뒷문을 열어두면 그 경로를 잃는다.

따라서 **structured verdict를 recovery까지 보존**한다. boolean으로 버리면
안 된다.

#### 어느 관측을 보는가 — `recoveryActivity`

"마지막 activity"가 무엇인지 정의하지 않으면 양쪽으로 틀린다.

- 루프의 **과거** unknown을 보면: recovery 시점에 DOM이 회복돼 정상 `'none'`을
  읽어도 이미지를 차단한다 → 정상 응답을 막는 false positive
- recovery의 관측을 **안 보면**: 원래의 `complete`/`'Edit'` fail-open이 그대로

`recoveryActivity`는 **recovery가 수행한 바로 그 activity read**로 정의한다.
과거 관측이 아니다.

현재 계약이 이를 막는다. `recoverAssistantResponse`
(`chatgpt-response-observer.mjs:98`)는 `readStreaming`을 `Boolean()`으로 감싸
버리고(`:140`) 결과에도 `streaming: boolean`만 싣는다. 둘 중 하나를 택한다.

1. `recoverAssistantResponse`가 structured activity를 함께 반환하도록 계약 확장
2. `pollWebAi`가 `readActivityState`를 직접 호출해 structured state를 보관하고,
   그 boolean 파생값을 `readStreaming`에 넘긴다

2안이 관측 지점을 `pollWebAi`에 두어 ledger 기록과 같은 자리에 모인다. 같은
read 결과를 재사용해 호출이 늘지 않게 한다.

#### 이 work-phase에서는 수집하지 않는다

초판은 "예산 안에서 이미지 수집을 시도"한다고 썼다. **지금은 실행할 수 없다.**
이 지점은 데드라인을 이미 지난 뒤라 남은 루프 예산이 0이고, 예산 primitive는
이 work-phase의 선행이 아니라고 스스로 선언했다. 근거 없는 처방이다.

WP10의 확정 처방은 이것이다.

**recovery 분기만 막으면 안 된다.** 감사가 짚었듯 post-deadline에는 textual
complete를 만드는 경로가 둘이다.

| 경로 | 도달 조건 |
| --- | --- |
| recovery complete `:897-912` | session 있음 + candidate 재취득 성공 |
| copy complete `:960-984` | session 없어 recovery 생략, 또는 recovery의 candidate 재취득 실패 후 루프의 `stableText` 잔존 |

no-session poll에서는 recovery가 아예 돌지 않는다(`:867` `if (session)`).
recovery만 막으면 그 경우 copy가 그대로 `'Edit'`를 complete로 낸다.

따라서 **post-deadline textual complete 직전의 공통 불변식**으로 둔다.

#### 유일한 차단 규칙

제어 흐름을 바꾸는 조건은 **하나뿐이다.** 초판이 세운
`outputImage && image-chrome` 게이트는 **폐기한다** — 아래 이유로 substantive
텍스트가 우회한다.

```
post-deadline textual complete (recovery·copy 공통):
  이 경로가 이미지 저장을 수행하지 않는다
  && input.outputImage !== undefined
  → complete 금지. 텍스트 내용과 무관하다.
    session 있으면 deferred — recovery는 `recovery-deferred-unverified`,
    copy는 `copy-markdown-deferred-unverified`.
    session 없으면 timeout 또는 provider.image-output 실패.
    recoveryActivity.strength === 'unknown'이면
    `activity-read-unverified`도 함께 기록한다.
```

`isImageOnlyGeneratedImageChromeText`는 **관측과 분류에만** 쓴다. 완료 차단의
필요조건이 아니다. 판별을 조건에 넣으면 `recovered.text`가 substantive할 때
`:897-912`가 파일 없이 `complete`를 내고, copy도 markdown을 얻은 순간
같은 우회를 한다.

텍스트를 관측용으로 볼 때도 **실제로 반환할 문자열**을 봐야 한다. recovery는
`recovered.text`, copy는 `preferCopiedText`가 아니라 그 뒤의
`cleanAssistantText(copiedText)` 결과다(`:967`). raw copy가
`'Thought for 2s Edit'`이면 raw 검사는 통과하지만(`chatgpt-images.mjs:208-213`은
`'stopped thinking edit'`은 알아도 이 조합은 모른다) cleaning 후 최종 답은
`'Edit'`가 된다.

#### 왜 텍스트 내용과 무관한가

초판은 "copy가 실제 markdown을 얻어냈다면 통과, 파일 미저장은 warning"이라고
썼다. **기존 공개 계약을 약화하는 것이라 철회한다.**

`devlog/_fin/260508_oracle_parity/11_generated_images_public_contract.md:71-80`이
명시한다 — 명시적 output path에서 이미지가 없거나 저장에 실패하면
"warning을 붙인 성공"이 아니라 **실패**다. 사용자가 구체적 파일을 요청했기
때문이다. pre-deadline 코드도 이를 `WebAiError` throw로 강제한다(`:751-760`).

**이 규칙은 copy만의 것이 아니다.** recovery도 이미지를 수집하지 않으므로
대칭으로 적용된다. 그래서 위 불변식이 두 경로 공통이다.

보조 warning을 남기더라도 그것이 실패를 성공으로 바꿔서는 안 된다. 새 warning
이름을 만들기보다 기존 `provider.image-output` 계약을 재사용하는 편이 일관된다.

**activity strength를 조건에 넣지 않는다.** 초판은 `unknown`일 때만 막았는데
감사가 그 구멍을 짚었다. `recoveryActivity`가 `'none'`이어도 —
즉 생성이 확실히 끝났어도 — `recovered.text`는 여전히 `'Edit'` 같은 image
chrome이다. **activity가 quiet하다는 사실은 이미지 파일을 수집했다는 증거가
아니다.** 사용자는 이미지를 요청했는데 UI 조각을 성공 답으로 받는다.

즉 이 경로의 판정 기준은 activity가 아니라 **요청된 산출물이 없다는 것**이다.
`outputImage`를 요청했고 텍스트가 image chrome뿐이면, 수집 없이 complete를
반환할 근거가 없다.

`recoveryActivity`는 그래서 차단 조건이 아니라 **관측 기록**으로만 쓴다.
`recoverAssistantResponse`가 `readStreaming`을 정확히 한 번 호출하므로
(`chatgpt-response-observer.mjs:121`) closure로 structured state를 붙잡는다.

```js
let recoveryActivity;
readStreaming: async () => {
    recoveryActivity = await readActivityState(page);
    recordActivity(recoveryActivity, ledger);
    return isActiveState(recoveryActivity);
}
```

candidate가 없으면 콜백도 호출되지 않지만 그때는 recovery 성공 분기 자체가
없다.

bounded collection은 예산 계약 WP가 **명시적인 recovery reserve**를 만든 뒤에
한다. 그 전까지는 틀린 답 대신 deferred를 준다 — 사용자는 `poll --resume`으로
이어갈 수 있다.

**정상 이미지 응답이 막히지 않는다는 증명은 다른 곳에서 한다.**
데드라인 **전** shortcut(`:693`)이 `'none'` + 수집 성공에서 계속
`generated-image` complete를 반환하는지로 고정한다. post-deadline 경로를
false-positive 검증에 쓰면 안 된다 — 거기서는 애초에 수집을 하지 않기 때문이다.

`weakActive`에 unknown을 넣는 5초 quiet은 **방어가 아니라 지연**이다. 실제
방어는 이미지 shortcut 차단과 `finished` conjunct 둘뿐이며, 위 조건이
post-deadline image 경로의 세 번째다.

### warning 전파 — boolean으로 버리면 기록할 수 없다

`isStreaming`(`:1058-1059`)이 activity state를 boolean으로 버린다. recovery와
copy는 자기가 unknown을 봤다는 사실 자체를 알 수 없다. 그러니 "warning을
넣는다"고 선언만 해서는 구현이 안 된다.

`pollWebAi` 스코프에 **observation ledger**(`Set<string>`)를 둔다.
`readActivityState`와 ordering 게이트의 structured 결과를 읽는 지점에서 직접
기록한다.

반환 경로마다 warnings 배열을 손으로 병합하면 **반드시 빠뜨린다.** 초판이
일곱을 열거했는데 둘을 놓쳤다.

| 반환 | 위치 | 초판 |
| --- | --- | --- |
| target mismatch | `:636` | **누락** |
| conversation mismatch | `:650` | **누락** |
| 이미지 shortcut | `:708` | ○ |
| 정상 complete | `:733` 계열 | ○ |
| tab-crashed | `:855` | ○ |
| recovery complete | `:910` | ○ |
| deferred (recovery·copy) | `buildDeferredPollingResult` | ○ |
| copy complete | `:981` | ○ |
| timeout | `:999`, `:1018` | ○ |

두 mismatch는 조기 반환이라 놓치기 쉬운데, 바로 그래서 위험하다. 앞선 tick에서
unknown을 기록한 뒤 다음 tick에 target이 바뀌면 관측이 통째로 사라진다.

따라서 **단일 envelope helper**로 감싼다.

```
mergeObservationWarnings(result, ledger)
```

적용 대상은 "모든 lexical `return`"이 아니라 **모든 result-envelope 생성
지점**이다. warning이 반환값 밖으로도 새기 때문이다.

| 함정 | 이유 | 순서 |
| --- | --- | --- |
| `withAnswerArtifact` | 호출 시점에 warnings를 artifact로 복사한다(`answer-artifact.mjs:66`). 나중에 감싸면 `answerArtifact.warnings`가 옛 배열로 남는다 | `withAnswerArtifact(mergeObservationWarnings(result, ledger))` — **반드시 안쪽에서 병합** |
| `buildDeferredPollingResult` | 반환 전에 session warnings를 저장한다 | 병합된 배열을 **인자로 전달**해 session과 반환값이 같은 값을 쓰게 한다 |
| `finalizeProviderTab` | return보다 **먼저** 실행되며 warnings를 저장한다(`:790`, `:910` 계열) | 호출 전에 local warnings와 ledger를 병합하고, **같은 배열**을 finalizer·result·artifact에 넘긴다 |

세 지점을 놓치면 top-level warnings에만 관측이 남고 artifact·session·finalizer
기록은 어긋난다. 사용자가 보는 곳과 저장되는 곳이 달라지는 것이라 조용한
불일치가 된다.

`unknown → 다음 tick target mismatch` 회귀 테스트로 고정한다.

기록하는 코드는 `activity-read-unverified`, `assistant-ordering-unverified`
둘이다. 기존 규약(`recovery-deferred-unverified`, `copy-markdown-deferred-*`)과
같은 kebab-case 이벤트 코드다.

## B06 — `doesAssistantFollowUser`가 실패를 "순서 정상"으로 읽는다

### 현재 계약

`web-ai/chatgpt.mjs:560-575`. `.catch(() => null)` 뒤 `result !== false`이므로
**null이 true가 된다.** 호출부(`:722`)도 `.catch(() => true)`로 한 번 더 감싼다.

이 게이트의 목적은 "옛 답을 최신 답으로 오인하지 않는 것"이다
(`:717-720` 주석). 그런데 확인에 실패하면 확인된 것처럼 통과시킨다. 게이트가
가장 필요한 순간 — DOM이 정체돼 평가가 안 되는 순간 — 에 무력화된다.

### 세 상태를 구분해야 한다

현재 boolean 둘로는 부족하다.

| 브라우저 판정 | 의미 | 현재 | 처방 |
| --- | --- | --- | --- |
| assistant가 user 뒤 | 순서 정상 | true | `'ordered'` |
| assistant가 user 앞 | 옛 답 | false | `'stale'` |
| user turn 없음 (`:566`) | 검증 불가하나 정상 케이스 | true | `'unverifiable'` |
| evaluate 실패/null | **관측 실패** | true | `'unknown'` |

`:566`의 "user turn 없음"은 실패가 아니다. 시스템 발화 대화나 fixture에서
정상적으로 발생하며, 그때는 통과가 옳다. 관측 실패와 같은 값으로 뭉뚱그리면
안 되므로 분리한다.

### 처방

반환형을 `Promise<'ordered'|'stale'|'unverifiable'|'unknown'>`으로 바꾸고
함수명을 `readAssistantTurnOrdering`으로 바꾼다 — boolean 이름을 유지한 채
열거를 반환하면 호출부가 truthy로 오용한다.

호출부(`:721-723`):

**`continue`를 쓰면 안 된다.** 초판이 그렇게 썼는데 감사가 잡았고, 코드로
확인했다.

`:721-723`의 `continue`는 루프 끝의 `page.waitForTimeout(500)`
(`:834-845`)을 **건너뛴다**. 결과는 둘 다 나쁘다.

- 실시간: 데드라인까지 evaluate를 쉬지 않고 재실행하는 busy-loop
- 가상시계 하네스: `test/unit/web-ai-chatgpt-activity-poll.test.mjs:26-30`의
  offset이 `waitForTimeout`에서만 전진한다. 건너뛰면 `Date.now()`가 멈춰
  `while (Date.now() <= deadline)`(`:631`)이 **영원히 참이다**

기존 `'stale'` 경로에도 같은 결함이 있다. 지금은 fixture가 게이트를 무력화해
드러나지 않았을 뿐이다. unknown을 이 경로에 얹으면 결함 표면만 넓어진다.

대신 ordering 미확정을 **후보 자격 박탈**로 표현해 공통 pacing까지
내려보낸다.

```
let orderingOk = true;
if (latest && !streaming && latestSnapshot?.source !== 'wrapperless') {
    const ordering = await readAssistantTurnOrdering(page);
    orderingOk = ordering === 'ordered' || ordering === 'unverifiable';
    if (ordering === 'unknown') ledger.add('assistant-ordering-unverified');
}
// 아래 완료 판정 진입 조건에 orderingOk를 conjunct로 추가한다.
// 미확정이면 else 분기가 stableText/stableSnapshot/stableSince를 초기화하고
// 루프는 반드시 waitForTimeout을 지난다.
```

DOM이 회복되면 다음 tick에 정상 판정이 나오고, 회복되지 않으면 데드라인에서
timeout으로 반환된다 — **틀린 답 대신 timeout**이다. 이것이 fail-closed다.

`stale`도 같은 경로로 옮긴다. 예산 계약이 도입되면 이 pacing 지점이
budget-aware tick의 단일 경계가 되므로, 지금 한 곳으로 모아두면 재작업이 없다.

### `strength` 정규화 — union 추가만으로는 부족하다

`:1046`의 현재 검사는 `typeof state.strength === 'string'`이면 무엇이든
통과시킨다. `{strength:'bogus'}`도 그대로 흘러간다. JSDoc union에 `'unknown'`을
추가해도 이 `page.evaluate` 경계는 검증되지 않는다.

`'strong'|'weak'|'none'` **화이트리스트로 좁히고 나머지는 전부 `'unknown'`으로
정규화**한다. 이것이 sentinel 계약의 실제 강제 지점이다.

## 테스트 파급 — fixture가 fail-open에 기대고 있다

조사에서 확인된 사실이 이 work-phase의 실제 위험이다.

**B03**: 현재 `readActivityState`의 evaluate가 실제로 throw해서 catch를 타는
테스트는 **하나도 없다**. `test/unit/web-ai-provider-session.test.mjs:405`가
`[]`을 반환해 미매치 갈래로 떨어지는 것이 유일하게 근접한 사례다. 즉 B03의
fail-open 경로는 지금까지 한 번도 검증된 적이 없다. 새 테스트를 쓰지 않으면
교정 자체가 관측되지 않는다.

**B06**: 반대로 여기는 **기존 fixture가 fail-open에 의존해 통과 중이다**.

| fixture | 위치 | 현재 동작 |
| --- | --- | --- |
| fake ChatGPT | `test/integration/web-ai-fake-chatgpt.test.mjs:191-221` | inline ordering 함수가 이름 매칭에 안 걸리고 인자도 없어 `null` → true |
| golden scenario | `test/integration/web-ai-golden-scenario.test.mjs:185-215` | 동일 구조로 `null` → true |
| streaming recovery | `test/unit/web-ai-provider-session.test.mjs:424-435` | 실제 함수 실행 중 `selectors[0]`에서 throw → `.catch(() => null)` → true |
| copy fallback | `test/unit/web-ai-provider-session.test.mjs:461-478` | 동일 |

**fail-closed로 바꾸면 이 넷이 깨진다.** 이건 회귀가 아니라 **교정이 실제로
작동한다는 증거**다. 다만 fixture를 고치는 방향이 중요하다.

금지: 호출부에서 fixture를 특별 취급하거나 `'unknown'`을 통과시키는 escape
hatch. 그건 fail-open을 되살리는 것이다.

처방: fixture가 ordering evaluate를 **실제로 응답**하게 만든다. `#87` WP2에서
같은 교훈을 얻었다 — fixture가 서브메뉴를 모델링하지 않아 코드를 지워도
테스트가 통과했다. 여기서도 fixture가 ordering을 모델링하지 않아 게이트가
무력화된 상태로 통과 중이다.

각 fixture에 순서 상태를 명시적으로 주입한다.

```
makeFakeChatGptPage({ turnOrdering: 'ordered' })   기본값
makeFakeChatGptPage({ turnOrdering: 'stale' })     옛 답 거부 검증
makeFakeChatGptPage({ turnOrdering: 'unknown' })   fail-closed 검증
```

**주입만으로는 부족하다.** `turnOrdering`을 fixture가 직접 반환하면 호출부
분기는 검증되지만 브라우저 콜백이 ordered/stale/no-user를 옳게 판정하는지는
검증되지 않는다. 특히 T8에서 `'unverifiable'`을 직접 주입하면 `:566`의
`!lastUserTurn` 구현을 **지워도 통과한다**. #87 WP2에서 겪은 것과 같은 함정이다.

따라서 producer와 consumer를 나눠 검증한다.

| 층 | 하네스 | 검증 대상 |
| --- | --- | --- |
| producer | 실제 Chromium DOM에서 `readAssistantTurnOrderingInPage` 실행 (`activity-state-transport.test.mjs` 방식) | ordered / stale / user turn 없음 세 판정 |
| consumer | fixture 주입 + `pollWebAi` 구동 | 네 열거값에 대한 루프 동작 |

producer 테스트가 성립하려면 **production이 쓰는 바로 그 함수를 실행**해야
한다. 현재 ordering 콜백은 `chatgpt.mjs:561-574`의 비공개 inline 화살표
함수라 테스트에서 접근할 수 없다. 로직을 복제하면 production 콜백을 지워도
테스트가 통과하는 거짓 양성이 된다 — #87에서 겪은 그 함정이다.

콜백을 `chatgpt-response-dom.mjs`로 옮겨 named export로 만든다. 그 모듈이 이미
`readChatGptStreamingState`(`:141`), `resolveTopLevelAssistantTurns`(`:95`) 등
브라우저 직렬화 콜백 전부의 소유처이고, transport 테스트가 그 export들을 직접
import해 실제 Chromium에서 돌린다(`activity-state-transport.test.mjs:3-9`).
같은 경계를 따른다.

**이름을 나눈다.** 브라우저에서 도는 producer와 Node 쪽 wrapper는 계약이 달라
같은 이름을 쓸 수 없다 — 문법적으로도 unaliased import와 지역 선언이 공존하지
못한다.

```
// chatgpt-response-dom.mjs — 브라우저에서 직렬화되어 실행
export function readAssistantTurnOrderingInPage(selectors)
  → 'ordered' | 'stale' | 'unverifiable'

// chatgpt.mjs — Node 쪽 wrapper
async function readAssistantTurnOrdering(page)
  → 'ordered' | 'stale' | 'unverifiable' | 'unknown'
```

wrapper는 `page.evaluate(readAssistantTurnOrderingInPage, CHATGPT_TURN_SELECTORS)`를
호출하고 throw·null·malformed를 전부 `'unknown'`으로 정규화한다. transport
테스트는 producer(`readAssistantTurnOrderingInPage`)를 직접 import한다.

`CHATGPT_TURN_SELECTORS`는 **현재 저장소에 없다.** 지금은 셀렉터가 콜백 본문에
하드코딩돼 있다(`chatgpt.mjs:562-564`). 이동하면서 `chatgpt-response-dom.mjs`의
named export로 승격한다 — `CHATGPT_ASSISTANT_SELECTORS`(`:3`),
`CHATGPT_STOP_SELECTORS`(`:9`)와 같은 자리다. production wrapper와 transport
테스트가 같은 상수를 쓴다.

`'unknown'`은 producer가 만들지 않는다. `strength`와 같은 규칙이다 — 브라우저
콜백은 관측 실패를 표현할 수 없고, wrapper의 catch만 그 값을 만든다.

이동은 안전하다. 현재 inline 콜백(`chatgpt.mjs:561-574`)은 Node 쪽 클로저를
참조하지 않는다. `document`와 `Node`는 페이지 전역이고 `roleOf`는 함수 내부
지역 선언이다. selectors를 인자로 받으면 `resolveTopLevelAssistantTurns`
(`chatgpt-response-dom.mjs:95`)와 같은 패턴이 된다.

consumer 테스트는 **probe 호출 횟수도 assert**한다. 다음 세 mutation이 각각
RED가 되어야 한다.

1. ordering 게이트 호출 자체를 삭제
2. `'unknown'`을 `'ordered'`로 치환
3. `orderingOk` conjunct를 삭제

`test/unit/web-ai-chatgpt-response-fragments.test.mjs:241-249`의 source-string
계약도 갱신 대상이다 — `activity.strength === 'strong'` 등 세 줄을 문자열로
검사하므로 `weakActive` 조건이 바뀌면 함께 고쳐야 한다.

`test/integration/activity-state-transport.test.mjs:43-68`의 **기존 activity
행은 변경 불필요하다.** DOM 리더는 `'unknown'`을 만들지 않으며, 그 사실 자체가
"unknown은 관측 실패 전용"이라는 계약의 검증이다. 다만 같은 파일에
`readAssistantTurnOrderingInPage`의 transport 행을 **추가**한다 — 위 producer 층이
거기 산다.

## 신규 테스트 (C5 담당분)

| # | 시나리오 | 관측 |
| --- | --- | --- |
| T1 | activity evaluate가 throw | `strength: 'unknown'`, 이미지 shortcut 미진입 |
| T2 | activity evaluate가 malformed 반환 | `'unknown'`, `'none'`과 구분 |
| T3 | unknown + **`finished: true`** + 안정 텍스트 | 2초 예산에서 미완료, 6초 이상에서 완료 — 5초 window를 실제로 대조 |
| T4 | unknown이 한 번이라도 발생 | `warnings`에 `activity-read-unverified` |
| T5 | 정상 quiet | `'none'` 유지, 기존 동작 회귀 없음 |
| T6 | ordering evaluate가 throw | `'unknown'` → 완료 미확정, 데드라인까지 재시도 |
| T7 | ordering이 stale | stable state 초기화 + pacing 실행 + complete 금지 |
| T8 | user turn 없음 | `'unverifiable'` → 통과 (정상 케이스 회귀 방지) |
| T9 | T6 상태로 데드라인 도달 | status `timeout`, warnings에 `assistant-ordering-unverified` |
| T10 | `{strength:'bogus'}` 반환 | `'unknown'`으로 정규화 |
| T11 | unknown/stale tick | `waitForTimeout` 호출 횟수 증가 + 가상시간 전진, 최종 `timeout` |
| T12a | post-deadline `outputImage` + image chrome + unknown | `complete`/`'Edit'` **금지**, deferred 또는 timeout + `activity-read-unverified` |
| T12b | **pre-deadline** `'none'` + 수집 성공 | `generated-image` complete 정상 반환 (false positive 방지) |
| T12c | post-deadline `outputImage` + image chrome + `'none'` | `complete`/`'Edit'` **금지** — activity quiet은 수집 증거가 아니다 |
| T12d | **no-session** copy + `outputImage` + image chrome | `complete`/`'Edit'` **금지** — recovery가 돌지 않는 경로 |
| T12e | `outputImage` **없음** + copy raw가 `'Thought for 2s Edit'` | clean 후 `'Edit'`가 image chrome으로 분류돼도 완료를 **차단하지 않는다** — 분류는 관측 전용 |
| T12f | `outputImage` + copy가 substantive markdown + 파일 미저장 | complete **금지** — 명시적 artifact 계약 |
| T12g | `outputImage` + session recovery가 substantive text + 파일 미저장 | complete **금지** — recovery도 같은 계약 |
| T13 | 루프에서 unknown 후 정상 complete | `warnings`에 `activity-read-unverified` 보존 |
| T14a | session recovery 경로에서 처음 unknown | 그 반환에 warning이 실린다 |
| T14b | session 없는 copy 경로에서 처음 unknown | 별도 테스트 — recovery가 먼저 반환하면 copy는 실행되지 않는다 |
| T15 | ordering unknown 후 회복되어 complete | 답은 정상 반환되고 warning만 남는다 |
| T16 | unknown 기록 후 다음 tick에 target mismatch | mismatch 반환에도 warning이 보존된다 |
| T17 | complete 반환 | `warnings`와 `answerArtifact.warnings`가 일치 |
| T18 | deferred 반환 | 반환 warnings와 저장된 session warnings가 일치 |
| T19 | finalizer 호출 | 전달된 warnings에 ledger 항목이 포함 |

T5·T8·T12b가 중요하다. fail-closed를 과하게 적용해 정상 경로를 막으면 그것도
결함이다. T11·T12a·T12c·T16은 감사가 찾은 회귀를 고정하고, T17~T19는 warning이
반환값 밖 세 지점으로 새는 것을 막는다.

T3는 `finished: true`여야 의미가 있다. 종결 증거가 없으면 `finished` conjunct
때문에 어차피 완료되지 않아, `weakActive`에서 unknown을 지워도 테스트가
green이다.

## 검증 명령의 한계

`npm run typecheck`는 `tsconfig.json:33`에서 `.mjs`를 **제외**한다. 이
work-phase의 변경은 전부 `.mjs`이므로 **typecheck는 이 변경을 전혀 검사하지
않는다.** exit 0을 근거로 삼으면 안 된다.

`npm run typecheck:checkjs-dom`은 대상 파일을 읽지만 기존 오류로 exit 2라
깨끗한 회귀 게이트가 아니다.

실질 게이트는 vitest 동작 테스트와 위 mutation proof다. 이 사실을 D의 증거
기록에 명시한다.

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `web-ai/chatgpt-response-dom.mjs` | typedef에 `'unknown'` 추가(`:136`), `isActiveState`가 unknown을 false로(`:258-260`), `readAssistantTurnOrderingInPage`와 `CHATGPT_TURN_SELECTORS` 신규 export |
| `web-ai/chatgpt.mjs` | `readActivityState` sentinel 분리 + 화이트리스트 정규화(`:1030-1053`), `weakActive`(`:683`), ordering wrapper 개명·열거화(`:560-575`), 호출부를 `orderingOk` conjunct로(`:721-723`), post-deadline `outputImage` complete 금지를 recovery(`:897-912`)·copy(`:960-984`) 공통 불변식으로 (텍스트 내용과 무관), observation ledger + `mergeObservationWarnings`를 artifact/deferred/finalizer 세 지점에 적용 |
| `test/unit/web-ai-chatgpt-activity-poll.test.mjs` | T1~T5, T10·T11·T13·T15·T16 |
| `test/unit/web-ai-provider-session.test.mjs` | T6·T9·T12a~T12g·T14a·T14b·T17~T19, fixture ordering 모델링 |
| `test/integration/web-ai-fake-chatgpt.test.mjs` | fixture ordering 모델링, T7·T8 |
| `test/integration/web-ai-golden-scenario.test.mjs` | fixture ordering 모델링 |
| `test/integration/activity-state-transport.test.mjs` | `readAssistantTurnOrderingInPage` producer의 실제 DOM 검증 추가 (`CHATGPT_TURN_SELECTORS` 공유) |
| `test/unit/web-ai-chatgpt-response-fragments.test.mjs` | source-string 계약 갱신(`:241-249`) |

`chatgpt.mjs` 소스 문자열을 읽는 테스트 10개 중 이 둘의 본문을 검사하는 것은
없다. 영향은 `response-fragments`의 strength 소비 계약 세 줄뿐이다.

## 이 work-phase가 닫는 것과 닫지 않는 것

### 실행 결과 (2026-07-31)

커밋 셋으로 완료했다.

| 커밋 | 내용 |
| --- | --- |
| `6742949` | 소스 교정 — 이 문서의 처방 |
| `45aa702` | 테스트가 결함을 실제로 잡도록 보강 |
| `21e229c` | copy 경로 격리와 경로별 관측 기록 분리 |

**구현 중 처방에 없던 것 하나를 추가했다.** post-deadline recovery의 ordering
게이트다. 테스트를 쓰다 발견했다 — 루프가 예산 내내 stale 답을 거부하고 나면
recovery가 그 **같은 텍스트를 `complete`로 돌려준다.** 루프의 거부가 장식이
되는 것이라 recovery에도 같은 게이트를 걸었다.

copy 경로의 `isStreaming(page)`도 `readActivityState` 직접 호출로 폈다. 호출
횟수는 같고(내부에서 하던 read를 꺼낸 것), structured verdict가 보존돼 ledger에
기록된다.

#### 감사가 잡은 것 — 테스트가 통과하는 이유가 틀렸다

구현 감사 3라운드에서 blocker 4건이 나왔다. 전부 "테스트가 GREEN인데 보호하지
않는다"는 종류였다.

| # | 증상 | 원인 |
| --- | --- | --- |
| 1 | output-image 불변식 삭제해도 GREEN | 테스트가 `turnOrdering:'stale'`로 루프를 막았는데, 그게 recovery ordering 게이트까지 막아 불변식 없이도 deferred가 됐다 |
| 2 | copy 불변식에 테스트 없음 | no-session copy는 recovery가 안 도는 유일한 경로인데 누락 |
| 3 | "no-session" 테스트가 실은 session-bound | `findActiveSession`이 앞선 테스트가 남긴 active session을 채간다(`session.mjs:312`) |
| 4 | recovery/copy의 `recordActivityObservation` 삭제해도 GREEN | 루프 첫 tick부터 read가 실패해 ledger가 이미 차 있었다 |

3번이 특히 교훈이다. 테스트 간 상태 누수가 "이 경로를 테스트한다"는 전제를
통째로 무효화했다. 지금은 active session을 내리고 baseline을 심고
`sessionId === undefined`를 assert한다.

타이밍도 한 칸 차이로 갈렸다. `offset >= 2000`이면 마지막 in-budget tick에서
quiet으로 바뀌어 창이 1초로 떨어지고 루프가 먼저 완료된다. `> 2000`이어야
데드라인 이후에만 전환된다.

#### mutation proof

넷을 각각 되돌려 정확히 RED가 되는 것을 확인했다(복원 후 `web-ai/`가
`6742949`와 byte-identical임을 매번 확인).

| mutation | 결과 |
| --- | --- |
| recovery `!imageOutputUnsatisfied` 삭제 | RED |
| copy `\|\| input.outputImage !== undefined` 삭제 | RED |
| recovery `recordActivityObservation` 삭제 | RED |
| copy `recordActivityObservation` 삭제 | RED |

#### 검증

```
npx vitest run test/unit test/integration
  Test Files 179 passed (179); Tests 1972 passed (1972)
npm run gate:all              All 16 gate(s) passed
npm run typecheck             exit 0   (.mjs 미대상 — 위 "검증 명령의 한계")
bash structure/check-doc-drift.sh   164 passed
bash structure/verify-counts.sh      76 passed
```

producer는 실제 Chromium에서 검증했다 — `activity-state-transport` 12/12,
ordered/stale/unverifiable 세 판정과 "unknown은 producer가 만들지 않는다"까지.

닫는 것: `021` §3 fail-open 여섯 중 **둘**(B03·B06). c7의 "fail-open B03·B06이
fail-closed로 교정된다" 절반.

닫지 않는 것: c7의 나머지 — 배정 경계 15개의 데드라인 인지. 그건 예산 계약이
필요하고 G1~G4에 묶여 있다. **이 work-phase만으로 c7을 met으로 적지 않는다.**

자매 유닛의 B23·B24·B25·B36은 별도 work-phase다.
