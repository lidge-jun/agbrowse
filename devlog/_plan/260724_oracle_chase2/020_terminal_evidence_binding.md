# 020 — Terminal Evidence Binding

Status: D (diff-level implementation roadmap)
Format: DIFFLEVEL-ROADMAP-01
Work-phase: WP3
Upstream predicates verified with `git show 67da293a 9454ef4d` in `/tmp/oracle-chase-260724`.

## Objective

Finalize a ChatGPT text response only when positive completion controls are scoped to the exact assistant response whose text is being accepted. Text stability remains a debounce requirement, not completion proof. Remove the normal-loop and timeout-recovery paths that accept `finished=false`, while preserving the independently gated generated-image collection/completion path after terminal proof.

The response reader must expose text plus `messageId`, `turnId`, and turn index. `isResponseFinished()` must receive that sampled identity and return a correlated completion result, not a page-global boolean. If identity is absent, it may use the baseline turn index, but an old response action bar must never prove a new sample complete.

## Gaps covered

| Gap | Required closure |
| --- | --- |
| G5 | Stable text with `finished=false` cannot finalize in the normal poll loop or timeout recovery; require positive response-scoped completion proof. |
| G6 | Bind finished controls to the same sampled response identity, with baseline-index fallback only when identity is unavailable. |

## File change map

| Path | Action | Current path:line anchor | Functions / constants |
| --- | --- | --- | --- |
| `web-ai/chatgpt-response-dom.mjs` | MODIFY | `web-ai/chatgpt-response-dom.mjs:3-7`, `web-ai/chatgpt-response-dom.mjs:14-40`, `web-ai/chatgpt-response-dom.mjs:42-73` | add `ChatGptAssistantSnapshot` typedef; add `readTopLevelAssistantSnapshots()`; keep text readers as compatibility projections |
| `web-ai/chatgpt.mjs` | MODIFY | `web-ai/chatgpt.mjs:55-60`, `web-ai/chatgpt.mjs:607-634`, `web-ai/chatgpt.mjs:765-810`, `web-ai/chatgpt.mjs:967-993` | response-DOM imports; authoritative poll loop; timeout recovery call/gate; `isResponseFinished()` |
| `web-ai/chatgpt-response-observer.mjs` | MODIFY | `web-ai/chatgpt-response-observer.mjs:13-17`, `web-ai/chatgpt-response-observer.mjs:88-145`, `web-ai/chatgpt-response-observer.mjs:170-180`, `web-ai/chatgpt-response-observer.mjs:182-189` | `recoverAssistantResponse()`; `readFinishedState()`; remove quiet-window completion proof and `recoveryStabilityWindowMs()` |
| `test/unit/web-ai-chatgpt-response-fragments.test.mjs` | MODIFY | `test/unit/web-ai-chatgpt-response-fragments.test.mjs:1-6`, `test/unit/web-ai-chatgpt-response-fragments.test.mjs:8-59`, `test/unit/web-ai-chatgpt-response-fragments.test.mjs:61-90` | snapshot identity extraction and compatibility projection tests |
| `test/unit/web-ai-chatgpt-response-observer.test.mjs` | MODIFY | `test/unit/web-ai-chatgpt-response-observer.test.mjs:53-130`, `test/unit/web-ai-chatgpt-response-observer.test.mjs:132-159` | recovery refuses stable unverified text; accepts only correlated completion proof |
| `test/integration/web-ai-fake-chatgpt.test.mjs` | MODIFY | `test/integration/web-ai-fake-chatgpt.test.mjs:5-62`, `test/integration/web-ai-fake-chatgpt.test.mjs:64-109`, `test/integration/web-ai-fake-chatgpt.test.mjs:112-169` | existing send/poll scenario; `createFakeChatGptPage()`; `createFakeLocator()` and `commitPrompt()`; add old-action-bar/new-response identity regression scenario |

## Proposed diffs

### 1. Extract response snapshots, not text-only rows

In `web-ai/chatgpt-response-dom.mjs`, add an identity-bearing snapshot reader. Identity is resolved from the top-level assistant node or its nearest identity-bearing descendant; `turnIndex` is the top-level index in the active selector result.

After:

```js
/**
 * @typedef {object} ChatGptAssistantSnapshot
 * @property {string} text
 * @property {string|null} messageId
 * @property {string|null} turnId
 * @property {number} turnIndex
 */

/**
 * Browser-context helper. Keep this self-contained so Playwright can serialize it.
 * @param {string[]} selectors
 * @returns {ChatGptAssistantSnapshot[]}
 */
export function readTopLevelAssistantSnapshots(selectors) {
    const activeSelectors = Array.isArray(selectors) && selectors.length
        ? selectors
        : [
            '[data-message-author-role="assistant"]',
            '[data-turn="assistant"]',
            'article[data-testid^="conversation-turn"]',
        ];
    const isInsideAnotherMatchedNode = (/** @type {any} */ el, /** @type {any[]} */ matched) =>
        matched.some(other => other !== el && typeof other.contains === 'function' && other.contains(el));
    const identityFor = (/** @type {Element} */ node) => {
        const messageNode = node.matches('[data-message-id]')
            ? node
            : node.querySelector('[data-message-id]');
        const turnNode = node.matches('[data-testid^="conversation-turn"]')
            ? node
            : node.querySelector('[data-testid^="conversation-turn"]');
        return {
            messageId: messageNode?.getAttribute('data-message-id') || null,
            turnId: turnNode?.getAttribute('data-testid') || null,
        };
    };

    for (const selector of activeSelectors) {
        const matched = Array.from(document.querySelectorAll(selector));
        const topLevel = matched.filter(el => !isInsideAnotherMatchedNode(el, matched));
        const snapshots = topLevel.map((node, turnIndex) => {
            const text = String((/** @type {any} */ (node)).innerText || node.textContent || '').trim();
            return { text, ...identityFor(node), turnIndex };
        }).filter(snapshot => Boolean(snapshot.text));
        if (snapshots.length) return snapshots;
    }
    return [];
}
```

Project the existing text API from snapshots so all consumers retain exact behavior:

Before:

```js
export function readTopLevelAssistantTexts(selectors) {
    // independent selector/de-duplication implementation
}
```

After:

```js
export function readTopLevelAssistantTexts(selectors) {
    return readTopLevelAssistantSnapshots(selectors).map(snapshot => snapshot.text);
}
```

The locator fallback may remain text-only because the authoritative identity gate uses `page.evaluate`; on evaluate failure it must fail closed rather than fabricate identity.

### 2. Bind normal polling to the sampled snapshot

Import `readTopLevelAssistantSnapshots` into `chatgpt.mjs` and add:

```js
/**
 * @param {any} page
 * @returns {Promise<import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot[]>}
 */
async function readAssistantSnapshots(page) {
    try {
        return await page.evaluate(readTopLevelAssistantSnapshots, CHATGPT_ASSISTANT_SELECTORS);
    } catch {
        return [];
    }
}
```

Replace the current text-only sampling at lines 607-617:

Before:

```js
const answers = await readAssistantMessages(page);
const newAnswers = answers.slice(baseline.assistantCount).filter(isFinalAnswer);
const latest = newAnswers.at(-1) || '';
const streaming = await isStreaming(page);
// ...
const finished = !streaming && latest ? await isResponseFinished(page) : false;
```

After:

```js
const snapshots = await readAssistantSnapshots(page);
const newSnapshots = snapshots
    .slice(baseline.assistantCount)
    .filter(snapshot => isFinalAnswer(snapshot.text));
const latestSnapshot = newSnapshots.at(-1) || null;
const latest = latestSnapshot?.text || '';
const streaming = await isStreaming(page);
const now = Date.now();
if ((streaming || latest) && now - lastHeartbeat >= 30_000) {
    const elapsed = Math.round((now - startedAt) / 1000);
    process.stderr.write(`[poll] ${elapsed}s — ${streaming ? 'streaming' : 'stabilizing'}...\n`);
    lastHeartbeat = now;
}
const completion = !streaming && latestSnapshot
    ? await isResponseFinished(page, latestSnapshot, baseline.assistantCount)
    : { finished: false, messageId: null, turnId: null, turnIndex: -1 };
const finished = completion.finished === true;
```

Replace quiet-only acceptance at lines 624-634:

Before:

```js
const minStableMs = finished
    ? 1000
    : textLen < 16 ? 8000
    : textLen < 40 ? 3000
    : textLen < 500 ? 2000
    : 3000;
if (elapsedStable >= minStableMs) {
```

After:

```js
const minStableMs = 1000;
if (finished && elapsedStable >= minStableMs) {
```

The stable-text clock remains a debounce against transient action controls; it no longer substitutes for them.

### 3. Correlate completion controls inside `isResponseFinished()`

Replace current `isResponseFinished(page)` at lines 970-993 with an identity-aware result:

```js
/**
 * @param {any} page
 * @param {import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot} sample
 * @param {number} minTurnIndex
 * @returns {Promise<{ finished: boolean, messageId: string|null, turnId: string|null, turnIndex: number }>}
 */
async function isResponseFinished(page, sample, minTurnIndex) {
    try {
        return await page.evaluate(
            ({ finishedSelector, sample, minTurnIndex }) => {
                const ASSISTANT_TURN_SELECTORS = [
                    '[data-message-author-role="assistant"]',
                    '[data-turn="assistant"]',
                    'article[data-testid^="conversation-turn"]',
                ];
                const matched = Array.from(document.querySelectorAll(ASSISTANT_TURN_SELECTORS.join(', ')));
                const turns = matched.filter(node =>
                    !matched.some(other => other !== node && other.contains(node)));
                for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex--) {
                    const turn = turns[turnIndex];
                    const messageNode = turn.matches('[data-message-id]')
                        ? turn
                        : turn.querySelector('[data-message-id]');
                    const turnNode = turn.matches('[data-testid^="conversation-turn"]')
                        ? turn
                        : turn.querySelector('[data-testid^="conversation-turn"]');
                    const messageId = messageNode?.getAttribute('data-message-id') || null;
                    const turnId = turnNode?.getAttribute('data-testid') || null;
                    const hasSampleIdentity = Boolean(sample.messageId || sample.turnId);
                    const identityMatches = (!sample.messageId || sample.messageId === messageId)
                        && (!sample.turnId || sample.turnId === turnId);
                    if (hasSampleIdentity ? !identityMatches : turnIndex < minTurnIndex) continue;
                    const finished = Boolean(turn.querySelector(finishedSelector));
                    return { finished, messageId, turnId, turnIndex };
                }
                return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
            },
            { finishedSelector: FINISHED_ACTIONS_SELECTOR, sample, minTurnIndex },
        );
    } catch {
        return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
    }
}
```

The function both takes and returns identity. Callers accept only `completion.finished === true`; tests can assert which turn supplied the evidence. If a sample has one identity field, only that field is required; if it has both, both must match. Without identity, `turnIndex >= baseline.assistantCount` is mandatory.

### 4. Recovery carries the same snapshot and proof

In `chatgpt-response-observer.mjs`, import `readTopLevelAssistantSnapshots`. Change the option/result contracts:

```js
/**
 * @param {{ baselineAssistantCount?: number, isFinalAnswer?: (text: string) => boolean, readStreaming?: () => Promise<boolean>|boolean, readFinished?: (sample: import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot) => Promise<boolean>|boolean }} [opts]
 * @returns {Promise<{ from: 'recovery', text: string, sample: import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot, recovered: true, streaming: boolean, finished: boolean, responseStableMs: number } | null>}
 */
```

Replace `readCandidates()` and the stability recovery block:

```js
const readCandidates = async () => {
    let snapshots;
    try {
        snapshots = await page.evaluate(readTopLevelAssistantSnapshots, CHATGPT_ASSISTANT_SELECTORS);
    } catch {
        return [];
    }
    if (!Array.isArray(snapshots) || !snapshots.length) return [];
    return snapshots.slice(minIdx).filter(sample => {
        if (!sample?.text) return false;
        return typeof isFinalAnswer === 'function' ? isFinalAnswer(sample.text) : true;
    });
};

const candidates = await readCandidates();
const sample = candidates.at(-1) || null;
if (!sample?.text) return null;
const streaming = await readStreamingState(page, readStreaming);
if (streaming) {
    return {
        from: 'recovery', text: sample.text, sample, recovered: true,
        streaming: true, finished: false, responseStableMs: 0,
    };
}
const finished = await readFinishedState(readFinished, sample);
return {
    from: 'recovery', text: sample.text, sample, recovered: true,
    streaming: false, finished, responseStableMs: finished ? 1 : 0,
};
```

Update the helper:

```js
/**
 * @param {((sample: import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot) => Promise<boolean>|boolean)|undefined} readFinished
 * @param {import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot} sample
 */
async function readFinishedState(readFinished, sample) {
    if (typeof readFinished !== 'function') return false;
    try {
        return Boolean(await readFinished(sample));
    } catch {
        return false;
    }
}
```

Delete `recoveryStabilityWindowMs()` and the `stabilityWindowMs` option. In `chatgpt.mjs`, bind the recovery callback:

```js
readFinished: async sample => {
    const completion = await isResponseFinished(page, sample, baseline.assistantCount);
    return completion.finished === true;
},
```

Replace current recovery acceptance at lines 785-810:

Before:

```js
const canComplete = recovered.finished === true || Number(recovered.responseStableMs || 0) > 0;
```

After:

```js
const canComplete = recovered.finished === true;
```

Keep the existing deferred `recovery-deferred-unverified` branch unchanged for `finished=false`.

### 5. Preserve generated-image completion

Do not change `collectImages()` or the generated-image normalization/capture block at current `web-ai/chatgpt.mjs:653-693`. It runs after scoped terminal proof and remains the separately tested artifact-completion path. Do not reinterpret image chrome text stability as terminal proof. Existing `test/unit/chatgpt-images.test.mjs` remains in the verification set.

## Test plan

Run focused unit tests:

```sh
npx vitest run test/unit/web-ai-chatgpt-response-fragments.test.mjs test/unit/web-ai-chatgpt-response-observer.test.mjs test/unit/chatgpt-images.test.mjs
```

Run the fake-provider integration regression:

```sh
npx vitest run test/integration/web-ai-fake-chatgpt.test.mjs
```

Then run the broader unit suite:

```sh
npm run test:unit
```

New focused test names:

- `extracts message id, turn id, and top-level turn index with assistant text`
- `keeps readTopLevelAssistantTexts as a snapshot projection`
- `does not recover stable text without scoped finished proof`
- `passes the recovered sample identity into readFinished`
- `recovers when the same sampled response has finished controls`
- `rejects an older response action bar for a newer sampled response`
- `accepts identity-less completion only at or after the assistant baseline`
- `preserves generated-image collection after scoped terminal proof`

## Accept criteria

- G5 normal path: no branch under `latest && !streaming` returns complete unless `finished === true` and text has remained unchanged for at least 1000 ms.
- G5 recovery: `responseStableMs > 0` alone cannot set `canComplete`; stable unverified text returns the existing deferred/unverified result.
- G6: every `isResponseFinished()` call supplies the sampled snapshot and baseline; the result identifies the turn/message that supplied proof.
- An action bar in response N cannot finish response N+1, even if N's controls remain mounted.
- Identity-less samples cannot use completion controls before `baseline.assistantCount`.
- Generated-image artifact collection and normalization at current lines 653-693 remain behaviorally unchanged and their existing unit tests pass.
- Focused unit/integration tests and `npm run test:unit` pass.

### C-ACTIVATION-GROUNDING-01

| Conditional | Activation scenario | Observable proof that the branch fired |
| --- | --- | --- |
| Stable text without finished proof | Return the same non-placeholder assistant snapshot over multiple polls, no streaming and no action controls. | Poll never returns `status: 'complete'`; at deadline it yields deferred/unverified or timeout. |
| Stable text with scoped finished proof | Return the same snapshot for at least 1000 ms and mount a finished control in that exact turn. | Poll returns `status: 'complete'` only after the debounce interval. |
| Message identity match | Sample has `messageId='m2'`; controls are first under `m1`, then moved under `m2`. | First `isResponseFinished()` result is `finished:false`; second is `finished:true, messageId:'m2'`. |
| Turn identity match | Sample has `turnId='conversation-turn-2'` and no message ID. | Only controls in `conversation-turn-2` produce `finished:true`. |
| Both identities present | Sample has both message and turn IDs; fixture mismatches one field. | Result remains `finished:false`, proving both known fields are enforced. |
| Identity-less baseline fallback | Sample has no IDs; action bar is at turn index 0 and baseline is 1, then a new turn index 1 is mounted. | Old bar is rejected; new turn's bar is accepted. |
| Recovery callback binding | Recovery reads sample `m2` and invokes `readFinished`. | Spy observes the exact `m2` snapshot argument; returned `finished` mirrors that callback only. |
| Recovery stable-only removal | Recovery rereads unchanged text with `readFinished` false. | Result has `finished:false` and `responseStableMs:0`; caller does not finalize. |
| Generated-image path | Provide scoped finished proof plus generated-image chrome and a successful `collectImages` fixture. | Completion includes normalized `Generated image.` text/markdown suffix and saved paths exactly as before. |

## Risks / rollback

- Some response wrappers may lack stable IDs. Baseline turn-index correlation provides a bounded fallback; if selectors drift, the system defers/times out rather than returning a preamble. Add identity extraction only from captured current DOM evidence.
- `data-testid` may identify a descendant action rather than the turn if the first generic descendant is chosen. Implementation must prefer the top-level turn's own identity, then a descendant with `data-message-id`, then a `data-testid` beginning with `conversation-turn`; tighten the proposed `identityFor` selector accordingly during implementation if fixtures expose mixed descendants.
- Removing quiet recovery increases timeouts when action selectors drift. This is the intended fail-closed tradeoff. Rollback should add a new response-scoped positive proof, not restore elapsed stability as proof.
- The normal poll loop currently has a locator text fallback. Identity-gated completion must not pair locator-only text with unrelated DOM controls; evaluate failure should defer.
- Image generation must not regress into text-stability completion. Roll back image-specific changes independently; this phase should not alter `collectImages()`.
