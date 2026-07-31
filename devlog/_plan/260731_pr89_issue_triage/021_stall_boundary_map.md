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
| B22 | `session.mjs:156`(정의) / `:161` | sync-IO | baseline store `readFileSync` ← `getBaseline`/`getLatestBaseline`(`chatgpt.mjs:604-605`) | **pre** | 세션 baseline 부재 시에만(`:603`에서 short-circuit) |
| B23 | `session.mjs:295`(정의) / `session-store.mjs:116`,`:352` | sync-IO/lock | `getSession`(`chatgpt.mjs:597`)·`findActiveSession`(`:598-601`) → store read | **pre** | 항상 |
| B24 | `skills/browser/browser.mjs:1056`(정의) / `:1057`,`:1059`,`:1062` | CDP | `deps.getTargetId`(`chatgpt.mjs:600`, `:634`) → `newCDPSession` + `Target.getTargetInfo` + `detach` | pre·in | 일반 browser deps |
| B25 | `chatgpt.mjs:751`, `:797` | CDP | `deps.getCdpSession` — 이미지/파일 수집 전 세션 취득 | in | 이미지·파일 응답 |
| B26 | `chatgpt.mjs:1528`(정의) / `:1529`,`:1530` | sync-IO/lock | `buildDeferredPollingResult` → `getSession`+`updateSession` → `patchSession` → `withStoreLock` | in·post | deferred 반환 4곳(`:879`,`:889`,`:927`,`:947`) |
| B27 | `chatgpt.mjs:688` | sync-IO | `process.stderr.write` 하트비트 | in | streaming 또는 latest 존재 |
| B28 | `failure-diagnostics.mjs:57`(정의) / `:60`,`:66`,`:70` | CDP + sync-IO | `captureFailureDiagnostics` 하위 — CDP 취득, `Page.captureScreenshot`, `detach`, artifact 쓰기(`session-artifacts.mjs:265-305`) | post | `diagnostics` 옵션 |
| B29 | `self-heal.mjs:298`(정의) / `:307`,`:311`,`:338` | Locator | B12 하위 — `isEnabled`/`isEditable`/`locator.evaluate` | in·post | `allowCopyMarkdownFallback` |
| B30 | `chatgpt-images.mjs:139`(정의) / `:140` | CDP | 이미지 탐지 `Runtime.evaluate` — B14보다 앞선다 | in | 이미지 응답 |
| B31 | `chatgpt-images.mjs:257`-`:273`, `session-artifacts.mjs:157`,`:314` | sync-IO/lock | 이미지 저장 `mkdirSync`/`writeFileSync` + artifact 기록 | in | 이미지 응답 |
| B32 | `chatgpt-files.mjs:433`-`:444`, `session-artifacts.mjs:219`,`:314` | sync-IO/lock | 파일 저장 + artifact 기록 | in | 다운로드 가능 파일 |
| B33 | `tab-finalizer.mjs:64`-`:86` | sync-IO/lock | finalizer의 session update·transcript write·artifact record | in·post | 항상(세션 폴) |
| B34 | `tab-lease-store.mjs:179`-`:208`, `:367`-`:391` | sync-IO/lock | lease 락과 동기 파일 IO — B17 하위 | in·post | lease 조작 |

### 폐쇄 증명

`pollWebAi` 본문의 call expression 전체를 분류했다. 방문 함수와 그 처분:

**말단 — 순수 계산(더 파지 않음).** `Date.now`, `Math.max/min/round`, `Number`,
`Array.prototype.{push,map,sort,slice,join,at,filter}`, `extractConversationId`,
`cleanAssistantText`, `preferCopiedText`, `isFinalAnswer`,
`isImageOnlyGeneratedImageChromeText`, `sessionToBaseline`(`session.mjs:533`),
`resolveTimeoutBudgetSec`(`session.mjs:485`), `isPageDeathError`
(`tab-recovery.mjs:211` — `chatgpt.mjs:49`에서 import한다. 동명 함수가
`interstitial.mjs:206`에도 있으나 실제 callee가 아니다),
`withAnswerArtifact`(`answer-artifact.mjs:91`), `createTraceContext`,
`buildTargetMismatchResult`, `diagnosticsEnabled`, `WebAiError` 생성자.

`buildDeferredPollingResult`는 **순수 계산이 아니다.** 이름과 달리 `getSession`과
`updateSession`을 호출해(`chatgpt.mjs:1529-1530`) 세션 스토어 락에 도달한다.
B26으로 기록했다.

**말단 — native primitive(더 내려갈 JS callee 없음).** `readFileSync`,
`writeFileSync`, `openSync`, `closeSync`, `unlinkSync`, `mkdirSync`,
`process.stderr.write`, `page.url()`, `page.waitForTimeout()`.
이들은 재귀를 멈추되 **deadline-unaware 경계로 기록**했다(B18~B20, B22).

**경계로 기록.** 위 표 B01~B22.

**bounded로 판정하고 끊음: 없다.**

처음에는 B08(`observeAssistantResponse`)을 bounded로 봤으나 틀렸다. 그 `timeoutMs`는
**페이지 안에서 도는 `setTimeout`**이고(`chatgpt-response-observer.mjs:38-68`),
signal이 없으면 evaluate Promise를 그대로 await한다(`:78-84`). 렌더러가 멈추면
그 타이머도 함께 멈추므로 wall-time 상한이 아니다.

정확한 판정은 이것이다: **호출자의 소비는 bounded, 하위 Promise는 unbounded이며
취소되지 않는다.** 루프는 매 tick `page.waitForTimeout(500)`과 race하므로
(`chatgpt.mjs:838-844`) 루프 자체는 막히지 않지만, 패배한 evaluate는 살아남아
누적된다. B08도 경계다.

`withStoreLock`(`session-store.mjs:136`)도 **bounded가 아니다.**
`LOCK_RETRY_LIMIT = 200`은 EEXIST 재시도 *횟수*만 제한하고(`:48`, `:164`), 각
반복의 `openSync`/`writeFileSync`와 callback `fn()`에는 시간 상한이 없다.

**`deps.*` 주입 경계.** `deps.getTargetId`와 `deps.getCdpSession`은 호출부만 보면
불투명하지만, 일반 browser deps에서는 CDP 세션을 새로 열고 `Target.getTargetInfo`를
보낸 뒤 detach한다(`skills/browser/browser.mjs:1056-1063`). B24·B25로 기록했다.
주입 지점이라 구현이 바뀔 수 있으므로, 후속 유닛은 "deps가 무엇을 하든 예산 안"이
되도록 호출부에서 감싸야 한다.

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
| B03 | 루프 `:682-683`, recovery `:868-873`, copy `:923` | catch → `{strength:'none'}`(`:1052`) | `'none'`은 quiet으로 읽혀 완료 분기(`:713-731`)로 간다 — **정체가 조용한 완료로 위장** |
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
| B08 | `:838-844` `Promise.race` | 패배한 evaluate가 취소 없이 잔존 | 누적 시 리소스 압박 — 루프 자체는 막지 않는다 |
| B24 | `:600`, `:634` | `.catch(() => null)` → `null` | **targetId가 null이면 mismatch 검사를 건너뛴다**(`:634-635`) — 다른 대화의 답을 읽을 수 있다 |
| B25 | `:751`, `:797` | `?.()` → `undefined` | **파일/이미지 수집을 조용히 건너뛰고 성공 finalization을 계속한다**(`:797-812`) |
| B23 | `:597-601` | 빈 세션 → legacy baseline | 세션 조회가 비면 오래된 baseline으로 진행할 수 있다 |
| B26 | `:879`,`:889`,`:927`,`:947` | 없음(동기) | 반환 자체가 막힌다 |
| B27~B34 | 각 호출부 | 없음(동기) 또는 예외 삼킴 | 반환 지연 |

**틀린 결론을 만드는 경계는 넷이다:** B03(정체 → 조용한 완료), B06(정체 → 순서
검증 통과), B24(null → mismatch 검사 생략), B25(undefined → 아티팩트 누락한 채
성공). B23도 오래된 baseline으로 진행할 수 있다. 나머지는 지연만 만든다.

넷의 공통 형태는 **fail-open**이다 — 실패를 "문제 없음"으로 해석한다. 후속 유닛의
첫 설계 원칙은 이것을 fail-closed로 뒤집는 것이다.

## 4절 — 종료 경로

`return`·`throw`·rejection·세션 상태 변경을 모두 센다.

| 위치 | 종류 | 도달 가능 경계 | warning 부착 가능 |
| --- | --- | --- | --- |
| `:606-612` | baseline 없음 throw | B22, B23 | **불가** — 예외 |
| `:636-644` | target mismatch 반환 | B24 | 가능 |
| `:649-655` | conversation mismatch 반환 | — | 가능 |
| `:705` | image 성공 반환 | B14, B25, B30, B31, B16, B33 | 가능 |
| `:814-826` | 주 성공 반환 | B01~B07, B11~B15, B25, B27, B30~B34 | 가능(`warnings` `:732-733` 초기화) |
| `:851-858` | 탭 크래시 반환 | 모든 in-budget 경계 | 가능 |
| `:879`, `:889-895` | recovery deferred 반환 | B09, B26 | 가능 |
| `:901` | recovery 성공 반환 | B09, B05, B16, B33 | 가능 |
| `:927`, `:947-953` | copy deferred 반환 | B11, B12, B29, B26 | 가능 |
| `:989-1004` | copy 타임아웃 반환 | B11, B12, B29, B18 | 가능(기존 warning 있음) |
| `:1006-1022` | 최종 타임아웃 반환 | 모든 경계 | 가능(`warnings: []`) |
| `:860` | rethrow(`throw pollErr`) | 모든 in-budget 경계 | **불가** — 예외 경로 |
| `:899`, `:970` | `finalizeProviderTab` rejection | B16, B17, B33, B34 | **불가** — 예외 전파 |
| `:986`, `:1006` | `markSessionTimeout` 세션 변경 | B18 | 부수효과 |
| `:594` | `requireChatGptPage` throw | B21 | pre-budget |

`:860` rethrow는 warning을 실을 자리가 없다. 정체 흔적을 남기려면 세션에 기록하는
수밖에 없다.

## 5절 — 기존 테스트 계약 영향

`rg -ln "readFileSync.*chatgpt" test/` 결과, `chatgpt.mjs` 소스 문자열을 읽는
테스트가 **10개**다.

```
test/unit/chatgpt-attachments.test.mjs
test/unit/stability-benchmarks.test.mjs
test/unit/tab-lifecycle.test.mjs
test/unit/web-ai-chat-surface-normalization.test.mjs
test/unit/web-ai-chatgpt-model.test.mjs
test/unit/web-ai-chatgpt-response-fragments.test.mjs
test/unit/web-ai-chatgpt-tools.test.mjs
test/unit/web-ai-provider-session.test.mjs
test/unit/web-ai-timeout-default.test.mjs
test/unit/web-ai-wrapperless-correlation.test.mjs
```

직접 영향이 확인된 것:

| 파일 | 고정하는 것 |
| --- | --- |
| `web-ai-wrapperless-correlation.test.mjs:119-137` | `countAssistantMessages` 본문의 `if (split.ok) return split.wrapped.length;`와 루프의 `const wrapped = split.ok` |
| `web-ai-chatgpt-response-fragments.test.mjs:241-249` | 응답 조각 처리 형태 |
| `web-ai-timeout-default.test.mjs:234-237` | 타임아웃 기본값 형태 |
| `tab-lifecycle.test.mjs:198-204` | 탭 수명주기 호출 형태 |

첫째가 가장 직접적이다. 반환 계약을 바꾸면 어서션을 함께 갱신하되 불변식
("legacy fallback은 성공한 빈 읽기가 아니라 실패한 획득에서만")은 유지한다.
나머지 6개도 후속 유닛의 각 work-phase에서 해당 형태를 건드리는지 확인해야 한다.

## 6절 — 테스트 하네스 제약

`rg -ln "pollWebAi\(" test/` 결과 `pollWebAi`를 실제로 구동하는 하네스는 **4개**다.

```
test/unit/web-ai-chatgpt-activity-poll.test.mjs      가상 시계 하네스
test/unit/web-ai-provider-session.test.mjs           세션/baseline 경로
test/integration/web-ai-fake-chatgpt.test.mjs:97     통합 fake
test/integration/web-ai-golden-scenario.test.mjs:85  골든 시나리오
```

`web-ai-chatgpt-activity-poll.test.mjs:14-69`가 시계를 통제하는 유일한 하네스다. `Date.now`를 mock하고 offset은 `page.waitForTimeout`
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

담당: B01~B09, B11, B12, B13, B26, B27, B29 (15개)

work-phase 분할(의존 순서):

1. 예산 프리미티브 + sentinel 계약 + fake timer 하네스 — 이후 전부의 토대
2. 데드라인 안 읽기 경로(B01, B02, B07) + `countAssistantMessages` 계약과
   5절의 소스-텍스트 테스트 갱신
3. 완료 판정 경로(B03, B04, B05, B06) — fail-open 둘이 여기
4. 데드라인 후 경로(B09, B11, B12, B13, B29)
5. deferred 반환의 세션 락(B26)과 하트비트(B27) — 유닛 B의 sync-IO 처방을
   선행으로 받는다
6. B08의 취소되지 않는 evaluate 처리
7. warning 전파(4절의 모든 반환 경로) + 활성화 관측

수용 기준: 담당 경계 전부가 데드라인을 인지하고, 각 정체 경로의 발화가
관측된다(C-ACTIVATION-GROUNDING-01). 일부만으로는 충족 아님.

### 유닛 B — `webai_artifact_finalizer`

아티팩트 수집과 탭 수명주기. CDP와 동기 IO가 여기 모인다.

담당: B10, B14~B25, B28, B30~B34 (19개)

work-phase 분할(의존 순서):

1. **pre-budget 예산 수립**(B21, B22, B23, B24) — 데드라인이 `:617`에서야
   생기므로 그 앞 경계를 먼저 다뤄야 뒤의 예산이 의미를 갖는다
2. **동기 IO 처방**(B18, B19, B20, B31~B34) — race가 불가하므로 다른 설계가
   필요하다. 유닛 A의 5번 work-phase가 이 결과를 받으므로 앞에 온다
3. CDP 예산 규약(B24, B25, B28, B30) — `CDPSession.send`에 timeout이 없다
4. 아티팩트 수집(B14, B15, B30, B31, B32)
5. diagnostics(B10, B28)
6. 탭 lease와 finalizer(B16, B17, B33, B34)

수용 기준: 담당 경계 전부가 데드라인을 인지하거나 bounded임이 증명된다.

### 배정 대조

경계 34개(B01~B34) 전부가 배정됐다. 유닛 A 15개 + 유닛 B 19개 = 34.

```
A: B01 B02 B03 B04 B05 B06 B07 B08 B09 B11 B12 B13 B26 B27 B29
B: B10 B14 B15 B16 B17 B18 B19 B20 B21 B22 B23 B24 B25 B28 B30 B31 B32 B33 B34
```

배정 없이 남긴 경계는 없다. 초판에서 B08을 bounded로 보고 제외했으나, 페이지 내
`setTimeout`은 wall-time 상한이 아니므로 유닛 A에 넣었다.

### 유닛 간 선행 관계

두 유닛은 독립이 아니다. 유닛 B의 2번 work-phase(동기 IO 처방)가 유닛 A의 5번
work-phase(B26 세션 락)에 필요하다. **유닛 B를 먼저 시작해 최소한 2번까지 끝낸
뒤 유닛 A의 5번을 진행한다.** 나머지는 병행 가능하다.

### 문서 번호

두 유닛은 각각 새 폴더(`devlog/_plan/YYMMDD_webai_poll_deadline/`,
`devlog/_plan/YYMMDD_webai_artifact_finalizer/`)를 갖는다. 각 유닛의 decade
문서는 그 유닛의 docs-first 사이클에서 쓴다. 이 유닛의 `022`, `023`을 쓰지
않으므로 `030`과의 번호 충돌은 발생하지 않는다.

## `pollWebAi` 밖의 같은 리더 (020 §1 별도 기록 요구)

`countAssistantMessages`(`chatgpt.mjs:1394`)는 `pollWebAi` 밖이지만 B02와 같은
리더를 쓴다. 호출부 셋:

| 호출부 | 용도 | 정체 시 |
| --- | --- | --- |
| `chatgpt.mjs:331` | send 직전 baseline | baseline이 0으로 굳으면 과거 답변 전체가 새 답변 후보가 된다 |
| `chatgpt.mjs:1155` | deep research baseline | 동일 |
| `chatgpt.mjs:1415` | `waitForStableAssistantCount` | 연속 정체를 "안정"으로 오독 |

이 셋은 `--timeout` 예산 밖이라 별도 처방이 필요하다. **유닛 A의 2번 work-phase**
가 B02와 함께 다룬다 — 같은 리더를 고치면서 호출부 계약도 같이 바꿔야 하기
때문이다.

## 이 지도가 틀렸다는 것을 보여줄 증거

**초판이 실제로 틀렸다.** 22개라고 선언했는데 독립 감사가 12개를 더 찾았다.
놓친 유형은 셋이었다:

- `deps.getTargetId`/`deps.getCdpSession` 같은 **주입 경계** — 호출부만 보면
  불투명해서 "말단"처럼 보였다(B24, B25)
- 이름이 순수해 보이는 함수의 **숨은 IO** — `buildDeferredPollingResult`가
  세션 스토어를 쓴다(B26)
- 외부 모듈을 **첫 경계에서 끊은 것** — diagnostics·copy resolver·아티팩트
  저장·finalizer 하위에 더 있었다(B28~B34)

020의 재귀 규칙은 이 셋을 모두 요구했는데 실행이 부족했다. 규칙이 아니라 적용이
틀렸다.

지금도 취약한 가정:

- `closeTab`(`skills/browser/tab-manager.mjs:310`) 아래를 더 파지 않았다.
- 주입 경계는 구현이 바뀔 수 있다. B24/B25의 현재 구현
  (`skills/browser/browser.mjs:1056-1063`)은 스냅샷이다.
- 구현 중 여기 없는 경계가 또 나오면 이 문서를 개정한다 — 목록을 조용히 늘리지
  않는다.
