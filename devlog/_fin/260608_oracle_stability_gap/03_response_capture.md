# 03 — Response Capture Dual-Path

Severity: **P1** — 🟡 **OPEN** (핵심 gap 유효; 2026-06-24 재감사로 2개 표현 정정)

## 2026-06-24 Re-audit (v0.1.15)

핵심 gap(이중 경로 race + 3차 복구)은 **여전히 유효(OPEN)**. 단일 poller 확인:
`grep MutationObserver web-ai/` → **0 hits**, `recoverAssistantResponse`/`pollAssistantCompletion` → 0 hits.
`pollWebAi` 단일 루프(`chatgpt.mjs:359`)가 `stableText`/`stableSince` 안정화로 대기.

단, 아래 원본의 2개 표현은 코드와 어긋나 정정한다:

- **Placeholder 필터링은 "부분적"이 아니라 전용 필터**: `chatgpt.mjs:63-65`
  `PLACEHOLDER_PATTERNS = [/^answer now$/i, /^pro thinking/i]`, `:947`에서 `isFinalAnswer` 경유 적용.
  (원본은 위치를 `answer-artifact.mjs`로 잘못 기재 — 실제는 `chatgpt.mjs`.)
- **Stop button re-wait는 구현됨(✅)**: `isStreaming()`(`chatgpt.mjs:578-584`)이 stop 버튼 가시성으로 게이트,
  생성 중이면 루프가 계속 대기(`chatgpt.mjs:396`). Gap Summary의 "부분적"은 ✅로 본다.

남은 구현 대상(여전히 OPEN, jawdev 후보): MutationObserver 빠른 경로 + poller race, `recoverAssistantResponse` 3차 복구.

> 아래 원본 분석(2026-06-08, v0.1.7 기준)은 역사적 기록으로 보존한다.

## Problem

agbrowse는 응답 캡처를 단일 경로(DOM polling)로 수행한다.
ChatGPT DOM이 예상대로 변하지 않으면 타임아웃으로 실패한다.

## Oracle Approach

### 1. 이중 경로 레이싱 (assistantResponse.ts:50-100)
oracle은 두 경로를 `Promise.race()`로 동시 실행:

```typescript
// Path A: MutationObserver 기반 — DOM 변경 즉시 감지
const evaluationPromise = Runtime.evaluate({
    expression: buildResponseObserverExpression(timeoutMs, ...),
    awaitPromise: true,  // 브라우저 내에서 Promise로 대기
});

// Path B: Snapshot poller 기반 — 주기적 DOM 읽기
const pollerPromise = pollAssistantCompletion(
    Runtime, timeoutMs, minTurnIndex, ...
);

const winner = await Promise.race([evaluationPromise, pollerPromise]);
```

- Path A가 빠르면: poller를 `AbortController`로 중단
- Path B가 빠르면: evaluation을 `terminateRuntimeExecution()`으로 중단
- 둘 다 실패하면: `recoverAssistantResponse()`로 3차 복구 시도

### 2. Placeholder 필터링
```typescript
function isAnswerNowPlaceholderText(normalized: string): boolean {
    // "Pro thinking" 모드의 "Answer now" placeholder를 최종 응답으로 오인하지 않음
    if (text === "chatgpt said:" || text === "chatgpt said") return true;
    if (text.includes("answer now") && text.includes("pro thinking")) return true;
}
```

### 3. 스트리밍 중 추가 대기
```typescript
// 응답이 왔어도 stop 버튼이 보이면 아직 생성 중
const [stopVisible, completionVisible] = await Promise.all([
    isStopButtonVisible(Runtime),
    isCompletionVisible(Runtime),
]);
if (stopVisible) {
    logger("Assistant still generating; waiting for completion");
    const completed = await pollAssistantCompletion(Runtime, remainingMs, ...);
}
```

### 4. Copy 버튼 Markdown 캡처
```typescript
// DOM text 외에 ChatGPT의 Copy 버튼을 프로그래밍 방식으로 클릭해서
// 정확한 Markdown을 clipboard에서 가져옴
export async function captureAssistantMarkdown(Runtime, meta, logger) {
    // buildCopyExpression()으로 Copy 버튼 클릭 → clipboard 읽기
}
```

## agbrowse Current State

### 1. 단일 경로
`chatgpt.mjs`에서 polling 기반 단일 경로로 응답 대기.
MutationObserver 경로 없음.

### 2. Placeholder 필터링
부분적 — `answer-artifact.mjs`에서 일부 처리하지만 oracle만큼 포괄적이지 않음.

### 3. Copy Markdown
`copy-markdown.mjs` 존재 — `--allow-copy-markdown-fallback` 플래그로 사용 가능.
이 부분은 oracle과 유사.

## Gap Summary

| Feature | oracle | agbrowse | Gap |
|---------|--------|----------|-----|
| Dual-path capture | Observer + Poller race | Poller only | **P1** |
| 3rd-tier recovery | `recoverAssistantResponse()` | 없음 | **누락** |
| AbortController cleanup | ✅ | N/A | — |
| Pro thinking placeholder | 전용 필터 | 부분적 | **약함** |
| Stop button re-wait | ✅ | 부분적 | **약함** |
| Copy markdown | ✅ | ✅ (opt-in) | 비슷 |

## Recommended Patches

1. **[다음]** MutationObserver 기반 빠른 경로 추가 (Playwright `page.evaluate` + awaitPromise)
2. **[다음]** 두 경로 race + 패자 cleanup
3. **[다음]** `recoverAssistantResponse` 3차 복구 (마지막 turn 텍스트 재읽기)
4. **[중기]** Pro thinking placeholder 필터 강화
5. **[중기]** streaming 감지 후 추가 대기 로직 강화
