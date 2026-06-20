# Timeout Adaptive Scaling — Root Cause (verified)

> All paths under `web-ai/`. Line numbers observed 2026-06-19; re-verify before editing.

## Where model + effort + timeout are all known at once

The single join point is the dispatch layer that builds `input` — `web-ai/cli.mjs:630-689` (CLI) and `web-ai/mcp-server.mjs:207` (MCP). `model`, `reasoningEffort`, `vendor`, and `research` are all in scope there. After this point each provider's `poll` runs blind to the tier.

## Gap 1 — Fixed poll timeout, ignores model/effort

`chatgpt.mjs:327-329` (poll entry) uses a flat default:

```js
export async function pollWebAi(deps, input = {}) {
    const vendor = input.vendor || 'chatgpt';
    const timeout = Math.max(1, Number(input.timeout || 1200));   // flat 1200s
```

Same pattern in the other providers:
- `grok-live.mjs:267` → `Number(input.timeout || input.thinkingTime || 600) * 1000` — **600s shared by `expert` AND `heavy`** (aliases resolve together in `grok-model.mjs:24-50` with no per-tier timeout).
- `gemini-live.mjs:439` → `Number(input.timeout || input.thinkingTime || 1200) * 1000` — `thinkingTime` is used only as a fallback constant, never to scale Deep Think vs Flash.

The session-level helper is also flat per-vendor — `session.mjs:322`:

```js
const VENDOR_DEFAULT_TIMEOUT_SEC = { chatgpt: 1200, gemini: 1200, grok: 600 };
```

`resolveDeadlineAt` (`session.mjs:329-334`) only reads `input.timeout` or this table — **no model/effort dimension**.

## Gap 2 — `reasoningEffort` is tracked but never scales the timeout

Parsed at `cli.mjs:663` (`reasoningEffort: values.effort || values['reasoning-effort']`), threaded into send at `chatgpt.mjs:178`:

```js
const selectedModel = await selectChatGptModel(page, input.model, { effort: input.reasoningEffort });
```

Inside `chatgpt-model.mjs:6-7,105-189` it is already normalized into tier-grade enums — `ModelChoice = 'instant'|'thinking'|'pro'`, `EffortChoice = 'light'|'standard'|'extended'|'heavy'`. **The system already knows the exact tier.** But `selectChatGptModel`'s return is consumed only for warnings (`chatgpt.mjs:309-312`) and is never passed to `pollWebAi`. The signal exists and is discarded.

## Gap 3 — Stability heuristic is text-length based → false "complete" on a mid-stream pause

`chatgpt.mjs:386-398`:

```js
const streaming = await isStreaming(page);
const finished = !streaming && latest ? await isResponseFinished(page) : false;
if (latest && !streaming) {
    if (latest === stableText) {
        const textLen = latest.length;
        const minStableMs = finished
            ? 1000
            : textLen < 16 ? 8000 : textLen < 40 ? 3000 : textLen < 500 ? 2000 : 3000;
        if (elapsedStable >= minStableMs) { /* declare complete */ }
```

The grace window keys off **`textLen`, not thinking state**. Signals available:
- `isStreaming` (`chatgpt.mjs:547-553`) — checks only the **stop button** (`CHATGPT_STOP_SELECTORS`, `:106-109`).
- `isResponseFinished` (`chatgpt.mjs:558-581`) — checks post-completion action buttons (`FINISHED_ACTIONS_SELECTOR`, `:55-60`: copy / 👍 / 👎 / Share).
- `PLACEHOLDER_PATTERNS` (`chatgpt.mjs:62-78`) — only filters *pure-placeholder* turns (`/^thinking$/i`, `/^reasoning$/i`, `/^pro thinking/i`…).

**Failure mode:** a reasoning model emits an intermediate chunk, then **hides the stop button while it thinks** before resuming. At that instant `streaming===false` and `finished===false`; if the partial text is ≥500 chars it needs only **3000ms** of stability to be falsely declared complete. A real partial answer with substantive text passes `isFinalAnswer` (`chatgpt.mjs:915-917`) and is eligible for early completion. Grok is weaker still — a flat `>= 1500ms` with no `finished` check (`grok-live.mjs:278`).

This is the user's "이게 중간 응답도 있잖아" concern, located precisely: **absence-of-stop-button is not a done-signal by itself** for reasoning models.

## Gap 4 — Fixed 500ms poll interval, no backoff

`chatgpt.mjs:483` → `await page.waitForTimeout(500)` (also `grok-live.mjs:316`; Gemini flat `2_000` at `gemini-live.mjs:479`). A pro tier raised to 3600s would run **~7200 polls**, each a full DOM round-trip (`readAssistantMessages` + `isStreaming` + `isResponseFinished`) — wasteful and noisy.

## Gap 5 — Deep Research shares the same base timeout

`chatgpt.mjs:635` → `Number(input.timeout || 1200) * 1000`, passed to `sendDeepResearch` (own default `1_200_000` at `chatgpt-deep-research.mjs:207`, flat `waitForTimeout(2000)` poll at `:278`). Deep Research gets no dedicated tier; it inherits the same 1200s base as a thinking query.

## Evidence index

`chatgpt.mjs` 327-329, 178, 55-60, 62-78, 106-109, 386-398, 483, 547-553, 558-581, 635, 915-917 · `grok-live.mjs` 267, 278, 316 · `gemini-live.mjs` 439, 479 · `session.mjs` 322, 329-334 · `chatgpt-model.mjs` 6-7, 105-189 · `grok-model.mjs` 24-50 · `chatgpt-deep-research.mjs` 207, 278 · `cli.mjs` 630-689 (esp. 641, 663) · `mcp-server.mjs` 207.
