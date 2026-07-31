---
created: 2026-06-25
status: planning
tags: [agbrowse, web-ai, chatgpt, patch-plan]
---
# Patch Plan

## Part 1 — Easy Explanation

`agbrowse` must never say a ChatGPT answer is complete while the page still says
`Stop answering`.

The fix has two parts. First, read ChatGPT assistant turns as real top-level
turns, not as nested paragraph fragments. Second, make timeout recovery a
non-terminal rescue unless the page proves generation has stopped. The watcher
should then treat "still streaming" as polling, not complete.

## Part 2 — Diff-Level Precision

### MODIFY `web-ai/chatgpt.mjs`

#### 1. Replace duplicate-prone assistant extraction everywhere

Current shape:

```js
async function readAssistantMessages(page) {
    const evaluated = await page.evaluate((selectors) => {
        for (const selector of selectors) {
            const texts = Array.from(document.querySelectorAll(selector))
                .map(el => String(el.innerText || el.textContent || '').trim())
                .filter(Boolean);
            if (texts.length) return texts;
        }
        return [];
    }, ASSISTANT_SELECTORS).catch(() => []);
    if (Array.isArray(evaluated) && evaluated.length) return evaluated.map(cleanAssistantText).filter(Boolean);
    ...
}
```

Planned shape:

```js
async function readAssistantMessages(page) {
    const evaluated = await page.evaluate((selectors) => {
        const isInsideAnotherMatchedNode = (el, matched) =>
            matched.some(other => other !== el && other.contains(el));

        for (const selector of selectors) {
            const matched = Array.from(document.querySelectorAll(selector));
            const topLevel = matched.filter(el => !isInsideAnotherMatchedNode(el, matched));
            const texts = topLevel
                .map(el => String(el.innerText || el.textContent || '').trim())
                .filter(Boolean);
            if (texts.length) return texts;
        }
        return [];
    }, ASSISTANT_SELECTORS).catch(() => []);
    if (Array.isArray(evaluated) && evaluated.length) return evaluated.map(cleanAssistantText).filter(Boolean);
    ...
}
```

Expected effect:

- One visible ChatGPT assistant answer should produce one assistant message.
- Nested paragraphs inside the same turn should not become separate answers.
- `baseline.assistantCount` remains meaningful.

Implementation detail:

- Extract a small shared helper for top-level assistant DOM extraction, or keep
  one shared in-page expression used by both `readAssistantMessages()` and
  `recoverAssistantResponse()`.
- The Playwright locator fallback in `readAssistantMessages()` must receive the
  same descendant-dedup behavior. Do not fix only the `page.evaluate` path.
- Recovery must use the same selector set as polling, including:

```js
const ASSISTANT_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-turn="assistant"]',
  'article[data-testid^="conversation-turn"]',
];
```

Risk:

- If ChatGPT emits sibling assistant nodes for separate internal phases, this
  filter may collapse only parent/child duplicates, not siblings. That is
  intentional and low risk.

#### 2. Export or share streaming/finished helpers for recovery

Current `isStreaming(page)` and `isResponseFinished(page)` are local helpers.
Recovery cannot check them.

Plan:

- Export a narrow helper or pass a callback into recovery:

```js
const recovered = await recoverAssistantResponse(page, {
  baselineAssistantCount: baseline.assistantCount,
  isFinalAnswer,
  readStreaming: () => isStreaming(page),
  readFinished: () => isResponseFinished(page),
});
```

Prefer callback injection to avoid import cycles.

#### 3. Make timeout recovery non-terminal while streaming

Current recovery branch:

```js
if (recovered?.text) {
    const answerText = recovered.text;
    if (!input.skipFinalize) {
        await finalizeProviderTab(...);
    }
    return withAnswerArtifact({
        ok: true,
        status: 'complete',
        warnings: ['response-recovered-after-timeout'],
        responseStableMs: 0,
    });
}
```

Planned behavior:

```js
if (recovered?.streaming === true) {
    const current = getSession(session.sessionId) || session;
    updateSession(session.sessionId, {
        status: 'polling',
        warnings: appendUniqueWarningLocal(current.warnings || [], 'recovery-deferred-streaming'),
    });
    return {
        ok: true,
        vendor,
        status: 'polling',
        sessionId: session.sessionId,
        answerText: recovered.text || '',
        warnings: ['recovery-deferred-streaming'],
        recoverable: true,
        retryHint: 'watch-or-poll',
    };
}

if (recovered?.text && recovered.finished === true) {
    // existing finalize complete path
}
```

Completion is allowed only when:

- stop/streaming indicator is absent; and
- either response action buttons indicate finished, or text has been stable for
  a minimum recovery window.

Minimum recovery stability:

- For recovery text under 500 chars: 3000ms.
- For recovery text 500+ chars: 5000ms.
- Never `complete` with `responseStableMs: 0`.

Required recovery branches:

```text
streaming === true
  -> return polling/recoverable; do not finalize

streaming === false && finished === true
  -> complete is allowed

streaming === false && finished !== true
  -> either run a bounded stability re-read loop, or return polling/recoverable
     so the next watch tick can prove completion
```

Do not let `recovered.text && !streaming && !finished` fall through to complete.
`appendUniqueWarningLocal` can be a tiny local helper in `chatgpt.mjs`, or a
shared session-warning helper if the implementation extracts one. Do not import
the private `appendUniqueWarning()` from `watcher.mjs` without first exporting
or relocating it.

Post-timeout copy-markdown path:

- The existing post-timeout `allowCopyMarkdownFallback && stableText` branch
  must obey the same finality rule.
- It may complete only with no streaming indicator and a non-zero stability
  window, or it must return timeout/polling.

#### 4. Preserve existing authoritative poller semantics

Do not let observer or recovery override these existing guards:

- target mismatch
- conversation mismatch
- tab crash
- placeholder rejection
- copy-markdown explicit opt-in
- downloadable file/image capture after true completion

### MODIFY `web-ai/chatgpt-response-observer.mjs`

#### 1. Recovery should read top-level assistant messages

Current recovery:

```js
const sel = '[data-message-author-role="assistant"], [data-turn="assistant"]';
return Array.from(document.querySelectorAll(sel))
    .slice(minIdx)
    .map((n) => (n.innerText || '').trim())
    .filter(Boolean);
```

Planned behavior:

- Use the same top-level filtering rule as `readAssistantMessages()`.
- Prefer a shared in-page function string if duplication can stay small.
- Return metadata, not only text:

```js
{
  from: 'recovery',
  text,
  recovered: true,
  streaming,
  finished,
  responseStableMs
}
```

#### 2. Recovery must not finalize while stop button exists

Recovery should return `{ streaming: true }` when any ChatGPT stop selector is
visible. The caller must keep session status non-terminal.

### MODIFY `web-ai/watcher.mjs`

Add a defensive layer. Even if a vendor poll returns `complete`, the watcher
should inspect live streaming state before terminalizing if the page still has a
vendor-specific in-flight indicator.

Planned shape inside `watchSessionOnce()` after `pollResult`:

```js
const stillStreaming = await hasStreamingIndicator(page, vendor);
if (pollResult.status === 'complete' && stillStreaming) {
    updateSession(session.sessionId, {
        status: 'polling',
        warnings: appendUniqueWarning(refreshed.warnings || [], 'watcher-complete-deferred-streaming'),
    });
    status = 'polling';
}
```

This is a belt-and-suspenders guard. The main fix is still in the provider
poller.

Implementation detail:

- Add `hasStreamingIndicator(page, vendor)` in `watcher.mjs` or a small helper
  module.
- Reuse vendor-specific selector contracts; do not treat all vendors the same.
- For this patch, ChatGPT is load-bearing. Grok can use its existing stop
  selectors. Gemini needs care because `GEMINI_STREAMING_SELECTORS` includes
  completion-state selectors; do not blindly classify those as in-flight.
- The guard must force both:

```js
status = 'polling';
updateSession(session.sessionId, { status: 'polling', ... });
terminal = false;
```

- The guard does not replace the provider poller fix because `finalizeProviderTab`
  may already have written `complete` before watcher sees the result.

### ADD tests

#### NEW `test/unit/web-ai-chatgpt-response-fragments.test.mjs`

Cases:

- nested assistant nodes are de-duplicated so one visible turn returns one
  message;
- last paragraph fragment is not selected as final answer;
- baseline slicing still sees a new top-level answer after prior completed
  answers.
- Playwright fallback path applies the same descendant de-duplication.

#### MODIFY/ADD `test/unit/web-ai-chatgpt-response-observer.test.mjs`

Cases:

- `recoverAssistantResponse()` returns non-terminal metadata when stop button is
  visible;
- recovery rejects placeholder text;
- recovery never returns terminal completion with `responseStableMs: 0`;
- recovery prefers top-level assistant text over nested child fragments.
- recovery and poll use the same assistant selector set.
- post-timeout copy-markdown path does not complete while streaming.

#### MODIFY `test/unit/web-ai-watcher.test.mjs`

Cases:

- if vendor poll returns `complete` but streaming indicator is visible, watcher
  returns `status: polling`, `terminal: false`;
- if vendor poll returns `complete` and no streaming indicator is visible,
  watcher remains terminal.
- vendor-specific streaming helper does not treat Gemini completion footer as
  in-flight.

### MODIFY structure docs after implementation

After code changes, update line counts and behavior docs:

```text
structure/str_func.md
structure/phase_status.md
```

Only update these in Build after code changes exist.

## Verification Commands

Targeted:

```bash
npx vitest run test/unit/web-ai-chatgpt-response-observer.test.mjs test/unit/web-ai-chatgpt-response-fragments.test.mjs test/unit/web-ai-watcher.test.mjs --reporter=verbose
```

Regression:

```bash
npx vitest run test/unit/web-ai-provider-session.test.mjs test/unit/chatgpt-attachments.test.mjs test/unit/web-ai-navigation-ready.test.mjs --reporter=verbose
npm run test:release-gates
```

Full gate before push/release:

```bash
npm test
npm run gate:all
```

Live proof after patch:

```bash
SID=$(agbrowse web-ai send --vendor chatgpt --model pro --effort extended --file /tmp/long-review.zip --prompt "..." --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 30 --navigate --json
```

Expected during ongoing generation:

```json
{
  "status": "polling",
  "recoverable": true
}
```

Expected after ChatGPT removes `Stop answering` and the answer stabilizes:

```json
{
  "status": "complete",
  "responseStableMs": 1000
}
```

The live proof is required for this patch class. Unit tests alone are not enough
because the incident was caused by real ChatGPT DOM nesting.

Save live evidence under:

```text
devlog/_smoke/260625_webai_streaming_recovery_false_complete/
```

Suggested artifact layout:

```text
01_streaming_dom_snapshot.json
02_poll_while_stop_visible.json
03_watch_while_stop_visible.json
04_final_poll_complete.json
05_notes.md
```

## A — Plan Audit Checklist

- Assistant extraction uses one top-level de-duplication rule across poll,
  recovery, and fallback.
- Recovery cannot call `finalizeProviderTab()` while streaming is visible.
- Recovery has an explicit `!streaming && !finished` non-terminal or stability
  branch.
- Post-timeout copy-markdown fallback follows the same finality rule.
- Watcher guard is secondary and vendor-safe.
- `--web-search` composer failure remains out of scope.
- Live smoke evidence path is defined under `devlog/_smoke/`.

## B — Build Slices

1. Add or extract top-level assistant DOM extraction helper and cover poll +
   fallback + recovery.
2. Extend recovery metadata with `streaming`, `finished`, and non-zero
   stability semantics.
3. Patch `pollWebAi()` timeout recovery and post-timeout copy-markdown paths so
   they defer instead of completing while streaming or unproven.
4. Add watcher defensive downgrade for complete-plus-streaming, using
   vendor-safe selectors.
5. Add/extend unit tests for fragments, recovery, watcher guard, and
   copy-markdown timeout.
6. Update structure docs and run targeted gates.
7. Capture live smoke evidence.

## C — Check

Run:

```bash
npx vitest run test/unit/web-ai-chatgpt-response-observer.test.mjs test/unit/web-ai-chatgpt-response-fragments.test.mjs test/unit/web-ai-watcher.test.mjs --reporter=verbose
npx vitest run test/unit/web-ai-provider-session.test.mjs test/unit/chatgpt-attachments.test.mjs test/unit/web-ai-navigation-ready.test.mjs --reporter=verbose
npm run test:release-gates
git diff --check
```

Before push/release:

```bash
npm test
npm run gate:all
```

## D — Done Criteria

- `agbrowse poll/watch` never emits `complete` while ChatGPT exposes `Stop
  answering`.
- Full top-level assistant answer is captured, not the last nested paragraph.
- Timeout recovery still rescues final answers when finality is proven.
- Watcher does not emit `watch.complete` for complete-plus-streaming.
- Unit gates and release gates pass.
- Live smoke evidence is saved under the agreed `_smoke` folder.
