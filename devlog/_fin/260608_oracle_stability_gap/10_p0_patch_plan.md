# 10 — P0 Patch Plan: Send Button Timeout + Selector Hardening

Date: 2026-06-08
Status: ✅ **DONE** — 6개 변경 전부 agbrowse v0.1.15에 반영됨 (2026-06-24 재감사)

## 2026-06-24 재감사 (v0.1.15)

이 계획의 6개 변경이 모두 코드에 존재한다. 아래 "Re-assessment"의 중간값(5s/15s,
"line 173/207")은 역사적 기록이며, 최종값 **20s(텍스트) / 45s(첨부)** 가 반영되었다.

| 계획 변경 | 현재 상태 | 증거 |
| --- | --- | --- |
| Change 1/2 — timeout 파라미터화 | ✅ | `clickEnabledSendButton(page, timeoutMs = 8_000)` (`chatgpt-composer.mjs:355`), caller가 `options.sendButtonTimeoutMs` 전달 |
| Change 3 — 셀렉터 확장 | ✅ | `form button[type="submit"]` (`:67`), `'button[aria-label*="Send" i]'` (`:69`) |
| Change 4 — typedef `sendButtonTimeoutMs` | ✅ | `chatgpt-composer.mjs` ComposerOptions |
| Change 5 — timeout 값 상향 5/15s → 20/45s | ✅ | `return ... ? 45_000 : 20_000` (`chatgpt-attachments.mjs:240`) |
| Change 6 — submitPrompt에 timeout 전달 | ✅ | `submitTimeoutMs = sendButtonTimeoutMs(uploadPaths)` (`chatgpt.mjs:274`) |

회귀 검증: `test/unit/stability-benchmarks.test.mjs` 22/22 통과.

## Re-assessment

초기 분석에서 agbrowse가 누락한 것으로 보였던 기능들이 실제로는 구현되어 있음:

- ✅ Enter key fallback — `submitPromptFromComposer()` line 173
- ✅ Attachment chip verification — `waitForAttachmentAcceptedLive()` 45s timeout
- ✅ `sendButtonTimeoutMs()` — 5s(text) / 15s(attachment)
- ✅ Multi-signal commit verification — turns + prompt text + stop button + composer cleared
- ✅ Post-send attachment evidence check — `verifySentTurnAttachmentLive()`

## Actual Gaps (3건)

### Gap 1: `clickEnabledSendButton` 8s 하드코딩
- 현재: `const deadline = Date.now() + 8_000;` (고정)
- 문제: 첨부파일 업로드 후 Pro 모드 전환 시 button disabled 기간이 8초 초과 가능
- Oracle: 20s(text) / 45s(attachment) + configurable

### Gap 2: `SEND_BUTTON_SELECTORS` 범위
- 현재: `'button[aria-label*="Send prompt" i]'`, `'button[aria-label*="Send message" i]'`
- Oracle 추가: `'form button[type="submit"]'`, `'button[aria-label*="Send"]'` (더 넓음)

### Gap 3: `sendButtonTimeoutMs` 값 보수적
- 현재: 5s(text) / 15s(attachment)
- Oracle: 20s(text) / 45s(attachment)

## Plan

### MODIFY: `web-ai/chatgpt-composer.mjs`

**Change 1** — `clickEnabledSendButton` timeout을 파라미터로 수용

```diff
- async function clickEnabledSendButton(page) {
-     const deadline = Date.now() + 8_000;
+ async function clickEnabledSendButton(page, timeoutMs = 8_000) {
+     const deadline = Date.now() + timeoutMs;
```

**Change 2** — `submitPromptFromComposer`에서 timeout 전달

```diff
  export async function submitPromptFromComposer(page, options = {}) {
      if (options.sendTarget?.selector) { ... }
-     const clicked = await clickEnabledSendButton(page);
+     const sendTimeoutMs = options.sendButtonTimeoutMs || 8_000;
+     const clicked = await clickEnabledSendButton(page, sendTimeoutMs);
      if (clicked) return { method: 'button' };
```

**Change 3** — `SEND_BUTTON_SELECTORS` 확장

```diff
  export const SEND_BUTTON_SELECTORS = [
      'button[data-testid="send-button"]',
      'button[data-testid*="composer-send"]',
+     'form button[type="submit"]',
      'button[type="submit"][data-testid*="send"]',
-     'button[aria-label*="Send prompt" i]',
-     'button[aria-label*="Send message" i]',
+     'button[aria-label*="Send" i]',
  ];
```

**Change 4** — `ComposerOptions` typedef에 `sendButtonTimeoutMs` 추가

```diff
  @typedef {Object} ComposerOptions
  ...
  @property {number} [timeoutMs]
  @property {number} [baselineTurns]
+ @property {number} [sendButtonTimeoutMs]
```

### MODIFY: `web-ai/chatgpt-attachments.mjs`

**Change 5** — `sendButtonTimeoutMs` 값 상향

```diff
  export function sendButtonTimeoutMs(fileNames = []) {
-     return Array.isArray(fileNames) && fileNames.length > 0 ? 15_000 : 5_000;
+     return Array.isArray(fileNames) && fileNames.length > 0 ? 45_000 : 20_000;
  }
```

### MODIFY: `web-ai/chatgpt.mjs`

**Change 6** — `submitPrompt`에 `sendButtonTimeoutMs` 전달

```diff
  await adapter.submitPrompt({
      sendTarget: sendResolution?.target || null,
+     sendButtonTimeoutMs: sendButtonTimeoutMs(uploadPath ? [uploadPath] : []),
  });
```

## Summary

| File | Changes |
|------|---------|
| `web-ai/chatgpt-composer.mjs` | timeout 파라미터화 + 셀렉터 확장 |
| `web-ai/chatgpt-attachments.mjs` | timeout 값 상향 (5/15s → 20/45s) |
| `web-ai/chatgpt.mjs` | submitPrompt에 timeout 전달 |

총 변경량: ~15줄. 기존 로직의 파라미터 조정이 핵심. 새로운 기능 추가 없음.
