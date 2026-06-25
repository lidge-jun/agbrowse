# 33 — Response Capture Dual-Path PABCD

Date: 2026-06-24 (agbrowse v0.1.15)
Status: ✅ **IMPLEMENTED 2026-06-25** (90accb2 + 105b613) — conservative wiring (아래 노트)
Parent: [03_response_capture.md](03_response_capture.md) · Sibling: [31](31_chatgpt_downloadable_artifacts_pabcd.md) / [32](32_deep_research_session_followup_pabcd.md)

## 구현 노트 (2026-06-25, 계획 대비 조정)

잠금 결정("observer = short-circuit only, poller authoritative")과 load-bearing `pollWebAi` 무회귀 원칙에 따라, 본문의 `Promise.race(observerP, pollerLoop)` + `chooseCaptureResult` 설계 대신 **보수적 wiring**으로 구현:

- **`chooseCaptureResult` 생략** — poller가 권위를 가지므로 observer는 경쟁 결과가 아니라 **wake 신호**다. 결과 선택 불필요(= dead code 회피).
- **observer = one-shot early-wake**: 루프의 고정 500ms 대기를 `race(500ms, observerWake)`로 교체. observer가 settle 신호를 주면 즉시 깨어 poller가 읽고 검증; 이후 일반 폴링. 최악(observer 미발화/에러)이어도 **기존 500ms 폴링과 동일** → 무회귀.
- **3차 복구**: deadline 시 `recoverAssistantResponse`로 마지막 assistant turn 1회 재읽기(placeholder는 `isFinalAnswer`로 거부) → 성공 시 `usedFallbacks:['recovery']` 완료 반환.
- 이유: 본문 설계는 in-loop finalize 경로를 복제/추출해야 해서 최-load-bearing 함수에 회귀 위험. 위 방식은 poller 권위·finalize 무변경으로 short-circuit 이득만 취함.

검증: 전체 스위트 948/948(무회귀), observer 모듈 11/11.

## 2026-06-24 재감사 (v0.1.15)

`03_response_capture.md`의 핵심 gap이 코드 대조로 확인됨 — 단일 poller만 존재, 빠른 경로/3차 복구 부재:

- **단일 poller 루프**: `pollWebAi`(`web-ai/chatgpt.mjs:328`)가 `while (Date.now() <= deadline)`(`:359`) 안에서 `readAssistantMessages`(`:386`) → `isFinalAnswer` 필터(`:387`) → `isStreaming`(`:389`)/`isResponseFinished`(`:396`) → `stableText`/`stableSince` 안정화(`:356-357`,`:398-491`, adaptive `minStableMs` `:401-406`) → 500ms sleep(`:492`). DOM 변경을 **즉시 감지하는 MutationObserver 경로 없음**.
- **MutationObserver 빠른 경로 부재**: `grep MutationObserver web-ai/` → **0 hits**.
- **3차 복구 부재**: `recoverAssistantResponse`/`pollAssistantCompletion` → **0 hits**. deadline 초과 시 timeout 결과로 직행, 마지막 turn 텍스트 재읽기 시도 없음.
- 이미 구현(재활용 대상): placeholder 전용 필터 `PLACEHOLDER_PATTERNS`(`:63`) + `isFinalAnswer`(`:946-947`), streaming 게이트 `isStreaming`(`:578-584`)로 stop 버튼 가시 시 계속 대기, copy-markdown opt-in fallback(`:412-425`), conversation/target mismatch 가드(`:361-385`).

**설계 제약**: `web-ai/chatgpt.mjs`는 이미 **973 lines**(`structure/str_func.md` 기준; `wc -l`은 trailing-newline 부재로 972). 500-line 가이드를 크게 넘기므로 observer/recovery 로직은 **신규 모듈**로 분리한다(31의 `chatgpt-files.mjs` 분리 패턴과 동일).

## Purpose

Oracle는 응답 캡처를 `Promise.race(MutationObserver 경로, snapshot poller)` + 패자 abort + 3차 복구(`recoverAssistantResponse`)로 이중화한다(`03` 원본 참조). agbrowse는 poller 단일 경로라 DOM이 예상대로 stabilize되지 않으면 느리거나 timeout으로 실패한다. 이 계획은 **기존 poller를 권위 경로로 유지**하면서 observer를 **빠른 단축(short-circuit) 경로**로 추가하고, deadline 직전 **best-effort 3차 복구**를 더한다. 안정화 의미(adaptive `minStableMs`)와 mismatch 가드는 보존한다.

## Priority Map

| ID | Priority | Outcome |
| --- | --- | --- |
| 33.1 | P1 | MutationObserver 빠른 경로 모듈 + 순수 선택 helper (테스트 가능) |
| 33.2 | P1 | poller와 observer를 race + 패자 AbortController cleanup; 기존 stabilization/가드 보존 |
| 33.3 | P1 | deadline 초과 시 `recoverAssistantResponse` 3차 복구(마지막 assistant turn 재읽기) |
| 33.4 | P2 | streaming 재대기/placeholder 필터 회귀 테스트 강화 |

## P — Plan

### Part 1 — Easy Explanation

ChatGPT 응답을 두 가지 방법으로 동시에 본다. (1) DOM 변경을 즉시 감지하는 observer(빠름), (2) 지금처럼 0.5초마다 DOM을 읽는 poller(안정적). 둘 중 먼저 "완료된 최종 답"을 증명하는 쪽을 쓰고 나머지는 즉시 중단한다. 둘 다 deadline까지 실패하면, 마지막 assistant turn 텍스트를 한 번 더 읽어 best-effort로 살린다. placeholder("Answer now"/"Pro thinking")는 최종 답으로 오인하지 않으며, stop 버튼이 보이면 계속 생성 중으로 본다(기존 동작 유지).

### Part 2 — Diff-level Precision

#### NEW `web-ai/chatgpt-response-observer.mjs`

`web-ai/chatgpt.mjs`를 넓히지 말 것(이미 973 lines). 신규 모듈로 분리한다.

Exports:

```js
// 브라우저에 주입할 MutationObserver 표현식 문자열을 만든다(테스트는 문자열 형태/인자 반영만 검증).
export function buildResponseObserverExpression({ baselineAssistantCount, quietMs = 1200, timeoutMs }) {}

// page.evaluate로 observer 표현식을 awaitPromise 형태로 실행. signal로 외부 abort.
// 반환: { from: 'observer', text, completed: true } | null (timeout/abort)
export async function observeAssistantResponse(page, { baselineAssistantCount, timeoutMs, signal } = {}) {}

// observer 결과와 poller 결과 중 권위 있는 쪽을 고르는 순수 함수.
// 규칙: completed 우선 → placeholder 아닌 쪽 → 더 긴 텍스트. 둘 다 비면 null.
export function chooseCaptureResult(observerResult, pollerResult) {}

// 3차 복구: 마지막 assistant turn 텍스트를 1회 재읽기(streaming 아님 확인 후).
// 반환: { from: 'recovery', text, recovered: true } | null
export async function recoverAssistantResponse(page, { baselineAssistantCount } = {}) {}
```

Required behavior:

- `buildResponseObserverExpression`는 conversation 컨테이너에 MutationObserver를 달고, baseline 이후 새 assistant turn이 `quietMs` 동안 추가 mutation 없이 유지되거나 stop 버튼이 사라지면 resolve하는 IIFE 표현식을 반환. `timeoutMs` 경과 시 `null` resolve(reject 금지 — race에서 조용히 패배).
- `observeAssistantResponse`는 위 표현식을 `page.evaluate`로 실행하고, `signal.aborted` 시 진행 중 evaluate를 정리(표현식 내부 타이머/observer disconnect).
- `chooseCaptureResult`는 **순수 함수**(page 접근 없음) — 단위 테스트의 핵심.
- `recoverAssistantResponse`는 부작용 최소(읽기 전용), placeholder는 `isFinalAnswer`와 동일 기준으로 거부.

Suggested result shape (내부 공통):

```js
{ from: 'observer' | 'poller' | 'recovery', text: '...', completed: true }
```

Implementation notes:

- observer는 **단축 경로일 뿐**, 완료 증명에 실패하면 poller가 권위를 유지한다. observer가 `completed:true`를 반환해도 호출부는 기존 `isFinalAnswer`로 한 번 더 검증한다.
- placeholder/streaming 판정은 `chatgpt.mjs`의 `PLACEHOLDER_PATTERNS`(`:63`)/`isStreaming`(`:578`) 기준을 재사용한다. 중복 정의 금지 — 필요한 상수/판정은 `chatgpt.mjs`에서 export하여 공유.
- CDP Runtime 직접 접근이 Playwright 의존 표면에서 불가하면 `page.evaluate(string, ...args)`로 구현하고 표현식 안에서 observer를 돌린다(awaitPromise 등가).

#### MODIFY `web-ai/chatgpt.mjs`

`pollWebAi`(`:328`)의 루프 본문을 race로 감싼다. **mismatch 가드(`:361-385`)는 race 밖에서 매 tick 먼저 실행** — observer가 다른 conversation을 캡처하지 못하게.

통합 지점(개념):

```js
const ac = new AbortController();
const observerP = observeAssistantResponse(page, {
  baselineAssistantCount: baseline.assistantCount,
  timeoutMs: deadline - Date.now(),
  signal: ac.signal,
});
// 기존 while-loop를 pollerP로 캡슐화(같은 stableText/minStableMs/finalize 경로 유지)
const winner = chooseCaptureResult(await Promise.race([observerP, pollerP]), null);
ac.abort(); // 패자 정리
```

Rules:

- 승자가 observer면, 기존 finalize 경로(copy-markdown `:412`, image `:426`, `finalizeProviderTab` 호출 `:468` — `if` 가드 `:467`, `withAnswerArtifact` `:470`)를 **그대로** 통과시킨다 — 캡처 방식만 빨라지고 후처리는 동일.
- 패자는 `AbortController`로 즉시 중단(브라우저 내 observer disconnect 포함).
- `latest && !streaming` 안정화(`:397-407`)와 adaptive `minStableMs`(`:401-406`)는 poller 경로에서 보존.
- deadline 초과로 둘 다 실패하면, timeout 결과 반환 직전 `recoverAssistantResponse(page, {...})`를 1회 호출. 성공 시 `status:'complete'` + `usedFallbacks:['recovery']` + `warnings:['response-recovered-after-timeout']`. 실패 시 기존 timeout 동작 유지.
- conversation/target mismatch 가드, `tab-crashed` 처리(`:493-500`)는 변경 금지.

#### MODIFY `test/unit/` (신규 + 보강)

NEW `test/unit/web-ai-chatgpt-response-observer.test.mjs`:

- `chooseCaptureResult`: completed 우선, placeholder 거부, 더 긴 텍스트 선택, 양쪽 빈 값 → null.
- `buildResponseObserverExpression`: `baselineAssistantCount`/`quietMs`/`timeoutMs`가 표현식 문자열에 반영, reject 아닌 null resolve 형태.
- `recoverAssistantResponse`: fake page에서 마지막 assistant turn 재읽기 성공, placeholder 거부, streaming 중이면 null.

MODIFY `test/unit/stability-benchmarks.test.mjs` (또는 신규 B5 offline 보조):

- dual-path 존재(observer 모듈 export 4종)와 recovery 경로 존재를 구조적으로 assert(라이브 없이 가능한 범위).

## A — Plan Audit Checklist

- observer가 **다른 tab/conversation**의 응답을 캡처하지 못한다(mismatch 가드가 race보다 먼저).
- 패자 경로가 항상 abort/cleanup된다(누수 없음) — 표현식 내부 observer/타이머 disconnect 포함.
- 기존 stabilization(adaptive `minStableMs`)·placeholder·streaming·copy-markdown·image·finalize 동작이 byte 단위로 보존.
- 3차 복구가 timeout을 **숨기지 않는다**(복구 성공만 complete로 승격, 실패는 기존 timeout).
- `chatgpt.mjs` 라인 수가 통제된다 — observer/recovery는 신규 모듈에. 공유 상수는 중복 정의 금지.
- 신규 모듈 < 500 lines.

## B — Build Slices

1. `chatgpt-response-observer.mjs` 순수 helper(`chooseCaptureResult`, `buildResponseObserverExpression`) + 단위 테스트.
2. `observeAssistantResponse` evaluate 경로 + abort 정리.
3. `recoverAssistantResponse` 3차 복구 + 테스트.
4. `chatgpt.mjs`에 race 통합(가드 우선 보존), deadline-복구 연결.
5. 회귀 테스트(observer/recovery 구조 + 기존 chatgpt 스위트).
6. release gates + 타깃 테스트.

## C — Check

Minimum:

```bash
npx vitest run test/unit/web-ai-chatgpt-response-observer.test.mjs test/unit/stability-benchmarks.test.mjs
npm run test:release-gates
git diff --check
```

`chatgpt.mjs` finalize 동작이 바뀌면 추가:

```bash
npx vitest run test/unit/web-ai-chatgpt-archive.test.mjs test/unit/chatgpt-images.test.mjs
```

라이브 검증(수동/스모크, B5): Pro 계정 + 활성 ChatGPT 세션에서 긴 응답/스트리밍 중단 복구율 측정(`devlog/_smoke/`).

## D — Done Criteria

- observer 빠른 경로 + poller race가 동작하고 패자는 항상 정리된다.
- 기존 안정화/placeholder/streaming/copy-markdown/image/finalize 동작이 회귀 없이 보존.
- deadline 초과 시 3차 복구가 best-effort로 동작하되 timeout을 은폐하지 않는다.
- 신규 동작이 단위 테스트로 커버된다(라이브 의존 항목은 B5 수동 프로토콜로 명시).
- `structure/str_func.md` count snapshot 갱신, 파일 추가 시 `bash structure/verify-counts.sh` 통과.
