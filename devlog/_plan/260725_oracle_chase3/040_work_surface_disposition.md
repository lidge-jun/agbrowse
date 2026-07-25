# WP5 — G16/G17/G18: Work-surface detection correctness (and the normalization rebuttal)

Rows: **G16**, **G17**, **G18** (Round 3 `040_gap_matrix.md:28-30`), upstream PR #316
commits `80ebcf86`, `eb22ee25`, `77c0b197`.

## 1. Current behavior (re-verified against the tree, not memory)

`detectChatGptComposerSurface` (`product-surfaces.mjs:107-158`) reads **only** the
`role=radio` Chat/Work header buttons:

- zero radios -> `{ ui: 'legacy', surface: null }` (`:112-114`)
- one-sided / invisible / attribute-mismatched -> `surface: 'ambiguous'` (`:143-145,157`)
- clean single-active -> `'chat'` or `'work'` (`:150-156`)

Consumers: `assertChatSurfaceForModelMutation` (`chatgpt-model.mjs:538-547`) throws
`workSurfaceUnsupportedError` on `work` **or** `ambiguous`; the work-picker consults it at
`chatgpt-work-picker.mjs:235,277,1037`.

The hole is the `legacy` branch. On a `/c/<id>` conversation page the header radios are
not rendered, so a **Work conversation reads as `{ ui:'legacy', surface:null }`** and the
model-mutation guard passes. That is the exact class upstream closed with `eb22ee25`
(title-safe `/c/<id>` detection) and `77c0b197` (fail-closed unresolved conversation).

## 2. Disposition per row

| Row | Disposition | Rationale |
|-----|-------------|-----------|
| G16 Work→Chat normalization | **Rebutted / not implemented** | Normalization means clicking the Chat radio. `product-surfaces.mjs:8-9` states the detector contract: "Detectors intentionally never mutate browser state (mutationAllowed: false)", and every surface consumer is a *guard*. Adding a click inside a guard turns a read-only preflight into a state mutation the caller never requested — and the caller already gets an actionable instruction (`retryHint: 'switch-to-chat'` plus the `web-ai work send` pointer, `chatgpt-model.mjs:521-528`). Upstream can normalize because its equivalent path owns navigation and takes an explicit `safe reset callback`; agbrowse has no such caller contract today. Implementing it would need a new opt-in flag and a caller-supplied reset callback — a separate unit, not a row of this one. |
| G17 title-safe `/c/<id>` detection | **Implement** | Closes the `legacy`-on-conversation-page hole with a read-only probe. |
| G18 fail-closed ambiguity | **Implement, narrowly** | Feed the conversation probe into the existing detection result so `ambiguous`/`work` guards fire where they should. No *new* throw is added for the unresolved case — see 3.3. |

## 3. Change map

### 3.1 NEW `detectChatGptWorkConversation(page)` in `web-ai/product-surfaces.mjs`

Read-only, structured-evidence-only (the `eb22ee25` contract — a conversation *titled*
"Work" must never decide the mode):

```js
/**
 * @typedef {{ state: 'work'|'chat'|'unresolved', evidence: Record<string, unknown> }} WorkConversationProbe
 */
export async function detectChatGptWorkConversation(page) {
    const url = typeof page.url === 'function' ? page.url() : '';
    const match = /\/c\/([0-9a-f-]{16,})/i.exec(url || '');
    if (!match) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url', url } };
    const anchors = page.locator('a.__menu-item[href*="/c/"]');  // renderer-owned sidebar only (77c0b197)
    const count = await anchors.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
        const anchor = anchors.nth(i);
        const href = await anchor.getAttribute('href').catch(() => null);
        if (!href || !href.includes(match[1])) continue;
        const badge = anchor.locator('span.flex.items-center > span.shrink-0:not([dir])');
        const badgeCount = await badge.count().catch(() => 0);
        for (let b = 0; b < badgeCount; b += 1) {
            const text = (await badge.nth(b).textContent().catch(() => '') || '').trim().toLowerCase();
            if (text === 'work') return { state: 'work', evidence: { href, badge: text } };
        }
        return { state: 'chat', evidence: { href, badge: null } };
    }
    return { state: 'unresolved', evidence: { reason: 'conversation-anchor-not-found', conversationId: match[1], anchors: count } };
}
```

Three deliberate narrowings, each mirroring an upstream lesson:

1. `a.__menu-item[href*="/c/"]` only — links inside message content cannot masquerade as
   the sidebar entry (`77c0b197`).
2. exact leaf text `work`, no `dir` attribute, `shrink-0` under `span.flex.items-center`
   — a title containing "Work" cannot match (`eb22ee25`).
3. same conversation id from the URL — the active row is identified by id, not by
   position or highlight styling.

### 3.2 MODIFY `detectChatGptComposerSurface` — consult the probe when radios are absent

```diff
     if (count === 0) {
-        return { ui: 'legacy', surface: null, evidence: { chat: null, work: null } };
+        const probe = await detectChatGptWorkConversation(page);
+        if (probe.state === 'work') {
+            return { ui: 'conversation', surface: 'work', evidence: { chat: null, work: null, conversation: probe } };
+        }
+        if (probe.state === 'chat') {
+            return { ui: 'conversation', surface: 'chat', evidence: { chat: null, work: null, conversation: probe } };
+        }
+        return { ui: 'legacy', surface: null, evidence: { chat: null, work: null, conversation: probe } };
     }
```

`ComposerUiKind` widens to `'toggle'|'legacy'|'conversation'`. The unresolved case keeps
the exact previous return shape plus an evidence field, so no existing caller changes
behavior when the probe cannot decide.

The same `count === 0` early return at `:136-138` (both radios present but neither
labelled Chat/Work) stays `legacy` — that branch is about label drift on a toggle UI, not
about conversation pages.

### 3.3 Why not fail closed on `unresolved`

Upstream throws on a persistent `conversation-unresolved`. agbrowse must not: the sidebar
is collapsible and is absent entirely in several supported flows (fresh tab attach,
narrow viewport, `--headed` with a collapsed rail). Throwing there would convert a
cosmetic UI state into a hard failure for every conversation resume — a regression far
larger than the gap being closed. The evidence is recorded in the detection result so a
future caller can opt into strictness; the default stays permissive. Recorded as a
deliberate deviation from upstream, not an omission.

## 4. Accept criteria (activation-grounded)

| Scenario | Activation | Observable effect |
|----------|-----------|-------------------|
| Work conversation, no radios | fake page at `/c/abc123…` with sidebar anchor `a.__menu-item` whose badge span is exactly `work` | `detectChatGptComposerSurface` -> `{ ui:'conversation', surface:'work' }`; `assertChatSurfaceForModelMutation` throws `capability.unsupported` / `switch-to-chat` (today: passes silently) |
| Conversation titled "Work stuff" | anchor text contains `Work` but no structured badge span | `surface: 'chat'` — the title does not poison the verdict |
| Message-body link to another `/c/<id>` | anchor without `__menu-item` class | ignored; probe stays `unresolved`, result identical to today's `legacy` |
| Collapsed sidebar | no anchors at all | `{ ui:'legacy', surface:null }` with `evidence.conversation.reason === 'conversation-anchor-not-found'`; nothing throws |
| Toggle UI unchanged | both radios visible | existing chat/work/ambiguous results byte-identical |

Test file: extend `test/unit/web-ai-product-surfaces.test.mjs` (existing) with the fake
locator/page shape it already uses.

## 5. Scope boundary

IN: `web-ai/product-surfaces.mjs`, `test/unit/web-ai-product-surfaces.test.mjs`.
OUT: any mutation/normalization (G16, rebutted above), `chatgpt-work-picker.mjs` flow
changes, `workSurfaceUnsupportedError` shape, and new throw paths for the unresolved case.
