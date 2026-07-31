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

### 1절 — 경계 전수

`pollWebAi`(`web-ai/chatgpt.mjs:582`)가 데드라인 안에서, 그리고 데드라인 이후
반환 전까지 페이지를 만지는 모든 지점을 표로 만든다. 조사 명령을 문서에 남긴다.

```
rg -n "page\.evaluate|locator\(|\.all\(\)|isVisible\(|innerText\(" web-ai/chatgpt.mjs
rg -n "page\.evaluate|locator\(" web-ai/chatgpt-response-dom.mjs web-ai/chatgpt-response-observer.mjs \
   web-ai/failure-diagnostics.mjs web-ai/copy-markdown.mjs
```

각 행: 파일:라인 / 접근 종류(Page.evaluate · Locator API · 외부 모듈 위임) /
`pollWebAi`로부터의 호출 경로 / 데드라인 전인지 후인지 / 도달 조건(항상 · 세션 폴
한정 · `diagnostics` 옵션 · `allowCopyMarkdownFallback` 옵션).

착수 시점의 기지 항목은 아래와 같다. 인벤토리는 이 목록을 검증하고 확장한다 —
이대로 옮겨 적는 것은 산출물이 아니다.

| 파일:라인 | 종류 | 경로 | 도달 조건 |
| --- | --- | --- | --- |
| `chatgpt.mjs:557` | Page.evaluate | `doesAssistantFollowUser` ← 루프 `:719` | 항상 |
| `chatgpt.mjs:1035` | Page.evaluate | `readActivityState` ← 루프 `:674` | 항상 |
| `chatgpt.mjs:1067` | Page.evaluate | `isResponseFinished` ← 루프 `:709`, recovery `:869` | 항상 |
| `chatgpt.mjs:1438-1439` | Page.evaluate | `readAssistantSnapshots` | split 실패 시 |
| `chatgpt.mjs:1466` | Page.evaluate | `readAssistantSnapshotsSplit` ← 루프 `:655` | 항상 |
| `chatgpt-response-dom.mjs:30` | Locator | `anyStopButtonVisible` ← `readActivityState:1031` | 항상 |
| `chatgpt-response-dom.mjs:415` | Locator | `readTopLevelAssistantTextsFromLocators` ← `:1428` | evaluate 실패 시 |
| `chatgpt-response-observer.mjs:103-104` | Page.evaluate | `recoverAssistantResponse` ← `:865` | 세션 폴, 데드라인 후 |
| `failure-diagnostics.mjs:29` | 외부 모듈 | `captureFailureDiagnostics` ← `:915` | `diagnostics` 활성, 데드라인 후 |
| `copy-markdown.mjs:71` | 외부 모듈 | `captureCopiedResponseText` ← `:958` | `allowCopyMarkdownFallback`, 데드라인 후 |
| `chatgpt.mjs:919`, `:939` | 간접 | copy fallback의 `isStreaming`/`isResponseFinished` | `allowCopyMarkdownFallback`, 데드라인 후 |
| `chatgpt-response-observer.mjs:81` | Page.evaluate | `observeAssistantResponse` ← `:626` | 항상 — **이미 `timeoutMs` 예산 있음** |

`countAssistantMessages` 경로(`chatgpt.mjs:331`, `:1151`, `:1413`)는 `pollWebAi`
밖이지만 같은 리더를 쓰므로 별도 절에 기록한다.

### 2절 — 방어 가능성 판정

각 접근 종류가 어떤 기법으로 제한 가능한지 Playwright 소스 근거와 함께 판정한다.
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
데드라인 안 읽기 경로 → 데드라인 후 경로(recovery·diagnostics·copy) →
`countAssistantMessages` 계약과 baseline 보호.

## 완료 조건

- `021_stall_boundary_map.md`가 7개 절을 모두 갖는다.
- 1절의 모든 행에 조사 명령으로 재현 가능한 근거가 있다.
- 2절의 모든 판정에 Playwright 소스 또는 타입 정의 인용이 있다.
- 7절의 분할안이 goalplan에 append 가능한 형태다(각 work-phase의 제목, 범위,
  수용 기준).
- 코드 변경 0줄. `git diff --stat`이 devlog 경로만 보여준다.

## 범위 경계

- IN: `devlog/_plan/260731_pr89_issue_triage/021_stall_boundary_map.md` 신규 작성,
  읽기 전용 소스 조사.
- OUT: `web-ai/**` 수정, 테스트 추가, 예산 헬퍼 구현. 전부 후속 work-phase.
