# 021 — `pollWebAi` 정체 경계 지도 (WP3 산출물)

명세는 `020_wp3_stall_boundary_inventory.md`. 이 문서는 그 7개 절을 채운 결과다.
코드 변경 없음.

- 기준: `dev` @ `76e4793`
- 대상: `pollWebAi`(`web-ai/chatgpt.mjs:582`–`:1020`)

## 1절 — 경계 전수

### 조사 명령

```
awk 'NR>=582 && NR<=1025' web-ai/chatgpt.mjs \
  | grep -oE "(await )?[a-zA-Z_][a-zA-Z0-9_]*\(" | sed 's/await //' | sort -u
rg -n "page\.evaluate|locator\(|\.all\(\)|isVisible\(|innerText\(" web-ai/chatgpt.mjs
rg -n "page\.evaluate|locator\(|cdpSession\.send" web-ai/chatgpt-response-dom.mjs \
   web-ai/chatgpt-response-observer.mjs web-ai/failure-diagnostics.mjs \
   web-ai/copy-markdown.mjs web-ai/chatgpt-images.mjs web-ai/chatgpt-files.mjs
```

`await` 표현식만이 아니라 **모든 call expression**을 뽑았다. 동기 호출이
`session-store`의 락과 파일 쓰기로 이어지기 때문이다.

### 시간 구간

데드라인은 `web-ai/chatgpt.mjs:617`에서 생성된다. 그 앞은 예산 자체가 없다.

| 구간 | 범위 |
| --- | --- |
| `pre-budget` | 함수 진입 ~ `:617` |
| `in-budget` | 루프 `:631`~`:862` |
| `post-budget` | 루프 종료 후 ~ 반환 |

### 경계표

| ID | 위치(정의 / blocking) | 종류 | 호출 사슬 | 구간 | 도달 조건 |
| --- | --- | --- | --- | --- | --- |
| B01 | `chatgpt.mjs:1439`(정의) / `:1441`,`:1442` | Page.evaluate | `readAssistantSnapshots` ← split 실패 fallback | in | split `ok:false` |
| B02 | `chatgpt.mjs:1464`(정의) / `:1469` | Page.evaluate | `readAssistantSnapshotsSplit` ← 루프 `:658` | in | 항상 |
| B03 | `chatgpt.mjs:1030`(정의) / `:1038` | Page.evaluate | `readActivityState` ← 루프 `:677` | in | stop-button probe 실패 시 |
| B04 | `chatgpt-response-dom.mjs:30`(정의) / `:36`,`:39`,`:48`,`:53`,`:58` | Locator | `anyStopButtonVisible` ← `readActivityState:1035` | in | 항상 |
| B05 | `chatgpt.mjs:1068`(정의) / `:1070` | Page.evaluate | `isResponseFinished` ← 루프 `:713`, recovery `:873`, copy `:943` | in·post | 항상 |
| B06 | `chatgpt.mjs:560`(정의) / `:563` | Page.evaluate | `doesAssistantFollowUser` ← 루프 `:722` | in | wrapperless 아닌 후보 |
| B07 | `chatgpt-response-dom.mjs:413`(정의) / `:415`,`:420`,`:428` | Locator | `readTopLevelAssistantTextsFromLocators` ← `chatgpt.mjs:1431` | in | evaluate 실패 시 |
| B08 | `chatgpt-response-observer.mjs:78`(정의) / `:81` | Page.evaluate | `observeAssistantResponse` ← `:629` | in | 항상 — **bounded**(`timeoutMs`) |
| B09 | `chatgpt-response-observer.mjs:98`(정의) / `:103`,`:104` | Page.evaluate | `recoverAssistantResponse` ← `:868` | post | 세션 폴 |
| B10 | `failure-diagnostics.mjs:27`(정의) / `:29` | Page.evaluate | `captureFailureDiagnostics` ← `:919` | post | `diagnostics` 옵션 |
| B11 | `copy-markdown.mjs:68`(정의) / `:71` | Page.evaluate | `captureCopiedResponseText` ← 루프 `:738`, post `:962` | in·post | `allowCopyMarkdownFallback` |
| B12 | `chatgpt.mjs:1308`(정의) | 외부 위임 | `resolveOptionalChatGptCopyTarget` ← `:737`, `:961` → `target-resolver.mjs` → `self-heal.mjs:222` | in·post | `allowCopyMarkdownFallback` |
| B13 | `self-heal.mjs:222` | Locator | B12 하위 — `page.locator(sel).count()` | in·post | B12와 동일 |
| B14 | `chatgpt-images.mjs:226`,`:241`,`:257` | CDP + fetch | `collectImages` ← 루프 `:762`, `collectGeneratedImageAnswer:1501` | in | 이미지 응답 |
| B15 | `chatgpt-files.mjs:321`,`:347` | CDP | `saveAssistantDownloadableFiles` ← 루프 `:800` | in | 다운로드 가능 파일 |
| B16 | `chatgpt-archive.mjs:84-105` | Locator/click | `finalizeProviderTab` ← `:698`,`:812`,`:899`,`:970` → `tab-finalizer.mjs:95` | in·post | `archiveFlag` |
| B17 | `tab-lease-store.mjs:391`,`:630` → `skills/browser/tab-manager.mjs:305` | CDP | `finalizeProviderTab` → `poolTab`(`tab-pool.mjs:51`, await 없는 반환) → lease overflow → `closeTab` | in·post | lease 초과 |
| B18 | `session-store.mjs:136`(정의) / `:142`,`:144`,`:161` | sync-IO/lock | `markSessionTimeout`(`:986`,`:1006`) → `session.mjs:251` → `patchSession`(`session-store.mjs:337`) → `withStoreLock` | post | 세션 폴 |
| B19 | `session-store.mjs:136` 동일 | sync-IO/lock | `updateSession`(`session.mjs:230`) → `patchSession` → `withStoreLock` | in·post | 세션 폴 |
| B20 | `chatgpt.mjs:1386`(정의) | sync-IO | `persistResolverTraceForSession` ← `:741`, `:965` | in·post | `allowCopyMarkdownFallback` |
| B21 | `chatgpt.mjs:594` | Page(간접) | `requireChatGptPage` | **pre** | 항상 |
| B22 | `session.mjs:161`,`:172` | sync-IO | baseline store `readFileSync`/`writeFileSync` ← `getBaseline`/`getLatestBaseline`(`:604-606`) | **pre** | 항상 |

### 폐쇄 증명

`pollWebAi` 본문의 call expression 전체를 분류했다. 방문 함수와 그 처분:

**말단 — 순수 계산(더 파지 않음).** `Date.now`, `Math.max/min/round`, `Number`,
`Array.prototype.{push,map,sort,slice,join,at,filter}`, `extractConversationId`,
`cleanAssistantText`, `preferCopiedText`, `isFinalAnswer`,
`isImageOnlyGeneratedImageChromeText`, `sessionToBaseline`(`session.mjs:533`),
`resolveTimeoutBudgetSec`(`session.mjs:485`), `isPageDeathError`
(`interstitial.mjs:206`), `withAnswerArtifact`(`answer-artifact.mjs:91`),
`buildDeferredPollingResult`(`chatgpt.mjs:1528`), `WebAiError` 생성자.

**말단 — native primitive(더 내려갈 JS callee 없음).** `readFileSync`,
`writeFileSync`, `openSync`, `closeSync`, `unlinkSync`, `mkdirSync`,
`process.stderr.write`, `page.url()`, `page.waitForTimeout()`.
이들은 재귀를 멈추되 **deadline-unaware 경계로 기록**했다(B18~B20, B22).

**경계로 기록.** 위 표 B01~B22.

**bounded로 판정하고 끊음.** B08만 해당한다 — `observeAssistantResponse`는
`timeoutMs` 예산을 받고(`chatgpt.mjs:627-630`) `Promise.race`로 소비된다(`:838-844`).
횟수·시간 둘 다 bounded다.

`withStoreLock`(`session-store.mjs:136`)은 **bounded가 아니다.**
`LOCK_RETRY_LIMIT = 200`은 EEXIST 재시도 *횟수*만 제한하고(`:48`, `:164`), 각
반복의 `openSync`/`writeFileSync`와 callback `fn()`에는 시간 상한이 없다. 그래서
B18/B19로 기록했다.

목록에 없는 callee는 없다.

## 2절 — 방어 가능성 판정

| 종류 | 제한 방법 | 근거 |
| --- | --- | --- |
| Page.evaluate | 옵션 없음 → **외부 race 필요** | Playwright `page.evaluate`에 timeout 파라미터가 없다 |
| Locator `.all()`/`.count()` | 옵션 없음 → **외부 race 필요** | `locator.all()`이 timeout 없는 `count()`를 호출(`node_modules/playwright-core/lib/client/locator.js:280`, `lib/client/frame.js:213`) |
| Locator `.isVisible({timeout})` | timeout 무시됨 | `node_modules/playwright-core/types/types.d.ts:14191` |
| Locator `.innerText({timeout})` | 옵션 유효 | 기존 코드가 이미 `timeout: 500`을 쓴다 |
| CDP `session.send()` | 옵션 없음 → **외부 race 필요** | `CDPSession.send`에 timeout 옵션 없음(`types.d.ts:15882`) |
| `fetch` | `AbortController`로 제한 가능 | `chatgpt-files.mjs:364-382`가 이미 적용 |
| sync-IO/lock | **동기라 race 불가** | 호출 전 조건 검사나 비동기 재작성이 필요 |

마지막 행이 중요하다. B18~B20, B22는 동기 실행이라 `Promise.race`로 감쌀 수
없다. 이 경계는 "데드라인 인지"가 아니라 **다른 처방**이 필요하다 — 락 획득에
시간 상한을 두거나, 비동기 API로 옮기거나, 호출 자체를 조건부로 만들거나.

판정 요약: 무한 정체 가능 B01~B07, B09~B20, B22 / bounded B08.

## 3절 — sentinel 소비자

예산 초과 신호를 "정상 값"으로 오해하면 안 되는 지점과 현재 기본값이다.

| 경계 | 소비 지점 | 현재 기본값 | 정체 시 위험 |
| --- | --- | --- | --- |
| B02 | `chatgpt.mjs:658`, `countAssistantMessages:1394` | `{ok:false}` → legacy fallback | 이미 정체된 페이지에 두 번째 무한 읽기(B01) |
| B01 | `readAssistantMessages:1428` | `[]` | 빈 읽기와 구별 불가 |
| B03 | 루프 `:682-683` | catch → `{strength:'none'}`(`:1052`) | `'none'`은 quiet으로 읽혀 완료 분기(`:713-731`)로 간다 — **정체가 조용한 완료로 위장** |
| B04 | `readActivityState:1035` | catch → 다음 probe | 상대적으로 안전 |
| B05 | 루프 `:713`, recovery `:873`, copy `:943` | catch → `{finished:false}` | 안전한 방향 |
| B06 | 루프 `:722` | `result !== false` → `true` | **정체가 "순서 정상"으로 통과** |
| B07 | `:1431` | `[]` | 빈 읽기와 구별 불가 |
| B09 | `:868` | `null` | 안전한 방향 |
| B10 | `:919` | fire-and-forget | 반환값 없음, 그러나 await한다 |
| B11 | `:738`, `:962` | `null`/빈 결과 | 안전한 방향 |
| B12·B13 | `:737`, `:961` | `null` | 안전한 방향 |
| B14·B15 | `:762`, `:800` | 빈 배열 | 안전한 방향 |
| B16·B17 | `:698`,`:812`,`:899`,`:970` | 예외 삼킴 | 반환 지연이 곧 명령 지연 |
| B18~B20·B22 | 반환 직전 | 없음(동기) | 반환 자체가 막힘 |
| B21 | `:594` | throw | pre-budget이라 `--timeout` 밖 |

B03과 B06이 가장 위험하다. 정체가 **틀린 결론**으로 이어진다 — 나머지는 지연만
만든다.

## 4절 — 종료 경로

`return`·`throw`·rejection·세션 상태 변경을 모두 센다.

| 위치 | 종류 | warning 부착 가능 |
| --- | --- | --- |
| `:705` | image 성공 반환 | 가능 |
| `:814-826` | 주 성공 반환 | 가능(`warnings` `:732-733` 초기화) |
| `:851-858` | 탭 크래시 반환 | 가능 |
| `:879`, `:901` | recovery 반환 | 가능 |
| `:927` | copy deferred 반환 | 가능 |
| `:989-1004` | copy 타임아웃 반환 | 가능(기존 warning 있음) |
| `:1006-1022` | 최종 타임아웃 반환 | 가능(`warnings: []`) |
| `:860` | rethrow(`throw pollErr`, `isPageDeathError` 아닌 경우) | **불가** — 예외 경로 |
| `:986`, `:1006` | `markSessionTimeout` 세션 변경 | 부수효과 |
| `:594` | `requireChatGptPage` throw | pre-budget |

`:860` rethrow는 warning을 실을 자리가 없다. 정체 흔적을 남기려면 세션에 기록하는
수밖에 없다.

## 5절 — 기존 테스트 계약 영향

`rg -n "readFileSync.*chatgpt|readFileSync.*web-ai" test/` 결과, 소스 문자열을
검사하는 테스트가 셋이다.

| 파일 | 고정하는 것 |
| --- | --- |
| `test/unit/web-ai-wrapperless-correlation.test.mjs:119-137` | `countAssistantMessages` 본문에 `if (split.ok) return split.wrapped.length;`, 루프의 `const wrapped = split.ok` |
| `test/unit/web-ai-chatgpt-model.test.mjs:5` | `chatgpt-model.mjs` 소스 상수 |
| `test/unit/web-ai-chatgpt-activity-poll.test.mjs` | 가상 시계 하네스(문자열 검사 아님, 그러나 `page.evaluate` 분기 형태에 의존) |

첫째가 직접 영향을 받는다. `countAssistantMessages` 반환 계약을 바꾸면 이
어서션을 함께 갱신해야 한다 — 불변식("legacy fallback은 성공한 빈 읽기가 아니라
실패한 획득에서만")은 유지하고 표현만 바꾼다.

## 6절 — 테스트 하네스 제약

`test/unit/web-ai-chatgpt-activity-poll.test.mjs:14-69`가 `pollWebAi`를 실제로
구동하는 유일한 하네스다. `Date.now`를 mock하고 offset은 `page.waitForTimeout`
에서만 전진한다.

실제 `setTimeout` 기반 예산과 이 mocked clock을 섞으면 "두 번째 읽기는 남은
시간만 받는다"는 계약을 검증할 수 없다 — 실제 시간이 흘러도 `Date.now`가 멈춰
있기 때문이다.

**판정: 시계와 타이머를 함께 주입한다.** vitest fake timer(`vi.useFakeTimers`)를
쓰면 `Date.now`와 `setTimeout`이 같은 가상 시간을 공유한다. 기존 하네스의 수동
offset 방식을 fake timer로 옮기는 것이 후속 유닛의 첫 작업 중 하나다.

## 7절 — 후속 유닛 배정

### 유닛 A — `webai_poll_deadline` (#88 원래 범위)

답변 읽기와 완료 판정 경로. 정체가 **틀린 결론**을 만드는 경계가 여기 있다.

담당: B01, B02, B03, B04, B05, B06, B07, B09, B10, B11, B12, B13

work-phase 분할(의존 순서):

1. 예산 프리미티브 + sentinel 계약 + fake timer 하네스 — 이후 전부의 토대
2. 데드라인 안 읽기 경로(B01, B02, B07) + `countAssistantMessages` 계약과
   소스-텍스트 테스트 갱신
3. 완료 판정 경로(B03, B04, B05, B06) — 3절이 지목한 위험 둘이 여기
4. 데드라인 후 경로(B09, B10, B11, B12, B13)
5. warning 전파(4절의 모든 반환 경로) + 활성화 관측

수용 기준: 담당 경계 전부가 데드라인을 인지하고, 각 정체 경로의 발화가
관측된다(C-ACTIVATION-GROUNDING-01). 일부만으로는 충족 아님.

### 유닛 B — `webai_artifact_finalizer`

아티팩트 수집과 탭 수명주기. CDP와 동기 IO가 여기 모인다.

담당: B14, B15, B16, B17, B18, B19, B20, B21, B22

work-phase 분할(의존 순서):

1. CDP 예산 규약 — `CDPSession.send`에 timeout이 없으므로 공통 래퍼가 먼저
2. 아티팩트 다운로드(B14, B15)
3. 탭 lease와 finalizer(B16, B17)
4. 동기 IO 경계(B18, B19, B20, B22) — 2절 판정대로 race가 불가하므로 다른
   처방이 필요하다. 이 work-phase의 P가 그 설계를 정한다
5. pre-budget 구간(B21) — `--timeout` 시작 전 정체를 어떻게 다룰지 결정

수용 기준: 담당 경계 전부가 데드라인을 인지하거나 bounded임이 증명된다.

### 배정 대조

B01~B22 중 B08만 배정되지 않았다. 사유: 이미 bounded(`timeoutMs` 예산 + race).
나머지 21개는 모두 두 유닛 중 하나에 있다. 배정 없이 남긴 경계는 없다.

### 문서 번호

두 유닛은 각각 새 폴더(`devlog/_plan/YYMMDD_webai_poll_deadline/`,
`devlog/_plan/YYMMDD_webai_artifact_finalizer/`)를 갖는다. 각 유닛의 decade
문서는 그 유닛의 docs-first 사이클에서 쓴다. 이 유닛의 `022`, `023`을 쓰지
않으므로 `030`과의 번호 충돌은 발생하지 않는다.

## 이 지도가 틀렸다는 것을 보여줄 증거

구현 중 여기 없는 경계가 나오면 폐쇄 규칙이 부족했다는 뜻이다. 그때는 규칙을
고치고 이 문서를 개정한다 — 목록을 조용히 늘리지 않는다.

특히 취약한 가정 둘:

- `finalizeProviderTab` 하위를 `tab-manager.mjs:305`에서 끊었다. 그 아래
  CDP 호출이 더 있으면 B17이 여러 개로 쪼개진다.
- `resolveOptionalChatGptCopyTarget` 경로를 `self-heal.mjs:222`까지만 따라갔다.
