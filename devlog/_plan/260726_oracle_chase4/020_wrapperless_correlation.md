# WP3 — G11: wrapperless completion correlation

Row: **G11** (upstream `7b107769`).

## 1. Problem

`resolveTopLevelAssistantTurns` (`chatgpt-response-dom.mjs:87`) resolves turns
ONLY from two role selectors:

```js
const roleSelectors = ['[data-message-author-role="assistant"]', '[data-turn="assistant"]'];
```

When ChatGPT renders markdown without those wrappers, the resolver returns `[]`.
Downstream, `isResponseFinished` (`chatgpt.mjs:1015-1035`) iterates that empty
list and returns `{ finished: false, turnIndex: -1 }`, while the text readers
return nothing — so the poll loop has no turn identity to correlate against.

Upstream `7b107769` addressed the dangerous half of this: in the wrapperless
markdown fallback it requires the candidate node to be **DOM-following the latest
user node**, instead of treating "no turns" as "automatically after
`minTurnIndex`". Without that, an old answer, a user echo, or stray markdown can
be accepted as the new response.

The `hasIdentity ? !identityMatches : turnIndex < minTurnIndex` branch at
`chatgpt.mjs:1032` is exactly the shape upstream warns about: with no identity and
no turns, the ordering check never runs at all.

## 2. Change map

### 2.1 NEW browser-context helper in `chatgpt-response-dom.mjs`

```js
/**
 * Browser-context. Resolve wrapperless assistant markdown: content blocks that
 * are not inside any recognized turn wrapper AND that DOM-follow the latest user
 * message. Serialization-safe — declares every constant in its own body.
 *
 * The DOM-following requirement is the whole point: without a turn index there is
 * no other way to tell a NEW answer from an old one or from the user's own echo,
 * so a candidate that precedes the latest user node is rejected rather than
 * optimistically accepted.
 *
 * @param {{ userSelectors?: string[], markdownSelectors?: string[] }} options
 * @returns {{ text: string, following: boolean }[]}
 */
export function readWrapperlessAssistantBlocks({ userSelectors, markdownSelectors } = {}) {
    const USER_SELECTORS = userSelectors && userSelectors.length ? userSelectors : [
        '[data-message-author-role="user"]',
        '[data-turn="user"]',
    ];
    const MARKDOWN_SELECTORS = markdownSelectors && markdownSelectors.length ? markdownSelectors : [
        '.markdown',
        '[data-message-content]',
    ];
    const WRAPPER_SELECTORS = [
        '[data-message-author-role]',
        '[data-turn]',
        'article[data-testid^="conversation-turn"]',
    ];
    const isVisible = (node) => {
        const rect = node.getBoundingClientRect?.();
        return Boolean(rect) && rect.width > 0 && rect.height > 0;
    };

    let latestUser = null;
    for (const selector of USER_SELECTORS) {
        for (const node of Array.from(document.querySelectorAll(selector))) latestUser = node;
    }

    const blocks = [];
    for (const selector of MARKDOWN_SELECTORS) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
            if (!isVisible(node)) continue;
            // Inside a recognized wrapper? Then the normal turn path owns it.
            if (node.closest && node.closest(WRAPPER_SELECTORS.join(', '))) continue;
            const following = Boolean(latestUser)
                && (latestUser.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
            blocks.push({ text: (node.innerText || node.textContent || '').trim(), following });
        }
    }
    return blocks;
}
```

`latestUser === null` yields `following: false` for every block — fail closed. A
page with no user node cannot prove a block is new.

### 2.2 MODIFY `chatgpt.mjs` — consult the fallback only when turns are absent

```diff
 async function isResponseFinished(page, sample, minTurnIndex) {
     ...existing evaluate...
-        return result && typeof result === 'object'
-            ? result
-            : { finished: false, messageId: null, turnId: null, turnIndex: -1 };
+        if (result && typeof result === 'object' && result.turnIndex >= 0) return result;
+        // No recognized turn wrapper: fall back to wrapperless markdown, which
+        // only counts when it DOM-follows the latest user message.
+        const wrapperless = await readWrapperlessFollowingText(page);
+        if (wrapperless) {
+            return { finished: true, messageId: null, turnId: null, turnIndex: minTurnIndex };
+        }
+        return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
 }
```

with the Node-side reader:

```js
/**
 * @param {any} page
 * @returns {Promise<string|null>} the newest wrapperless answer text, or null
 */
async function readWrapperlessFollowingText(page) {
    try {
        const blocks = await page.evaluate(readWrapperlessAssistantBlocks, {});
        if (!Array.isArray(blocks)) return null;
        const following = blocks.filter(block => block.following && block.text);
        return following.length ? following[following.length - 1].text : null;
    } catch {
        return null;
    }
}
```

**Deliberate narrowness.** This does NOT change the normal wrapper path in any
way — it only fires when `turnIndex < 0`, i.e. when today's code already returns
"not finished" and the loop would otherwise poll to timeout. The worst case is
unchanged behavior; the best case is a recovered answer that today times out.

## 3. Accept criteria (activation-grounded)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | wrapperless `.markdown` after the latest user node | `following: true`, text returned |
| 2 | wrapperless `.markdown` BEFORE the latest user node (old answer) | `following: false`, rejected |
| 3 | the user's own echoed markdown (inside a user wrapper) | excluded by the wrapper check |
| 4 | markdown inside a recognized assistant wrapper | excluded — the turn path owns it |
| 5 | no user node at all | every block `following: false` — fail closed |
| 6 | hidden markdown node | excluded |
| 7 | two following blocks | the LAST one is returned |
| 8 | `isResponseFinished` with turns present | unchanged; the fallback never runs |
| 9 | `isResponseFinished` with no turns and a following block | `finished: true` at `minTurnIndex` |
| 10 | `isResponseFinished` with no turns and only a preceding block | `finished: false` (today's behavior preserved) |
| 11 | `page.evaluate` rejects | `null`, no throw escapes |
| 12 | **transport**: real Chromium `page.evaluate(readWrapperlessAssistantBlocks, {})` | returns blocks, no `ReferenceError` |

Tests: extend `test/unit/web-ai-chatgpt-response-fragments.test.mjs`; transport
case joins the new `test/integration/activity-state-transport.test.mjs`.

## 4. Scope boundary

IN: the new helper, the `isResponseFinished` fallback, its Node reader, tests.
OUT: `resolveTopLevelAssistantTurns` itself (the wrapper contract is unchanged),
the text-extraction readers, and the copy-markdown fallback path.

## 5. Audit amendments (A-gate round 1, blocker 3) — AUTHORITATIVE

### 5.1 The fallback as designed was a dead path

Verified: on a wrapperless DOM the resolver returns `[]`, so
`readTopLevelAssistantSnapshots` (`chatgpt-response-dom.mjs:229-235`) returns `[]`,
so `latestSnapshot` is `null` at `chatgpt.mjs:643`, so `isResponseFinished` is never
called at all (`:671` requires `latestSnapshot`). Putting the fallback inside
`isResponseFinished` guarantees it never runs in exactly the case it was written for.

**Corrected insertion point: snapshot acquisition.** The wrapperless candidate must
become a snapshot, so the SAME candidate carries text stability and terminal
evidence through the existing loop rather than being bolted onto the tail.

### 5.2 Revised change map

**(a)** `readWrapperlessAssistantBlocks` keeps its shape but returns snapshot-shaped
records and is realm-safe (blocker 3's second half — `Node` is undefined as a global
under jsdom):

```diff
-            const following = Boolean(latestUser)
-                && (latestUser.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
-            blocks.push({ text: ..., following });
+            // Realm-safe: `Node` is not a global in jsdom's default context, and a
+            // cross-realm document would use a different constructor anyway.
+            const view = node.ownerDocument?.defaultView;
+            const FOLLOWING = view?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
+            const following = Boolean(latestUser)
+                && (latestUser.compareDocumentPosition(node) & FOLLOWING) !== 0;
+            if (!following) continue;   // fail closed: only new content qualifies
+            blocks.push({
+                text: (node.innerText || node.textContent || '').trim(),
+                messageId: null,
+                turnId: null,
+                turnIndex: -1,        // caller assigns; see (b)
+            });
```

**(b)** `readAssistantSnapshots` (`chatgpt.mjs:1358`) gains the fallback, mirroring
the shape it already uses for text:

```diff
 async function readAssistantSnapshots(page) {
     const snapshots = await page.evaluate(readTopLevelAssistantSnapshots, {...});
-    return snapshots;
+    if (Array.isArray(snapshots) && snapshots.length) return snapshots;
+    // No recognized turn wrapper anywhere: fall back to wrapperless markdown that
+    // DOM-follows the latest user message. Indices continue from 0 so the
+    // existing baseline.assistantCount slicing keeps working.
+    const blocks = await page.evaluate(readWrapperlessAssistantBlocks, {}).catch(() => []);
+    return Array.isArray(blocks)
+        ? blocks.map((block, turnIndex) => ({ ...block, turnIndex }))
+        : [];
 }
```

**(c)** `isResponseFinished` needs the matching relaxation, because a wrapperless
snapshot has no identity and no real turn:

```diff
                 const hasIdentity = Boolean(sample.messageId || sample.turnId);
                 ...
-            return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
+            return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
@@ after the evaluate
+        if (result && typeof result === 'object' && result.turnIndex < 0 && !sample.messageId && !sample.turnId) {
+            // Wrapperless candidate: there is no turn to carry terminal actions, so
+            // completion rests on text stability alone. The DOM-following filter in
+            // the reader is what makes that safe — an old answer or user echo never
+            // becomes a candidate in the first place.
+            return { finished: true, messageId: null, turnId: null, turnIndex: minTurnIndex };
+        }
```

This is the one place the design accepts weaker evidence, and it is bounded: it only
applies when the page has NO wrappers at all, and the candidate already proved it
follows the latest user node.

### 5.3 Revised accept criteria

| # | Scenario | Expected |
|---|----------|----------|
| 1 | wrapperless markdown following the latest user node | becomes a snapshot; poll loop stabilizes and completes |
| 2 | wrapperless markdown BEFORE the latest user node | not a snapshot — `[]`, loop keeps polling |
| 3 | user's own echoed markdown | excluded by the wrapper check |
| 4 | markdown inside a recognized assistant wrapper | normal path; fallback never consulted |
| 5 | no user node | `[]` — fail closed |
| 6 | hidden markdown node | excluded |
| 7 | two following blocks | both returned, indices 0..n, `latestSnapshot` is the last |
| 8 | wrappers present | `readAssistantSnapshots` returns them; fallback not called (assert call count) |
| 9 | `page.evaluate` rejects in the fallback | `[]`, no throw |
| 10 | `isResponseFinished` on a wrapperless sample | `finished: true` at `minTurnIndex` |
| 11 | `isResponseFinished` on a wrapped sample with no match | unchanged `{finished:false, turnIndex:-1}` |
| 12 | **jsdom realm** — helper called directly with no global `Node` | works via `ownerDocument.defaultView` |
| 13 | **transport** real Chromium | blocks returned, no `ReferenceError` |

### 5.4 Corrected scope

IN: `readWrapperlessAssistantBlocks`, the `readAssistantSnapshots` fallback, the
`isResponseFinished` wrapperless branch, tests.
OUT: `resolveTopLevelAssistantTurns`, the copy-markdown fallback, and the text-only
reader at `chatgpt.mjs:1358-1361` (which already has its own locator fallback).

## 6. Audit amendments (A-gate round 2, blocker 2) — AUTHORITATIVE over §5

Three defects, all confirmed:

1. **Baseline slicing breaks.** `countAssistantMessages` (`chatgpt.mjs:317`) walks the
   same `readAssistantSnapshots`, so BEFORE the send the fallback counts old
   wrapperless blocks (which then follow the previous user) as baseline `N`. AFTER the
   send those same blocks precede the NEW user node and are dropped, so the reader
   returns only `M` new blocks. `snapshots.slice(N)` at `:642` then discards the answer
   whenever `N >= M`.
2. **Historical wrapped turns suppress it.** §5.2 only consults the fallback when the
   wrapped list is empty, so one old wrapped turn anywhere hides a new wrapperless
   answer forever.
3. **Provenance inferred from null ids is unsafe.** A wrapped snapshot can also carry
   null `messageId`/`turnId`; if its DOM re-renders before the finish probe it would be
   wrongly promoted to `finished: true`.

### 6.1 Explicit provenance

Every snapshot carries its origin; nothing is inferred:

```diff
 // readTopLevelAssistantSnapshots (wrapped path)
-        return { text, messageId, turnId, turnIndex };
+        return { text, messageId, turnId, turnIndex, source: 'wrapped' };
 // readWrapperlessAssistantBlocks
+            blocks.push({ text, messageId: null, turnId: null, turnIndex: -1, source: 'wrapperless' });
```

`isResponseFinished` keys off `sample.source === 'wrapperless'`, never off absent ids.

### 6.2 Wrapperless candidates are already correlated, so they bypass slicing

The reader only emits blocks that DOM-follow the latest user node — that IS the
"is it new?" test. Baseline slicing would ask the same question a second time with a
count that is not comparable across sends, so the poll loop separates the two lists:

```diff
@@ chatgpt.mjs poll loop (~:641)
-        const snapshots = await readAssistantSnapshots(page);
-        const newSnapshots = snapshots.slice(baseline.assistantCount).filter(sample => isFinalAnswer(sample.text));
+        const { wrapped, wrapperless } = await readAssistantSnapshotsSplit(page);
+        // Wrapped turns are positional: slice against the pre-send count.
+        // Wrapperless blocks are already correlated by DOM-following the latest
+        // user node, so slicing them against a stale count would drop the answer.
+        const newSnapshots = [
+            ...wrapped.slice(baseline.assistantCount),
+            ...wrapperless,
+        ].filter(sample => isFinalAnswer(sample.text));
```

and `countAssistantMessages` (which feeds `baseline.assistantCount`) counts the
WRAPPED list only, so the baseline stays a pure positional count:

```diff
 async function countAssistantMessages(page) {
-    return (await readAssistantSnapshots(page)).length;
+    return (await readAssistantSnapshotsSplit(page)).wrapped.length;
 }
```

`readAssistantSnapshotsSplit` always reads BOTH lists — defect 2 disappears, because
a historical wrapped turn no longer suppresses the wrapperless read.

### 6.3 Revised criteria (supersede §5.3 rows 1, 4, 8, 10)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | wrapperless answer following the latest user, NO wrapped turns | appears in `newSnapshots`; completes |
| 4 | wrapperless answer AND historical wrapped turns present | still appears (defect 2) |
| 8 | wrapped answer present | `baseline.assistantCount` counts wrapped only; slicing unchanged |
| 10 | `isResponseFinished` on `source:'wrapperless'` | `finished: true` at `minTurnIndex` |
| 10b | wrapped sample with null ids whose DOM vanished | `finished: false` — provenance is explicit (defect 3) |
| 14 | old wrapperless blocks existed before the send | baseline unaffected (wrapped-only count); the new block still surfaces |

## 7. Audit amendments (A-gate round 3, blocker 1)

Concatenating `[...wrapped, ...wrapperless]` makes `newSnapshots.at(-1)`
(`chatgpt.mjs:643`) pick by LIST POSITION, not by document position. Reproduced:

```text
planned order: wrapped-newer@30, wrapperless-older@20
at(-1)  -> wrapperless-older   (WRONG)
actual newest -> wrapped-newer
```

### 7.1 Both sources carry a comparable DOM order

Each reader records the node's index in a single document-order walk, and the
wrapperless reader deduplicates nodes that match more than one markdown selector:

```diff
 // both readers, inside the browser context
+    // One document-order pass over the union of candidate nodes gives every
+    // snapshot a comparable `domOrder`; a Set kills duplicates from overlapping
+    // selectors before ordering.
+    const ordered = Array.from(new Set(candidates));
+    ordered.sort((a, b) =>
+        (a.compareDocumentPosition(b) & FOLLOWING) ? -1 : 1);
-        return { text, messageId, turnId, turnIndex, source };
+        return { text, messageId, turnId, turnIndex, source, domOrder: ordered.indexOf(node) };
```

For the wrapped path `domOrder` can simply reuse the existing `turnIndex` ordering
walk; what matters is that both lists are measured against the SAME document.

### 7.2 Merge by DOM order, not by list

```diff
-        const newSnapshots = [
-            ...wrapped.slice(baseline.assistantCount),
-            ...wrapperless,
-        ].filter(sample => isFinalAnswer(sample.text));
+        const newSnapshots = [...wrapped.slice(baseline.assistantCount), ...wrapperless]
+            .sort((a, b) => a.domOrder - b.domOrder)
+            .filter(sample => isFinalAnswer(sample.text));
```

`.at(-1)` then means "last in the document", which is what the loop has always
assumed.

### 7.3 Added criteria

| # | Scenario | Expected |
|---|----------|----------|
| 15 | wrapped answer AFTER a wrapperless block | `at(-1)` is the wrapped one (blocker-1 case) |
| 16 | wrapperless answer AFTER a wrapped turn | `at(-1)` is the wrapperless one |
| 17 | a node matching both `.markdown` and `[data-message-content]` | appears ONCE |
| 18 | wrapped-only page | ordering byte-identical to today |
