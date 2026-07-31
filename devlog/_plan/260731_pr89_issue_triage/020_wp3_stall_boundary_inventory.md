# 020 — WP3: 이슈 #88 정체 경계 인벤토리 (명세)

선행: WP2. 후행: 이 문서가 확정한 분할안대로 append되는 구현 work-phase들.

**이 work-phase는 코드를 바꾸지 않는다.** 산출물은 "무엇을 막아야 하는지"의
확정된 목록이다. 축소 경위는 `003_audit_synthesis.md`.

## 왜 인벤토리가 별도 work-phase인가

A 페이즈 감사 3라운드가 모두 이 목록에서 실패했다. 매번 "전부 덮었다"고 판단하고
매번 새 누락이 나왔다. 목록이 근거와 함께 고정되기 전에 쓰는 구현 계획은 같은
실패를 반복한다. 그래서 목록 확정 자체를 검증 가능한 산출물로 분리한다.

## 산출물

`devlog/_plan/260731_pr89_issue_triage/021_stall_boundary_map.md` — 아래 명세대로
작성한다.

### 1절 — 경계 전수 (call graph 폐쇄로 도출)

**패턴 검색으로 시작하지 않는다.** `rg`로 `page.evaluate`를 찾는 방식은 이미 세
번 실패했다. 실패 원인은 정체가 직접 호출이 아니라 **전이적 위임**을 통해
들어오기 때문이다 — 예를 들어 `resolveOptionalChatGptCopyTarget`
(`web-ai/chatgpt.mjs:734`, `:958`)은 `target-resolver.mjs`를 거쳐
`self-heal.mjs:222`의 무제한 `locator.count()`에 도달한다. 어떤 `rg` 패턴도
이것을 `chatgpt.mjs`에서 보여주지 않는다.

대신 **호출 그래프를 닫는다.**

1. `pollWebAi`(`web-ai/chatgpt.mjs:582`) 본문의 **비동기 진입점 전부**를
   열거한다. `await` 표현식만으로는 부족하다 — 다음 넷을 모두 센다.
   - `await` 표현식
   - **await 없이 생성·저장되는 Promise.** `observeAssistantResponse`가 그 예다:
     `:624-627`에서 await 없이 만들어져 `:835-841`의 `Promise.race`에서 소비된다.
     callee 재귀만으로는 이 edge가 복원되지 않는다.
   - **함수를 인자로 넘기는 호출.** recovery의 `readStreaming`/`readFinished`
     콜백(`:865-871`)처럼 호출 시점이 callee 안에 있는 경우.
   - `.then`/`.catch`/`Promise.all`/`Promise.race`로 소비되는 표현식.

   데드라인 안(루프)과 데드라인 후(recovery·diagnostics·copy·finalize) 양쪽 모두.
2. 각 callee에 대해: 그 함수 본문의 모든 `await`를 다시 열거한다.
3. 다음 중 하나에 도달할 때까지 재귀한다.
   - **말단 분류**: Page API / Locator API / CDP / 순수 계산·IO(페이지 접근 없음)
   - **이미 방문한 함수**(사이클)
4. 방문한 함수 집합과 그 소유 파일을 모두 기록한다. `web-ai/` 밖으로 나가면
   (`skills/browser/**` 등) 거기서도 같은 규칙을 적용한다.

`cxc map web-ai`로 심볼 소유 관계를 먼저 파악하면 재귀가 빨라진다. 그래도
최종 근거는 실제 파일 읽기다.

각 행: 경계 ID(B01, B02…) / 파일:라인(**함수 소유 위치와 실제 blocking 호출
위치를 구분해 둘 다**) / 접근 종류 / `pollWebAi`로부터의 전체 호출 사슬 /
데드라인 전인지 후인지 / 도달 조건(항상 · 세션 폴 한정 · `diagnostics` ·
`allowCopyMarkdownFallback` · `archiveFlag`).

착수 시점의 기지 항목은 아래와 같다. **이것은 완전한 목록이 아니라 출발점이다** —
아래 표는 직접 호출과 감사에서 드러난 전이 경로 일부만 담고 있고, 감사에서 드러난 전이적 경로(copy target
resolver → self-heal, finalizeProviderTab → archive)는 일부만 포함한다.
인벤토리는 call graph 폐쇄로 이 목록을 검증하고 확장한다.

| 파일:라인 | 종류 | 경로 | 도달 조건 |
| --- | --- | --- | --- |
| `chatgpt.mjs:557`(정의) / `:560`(evaluate) | Page.evaluate | `doesAssistantFollowUser` ← 루프 `:719` | 항상 |
| `chatgpt.mjs:1035` | Page.evaluate | `readActivityState` ← 루프 `:674` | 항상 |
| `chatgpt.mjs:1067` | Page.evaluate | `isResponseFinished` ← 루프 `:710`, recovery `:870` | 항상 |
| `chatgpt.mjs:1438-1439` | Page.evaluate | `readAssistantSnapshots` | split 실패 시 |
| `chatgpt.mjs:1466` | Page.evaluate | `readAssistantSnapshotsSplit` ← 루프 `:655` | 항상 |
| `chatgpt-response-dom.mjs:30`(정의) / `:36`,`:39`,`:48`,`:53`,`:58`(blocking) | Locator | `anyStopButtonVisible` ← `readActivityState` 본문 `:1032` | 항상 |
| `chatgpt-response-dom.mjs:415` | Locator | `readTopLevelAssistantTextsFromLocators` ← `:1428` | evaluate 실패 시 |
| `chatgpt-response-observer.mjs:103-104` | Page.evaluate | `recoverAssistantResponse` ← `:865` | 세션 폴, 데드라인 후 |
| `failure-diagnostics.mjs:29` | 외부 모듈 | `captureFailureDiagnostics` ← `:916` | `diagnostics` 활성, 데드라인 후 |
| `copy-markdown.mjs:71` | 외부 모듈 | `captureCopiedResponseText` ← `:959` | `allowCopyMarkdownFallback`, 데드라인 후 |
| `chatgpt.mjs:920`, `:940` | 간접 | copy fallback의 `isStreaming`/`isResponseFinished` | `allowCopyMarkdownFallback`, 데드라인 후 |
| `chatgpt.mjs:734-737` | 외부 모듈 | copy target resolve + capture — **루프 내부**(데드라인 후만 있는 게 아니다) | `allowCopyMarkdownFallback` |
| `self-heal.mjs:222` | Locator | `resolveOptionalChatGptCopyTarget`(`:1305`) → `target-resolver.mjs` → `self-heal` | `allowCopyMarkdownFallback` |
| `chatgpt-archive.mjs:84-105` | Locator/click | `finalizeProviderTab`(`:695`, `:809`, `:896`, `:967`) → `tab-finalizer.mjs:95` → `archiveConversation` | `archiveFlag` |
| `chatgpt-images.mjs` | CDP | `collectImages` ← 루프 `:759`, `collectGeneratedImageAnswer:1498` | 이미지 응답 |
| `chatgpt-files.mjs` | CDP | `saveAssistantDownloadableFiles` ← 루프 `:797` | 다운로드 가능 파일 |

**1단계 callee는 15개다.** `pollWebAi` 본문(`:582`–`:1020`)에서
`await <함수>(` 패턴을 뽑으면 다음이 나온다 — 이것이 폐쇄의 출발 집합이다.

```
captureCopiedResponseText     captureFailureDiagnostics    collectGeneratedImageAnswer
collectImages                 doesAssistantFollowUser      finalizeProviderTab
isResponseFinished            isStreaming                  readActivityState
readAssistantSnapshots        readAssistantSnapshotsSplit  recoverAssistantResponse
requireChatGptPage            resolveOptionalChatGptCopyTarget
saveAssistantDownloadableFiles
```

`deps.getTargetId`, `page.url()`, `page.waitForTimeout` 같은 직접 페이지 호출은
별도로 센다. 이미지·파일 경로는 Page/Locator가 아니라 **CDP 세션**을 쓰므로
정체 특성이 다르다 — 2절에서 별도 축으로 판정한다.
| `chatgpt-response-observer.mjs:81` | Page.evaluate | `observeAssistantResponse` ← `:626` | 항상 — **이미 `timeoutMs` 예산 있음** |

`countAssistantMessages` 경로(`chatgpt.mjs:331`, `:1151`, `:1413`)는 `pollWebAi`
밖이지만 같은 리더를 쓰므로 별도 절에 기록한다.

### 2절 — 방어 가능성 판정

각 접근 종류가 어떤 기법으로 제한 가능한지 Playwright 소스 근거와 함께 판정한다.
접근 종류는 넷이다: Page API · Locator API · **CDP 세션** · 순수 계산/IO.
CDP는 Playwright 타임아웃 규약이 적용되지 않으므로 별도 축으로 판정한다.

감사에서 확인된 사실:

- `Page.evaluate`는 timeout 옵션이 없다 → 외부 race 필요.
- `locator.all()`은 timeout 없는 `count()`를 호출한다
  (`node_modules/playwright-core/lib/client/locator.js:280`,
  `lib/client/frame.js:213`).
- `locator.isVisible({ timeout })`의 timeout은 무시된다
  (`node_modules/playwright-core/types/types.d.ts:14191`).
- `Promise.race`는 패배한 요청을 취소하지 않는다 → 긴 timeout에서 요청이 누적될
  수 있다. 단일-flight 억제가 필요한지 판정한다.

판정 결과는 세 갈래 중 하나여야 한다: (a) 호출부에서 옵션으로 제한 가능,
(b) 외부 race 필요, (c) 호출 자체를 조건부로 건너뛰어야 함.

### 3절 — sentinel 소비자 목록

예산 초과 신호가 어떤 값으로 표현되든, 그것을 "정상 값"으로 오해하면 안 되는
소비 지점을 전수 조사한다. 각 지점의 현재 기본값(`[]`, `null`, `'none'`,
`{finished:false}`, `true`)이 정체 상황에서 안전한지 판정한다.

특히 위험한 것으로 이미 확인된 것:

- `doesAssistantFollowUser`(`chatgpt.mjs:576`)는 비-`false`를 "순서 정상"으로
  읽는다 → 정체가 통과로 위장된다.
- `readActivityState` catch(`chatgpt.mjs:1049`)는 `'none'`을 돌려주고, 루프는
  `'none'`을 quiet으로 읽어 완료 분기로 간다(`:679-680`, `:709-728`).
- `countAssistantMessages`가 0을 돌려주면 baseline이 0이 되어 과거 답변 전체가
  새 답변 후보가 된다.

### 4절 — 반환 경로 목록

정체를 겪은 명령이 그 사실을 알려야 하므로, `pollWebAi`의 모든 반환 지점을
열거한다. 감사에서 확인된 것: `:702`(image 성공), `:848`(탭 크래시),
`:876`·`:898`(recovery), `:924`(copy deferred), `:986-1001`(copy 타임아웃),
`:1004-1020`(최종 타임아웃), 그리고 성공 완료 경로(`:729-730` 초기화).

### 5절 — 기존 테스트 계약 영향

소스 문자열을 검사하는 테스트가 있어 리팩터와 함께 갱신해야 한다:
`test/unit/web-ai-wrapperless-correlation.test.mjs:119-137`이
`if (split.ok) return split.wrapped.length;`를 문자열로 요구한다.

`rg -n "readFileSync.*chatgpt" test/`로 같은 패턴의 다른 테스트를 찾아 목록화한다.

### 6절 — 테스트 하네스 제약

기존 폴링 하네스(`test/unit/web-ai-chatgpt-activity-poll.test.mjs:14-69`)는
`Date.now`를 mock하고 offset은 `page.waitForTimeout`에서만 전진한다. 실제
`setTimeout` 기반 예산과 mocked clock이 섞이면 "두 번째 읽기는 남은 시간만
받는다"는 계약을 검증할 수 없다(감사 R3-B8).

시계와 타이머를 함께 주입할지, vitest fake timer를 쓸지 판정하고 근거를 남긴다.

### 7절 — 구현 work-phase 분할안

1~6절 결과로 구현을 몇 개 work-phase로 나눌지, 각 경계가 어디에 속하는지
제시한다. 분할은 의존 순서를 따른다(PHASE-SPLIT-01) — 난이도나 분량 기준으로
나누지 않는다. 각 work-phase는 독립적으로 검증 가능해야 한다.

예상 축(인벤토리 결과에 따라 바뀔 수 있다): 예산 프리미티브와 sentinel 계약 →
데드라인 안 읽기 경로 → 데드라인 후 경로(recovery·diagnostics·copy·finalize) →
`countAssistantMessages` 계약과 baseline 보호.

**문서 번호 규칙도 7절에서 확정한다.** WP3.x 문서는 `022`, `023`…으로 배치하되
`030`(WP4)과 충돌하지 않아야 한다. 분할이 8개를 넘으면 `020_0_`, `020_1_` 형태의
서브인덱스로 전환한다(devlog 규약의 overflow 규칙). 어느 쪽을 쓸지 7절에서
정하고, `000_plan.md`의 work-phase 지도도 그때 갱신한다.

## 완료 조건

형식 조건:

- `021_stall_boundary_map.md`가 7개 절을 모두 갖는다.
- 1절의 모든 행이 경계 ID를 갖고, 함수 소유 위치와 blocking 호출 위치를 구분해
  인용한다.
- 2절의 모든 판정에 근거 인용이 있다. Page/Locator는 Playwright 소스 또는 타입
  정의, CDP는 해당 owner 코드와 프로토콜 timeout 규약을 근거로 삼는다.
- 코드 변경 0줄. `git diff --stat`이 devlog 경로만 보여준다.

**전수성 조건(이것이 핵심이다).** 세 번의 실패가 모두 "목록이 완전하다고 믿었는데
아니었다"였으므로, 완전성을 주장이 아니라 검사로 만든다.

- **폐쇄 증명**: `pollWebAi`에서 도달 가능한 함수 집합이 닫혔음을 보인다. 1절
  부록에 방문한 함수 전체 목록(파일:라인)을 싣고, 각 함수가 (a) 말단으로
  분류됐거나 (b) 그 callee가 모두 목록에 있음을 확인할 수 있어야 한다. 목록에
  없는 callee가 하나라도 있으면 미완이다.
- **절 간 상호 대조**: 1절의 각 경계 ID에 대해 3절은 그 sentinel을 소비하는
  지점을 **전부** 열거하고, 4절은 그 경계가 도달할 수 있는 종료 경로를 **전부**
  열거한다. "최소 하나"로는 부족하다 — 소비자가 여럿인 경계를 하나만 적어도
  통과해버린다. 역방향(3·4절에 있는데 1절에 없음)도 오류다.
- **7절 대상 배정**: 1절의 모든 경계 ID가 7절 분할안의 어느 work-phase엔가
  배정돼야 한다. 배정하지 않을 수 있는 경우는 둘뿐이다: (a) 이미 예산이 있어
  bounded하다는 근거를 댈 수 있거나(예: `observeAssistantResponse`의 `timeoutMs`),
  (b) 명시적으로 이 유닛의 범위 밖이라고 판정하고 그 이유를 적은 경우.
  **무방비 경계를 근거 없이 뒤로 미루는 것은 허용하지 않는다** — 침묵도, 막연한
  연기도 누락과 구별되지 않는다.
- 7절의 분할안이 goalplan에 append 가능한 형태다(각 work-phase의 제목, 범위,
  수용 기준, 담당 경계 ID 목록).

## 이 명세가 실패하는 방식 (LOOP-PESSIMIST-01)

call graph 폐쇄가 실무적으로 끝나지 않을 수 있다. `finalizeProviderTab` 같은
함수는 탭 수명주기 전체로 뻗어 있어서 재귀가 `web-ai/` 밖까지 번진다. 그 경우
**폐쇄 범위를 "페이지를 만지는 호출"로 좁히고** 그 판단 기준을 문서에 명시한다 —
범위를 좁혔다는 사실 자체를 숨기지 않는다.

또 하나: 이 인벤토리가 경계를 20개 이상 찾아낸다면, 문제는 `pollWebAi`가 아니라
web-ai 전반의 페이지 접근 규약이다. 그때는 유닛 자체를 다시 잡아야 한다.

## 범위 경계

- IN: `devlog/_plan/260731_pr89_issue_triage/021_stall_boundary_map.md` 신규 작성,
  읽기 전용 소스 조사.
- OUT: `web-ai/**` 수정, 테스트 추가, 예산 헬퍼 구현. 전부 후속 work-phase.
