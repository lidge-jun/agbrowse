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

## 6. Audit amendments (A-gate round 1, reviewer Schrodinger)

This phase took the heaviest correction: three of the reviewer's blockers hit reasoning
that was wrong about our own code, verified below against source and against the upstream
original at `/tmp/oracle-chase-260724/src/browser/actions/navigation.ts`.

### 6.1 Blocker 1 [High] accepted — first-anchor `chat` is a false negative

§3.1 returned `chat` after inspecting the first matching anchor. Upstream
(`navigation.ts:229-242`) instead **aggregates every matching link**, returns work if ANY
carries a structured badge, and falls back to `conversation-unresolved` when the
`aria-label` evidence is absent or ends in `, work`. Our shape loses to a hydration race
(badge not yet rendered) and to responsive duplicate rails.

Also accepted: `href.includes(match[1])` is a substring test — conversation id `abc123`
matches `/c/abc1234...`. Upstream parses with `new URL(href, location.origin)` and
compares `origin` plus the **exact** parsed id (`navigation.ts:221-227`).

**Revised probe (replaces §3.1 in full).** Single bounded `evaluate`, aggregate-then-decide,
exact id, same-origin:

```js
/**
 * @typedef {{ state: 'work'|'chat'|'unresolved', evidence: Record<string, unknown> }} WorkConversationProbe
 */
const WORK_CONVERSATION_PROBE = `(() => {
  const normalize = (v) => String(v || '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const idFromPath = (v) => (String(v || '').match(/\\/c\\/([a-zA-Z0-9-]+)/) || [])[1] || null;
  const isStructuredWorkBadge = (node) =>
    node instanceof HTMLElement && node.tagName === 'SPAN'
    && normalize(node.textContent) === 'work'
    && node.childElementCount === 0
    && !node.hasAttribute('dir')
    && node.classList.contains('shrink-0')
    && Boolean(node.parentElement?.matches('span.flex.items-center'));
  const conversationId = idFromPath(location.pathname);
  if (!conversationId) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url' } };
  const links = Array.from(document.querySelectorAll('a.__menu-item[href*="/c/"]')).filter((node) => {
    try {
      const url = new URL(node.getAttribute('href') || '', location.origin);
      return url.origin === location.origin && idFromPath(url.pathname) === conversationId;
    } catch { return false; }
  });
  if (links.length === 0) return { state: 'unresolved', evidence: { reason: 'conversation-anchor-not-found', conversationId } };
  const hasWorkBadge = links.some((link) => Array.from(link.querySelectorAll('span')).some(isStructuredWorkBadge));
  if (hasWorkBadge) return { state: 'work', evidence: { conversationId, matched: links.length } };
  const ariaLabels = links.map((link) => normalize(link.getAttribute('aria-label'))).filter(Boolean);
  if (ariaLabels.length === 0 || ariaLabels.some((aria) => /,\\s*work\\s*$/.test(aria)))
    return { state: 'unresolved', evidence: { reason: 'no-positive-chat-metadata', conversationId, matched: links.length } };
  return { state: 'chat', evidence: { conversationId, matched: links.length } };
})()`;

/**
 * Read-only Work/Chat classification for a /c/<id> conversation page.
 * @param {any} page
 * @returns {Promise<WorkConversationProbe>}
 */
export async function detectChatGptWorkConversation(page) {
    if (typeof page?.evaluate !== 'function') return { state: 'unresolved', evidence: { reason: 'no-evaluate' } };
    const probe = await page.evaluate(WORK_CONVERSATION_PROBE).catch(() => null);
    return probe && typeof probe.state === 'string' ? probe : { state: 'unresolved', evidence: { reason: 'probe-failed' } };
}
```

`chat` now requires **positive** metadata, exactly as upstream does. Absent evidence stays
`unresolved` instead of silently reading as Chat.

### 6.2 Blocker 7 [Medium] accepted — probe cost

The rewrite above is one `evaluate` round trip regardless of history size, replacing the
per-anchor `nth()`/`getAttribute()`/`textContent()` serial walk. That also removes the
need for a result cap.

### 6.3 Blocker 2 [High] accepted — the fail-open rebuttal was wrong about our callers

§3.3 claimed fail-closed would break "every conversation resume". Source says otherwise:
`selectChatGptModel` returns at `chatgpt-model.mjs:275` (`if (!requestedEffort &&
!requestedFamily) return null;`) **before** `assertChatSurfaceForModelMutation` runs at
`:283`. The comment there is explicit: "Surface guard runs after the zero-request early
return: an unspecified selection must stay zero-touch". So an ordinary send with no model
request never reaches the guard, and failing closed on `unresolved` costs nothing there —
it only affects an explicit model/effort/family mutation on a conversation we cannot
classify, which is precisely the case that can corrupt a Work session.

**Amendment: fail closed at the mutation boundary only.**

```diff
*** web-ai/chatgpt-model.mjs — assertChatSurfaceForModelMutation
     const surfaceDetection = await detectChatGptComposerSurface(page);
-    if (surfaceDetection.surface === 'work' || surfaceDetection.surface === 'ambiguous') {
+    const conversationUnresolved = surfaceDetection.ui === 'legacy'
+        && surfaceDetection.evidence?.conversation?.state === 'unresolved'
+        && surfaceDetection.evidence.conversation.evidence?.reason !== 'not-a-conversation-url';
+    if (surfaceDetection.surface === 'work'
+        || surfaceDetection.surface === 'ambiguous'
+        || conversationUnresolved) {
         throw workSurfaceUnsupportedError({
-            surface: surfaceDetection.surface,
+            surface: surfaceDetection.surface || 'conversation-unresolved',
             evidence: surfaceDetection,
         });
     }
```

Non-conversation pages (`reason: 'not-a-conversation-url'`, i.e. the ordinary `/` composer
with a legacy UI) are excluded, so the legacy-UI path keeps working. Only a `/c/<id>` page
whose mode cannot be established blocks a model mutation.

### 6.4 Blocker 3 [Medium] accepted — the G16 premise was false

§2 claimed "every surface consumer is a guard". `ensureWorkSurface`
(`chatgpt-work-picker.mjs:234-288`) is a counterexample: it reads the detection, then
**clicks** the Work radio at `:253-264` and re-verifies at `:277-286`. So a caller-owned
`ensureChatSurface` mirroring it would be architecturally consistent, and the detector
would stay pure.

**Corrected disposition for G16: deferred as a product decision, not an architectural
impossibility.** Reasons, stated honestly:

1. The mirror operation is straightforward, but no current caller wants it — every Chat
   entry point today is a *preflight*, and silently switching the user's composer out of
   Work is a surprising side effect for a `query`/`send` command.
2. It needs an opt-in surface (a flag such as `--normalize-surface`) plus a decision about
   what happens to an in-progress Work conversation. That is caller/UX design, which is a
   separate work-phase, not a row of this one.
3. The safety half of the gap is closed by 6.1/6.3: after this phase a Work conversation
   is *detected* and mutation is blocked, which is what made G16 look urgent.

Recorded as **G16 — deferred (product/UX decision), tracked for a future unit**. No claim
that the architecture prevents it.

### 6.5 Blocker 6 [Medium] accepted — `'conversation'` was untraced

Three consumer problems, all confirmed:

- `ensureWorkSurface` (`chatgpt-work-picker.mjs:241-252`) throws only for `ambiguous` or
  `ui === 'legacy'`; a `{ ui:'conversation', surface:'chat' }` result would fall through to
  the radio-click loop at `:253-267`, find zero radios, and throw the misleading
  "Work radio button not found for click".
- `detectChatGptWorkAvailability` (`product-surfaces.mjs:178-182`) computes `available`
  from `evidence.work?.visible`, so a detected Work conversation would report
  `{ available:false, active:true }` — a contradiction.
- The `evidence` typedef at `product-surfaces.mjs:84-91` has no `conversation` field.

**Amendment: drop the new `ui` kind.** The detection keeps `ui: 'legacy'` for
radio-less pages and carries the verdict in `surface` + `evidence.conversation`:

```diff
     if (count === 0) {
-        return { ui: 'legacy', surface: null, evidence: { chat: null, work: null } };
+        const conversation = await detectChatGptWorkConversation(page);
+        const surface = conversation.state === 'work' ? 'work'
+            : conversation.state === 'chat' ? 'chat'
+            : null;
+        return { ui: 'legacy', surface, evidence: { chat: null, work: null, conversation } };
     }
```

This keeps every `ui`-based branch byte-identical (no consumer switches on a value it has
never seen) while making `surface` truthful. Consumer effects:

| Consumer | Before | After |
|----------|--------|-------|
| `assertChatSurfaceForModelMutation` | passes on any legacy page | throws for `surface==='work'` and for conversation-unresolved (6.3) |
| `ensureWorkSurface` `:241` | `ui==='legacy'` -> `capability.unsupported` | unchanged (still legacy) — except `surface==='work'` now returns early at `:238-240` as already-on-Work, which is correct |
| `detectChatGptWorkAvailability` | `{available:false, active:false}` | `available` unchanged (radio-based, honest); `active` true when the conversation is Work — update its JSDoc to say `active` may be true with `available` false on conversation pages |

The `evidence` typedef widens to include
`conversation?: { state: 'work'|'chat'|'unresolved', evidence: Record<string, unknown> }`.
Verification adds `npm run typecheck:checkjs-dom` (package.json:85) for this phase.

### 6.6 Blocker 10 [Low] accepted — anchors

`product-surfaces.mjs:135-137` is `if (!chat && !work)` (label drift), not a
"`count === 0` early return"; the final ambiguous return is `:158`, not `:157`. §1 and §3.2
are corrected accordingly.

### 6.7 Revised accept criteria

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | `/c/<id>`, sidebar anchor with structured `work` badge | `surface:'work'`; `assertChatSurfaceForModelMutation` throws `capability.unsupported` |
| 2 | duplicate anchors, only the second badged | still `'work'` (aggregate, not first-match) |
| 3 | anchor with positive `aria-label` and no badge | `'chat'`; mutation allowed |
| 4 | anchor with no `aria-label` (hydration race) | `'unresolved'`, `surface:null`; mutation **blocked** |
| 5 | `aria-label` ending in `, work` | `'unresolved'`; mutation blocked |
| 6 | foreign-origin `/c/<id>` anchor | ignored; `'unresolved'` |
| 7 | substring id (`/c/abc1234` while on `/c/abc123`) | ignored; `'unresolved'` |
| 8 | message-body link without `__menu-item` | ignored |
| 9 | non-conversation legacy page (`/`) | `'unresolved'` with `reason:'not-a-conversation-url'`; mutation **allowed** (no regression) |
| 10 | toggle UI (radios present) | results byte-identical to today |
| 11 | `page.evaluate` throws | `'unresolved'`, no exception escapes |
| 12 | probe cost | exactly one `evaluate` call regardless of anchor count |

Test files: extend `test/unit/web-ai-product-surfaces.test.mjs`; add model-guard cases to
the existing chatgpt-model test coverage. Cases 1-9 use a jsdom document driven through a
page fake whose `evaluate` runs the probe expression against it.

## 7. Audit amendments (A-gate round 2, same reviewer)

### 7.1 Blocker 2 [High] accepted — probe failure was being read as "this is a conversation"

Verified and serious: `test/unit/web-ai-chatgpt-model.test.mjs:944-947` uses a page fake
whose `evaluate` returns `null` for anything it does not recognize. With zero surface
radios that fake would enter the conversation probe, get `probe-failed`, and — under §6.3's
condition — **block model selection in existing passing tests**. The same happens in
production when `evaluate` rejects transiently during navigation on an ordinary `/` page.

Root cause: the URL check lived *inside* the evaluated expression, so a failed evaluation
could not be distinguished from "conversation with no evidence".

**Amendment: establish the conversation URL in Node, before evaluating.**

```diff
 export async function detectChatGptWorkConversation(page) {
+    const url = typeof page?.url === 'function' ? (page.url() || '') : '';
+    const conversationId = (String(url).match(/\/c\/([a-zA-Z0-9-]+)/) || [])[1] || null;
+    if (!conversationId) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url', url } };
     if (typeof page?.evaluate !== 'function')
-        return { state: 'unresolved', evidence: { reason: 'no-evaluate' } };
+        return { state: 'unresolved', evidence: { reason: 'probe-unavailable', conversationId } };
     const probe = await page.evaluate(WORK_CONVERSATION_PROBE).catch(() => null);
     return probe && typeof probe.state === 'string'
         ? probe
-        : { state: 'unresolved', evidence: { reason: 'probe-failed' } };
+        : { state: 'unresolved', evidence: { reason: 'probe-failed', conversationId } };
 }
```

Now every failure reason is only reachable **after** the URL positively supplied a
conversation id, so §6.3's guard condition simplifies and is correct by construction:

```diff
-    const conversationUnresolved = surfaceDetection.ui === 'legacy'
-        && surfaceDetection.evidence?.conversation?.state === 'unresolved'
-        && surfaceDetection.evidence.conversation.evidence?.reason !== 'not-a-conversation-url';
+    const conversation = surfaceDetection.evidence?.conversation;
+    // Fail closed only when the URL says we ARE on a conversation but its mode
+    // could not be established. A non-conversation page (or any page whose URL
+    // never matched /c/<id>) is never blocked, so legacy-UI paths and page fakes
+    // without a conversation URL keep their current behavior.
+    const conversationUnresolved = conversation?.state === 'unresolved'
+        && Boolean(conversation.evidence?.conversationId);
```

The `evaluate`-returns-null page fake at `chatgpt-model.test.mjs:944-947` has no `/c/<id>`
url, so it short-circuits at `not-a-conversation-url` and never reaches the probe at all —
existing tests keep passing, and the probe's cost disappears entirely off conversation
pages.

### 7.2 Revised accept criteria (supersedes §6.7 rows 9 and 11)

| # | Scenario | Assertion |
|---|----------|-----------|
| 9 | root page `/`, legacy UI, `evaluate` returns null | `not-a-conversation-url`; `evaluate` NEVER called; model mutation **allowed** |
| 9b | root page `/`, `evaluate` throws | same — allowed |
| 11 | `/c/<id>` page, `evaluate` throws | `probe-failed` with `conversationId`; model mutation **blocked** |
| 11b | `/c/<id>` page, page has no `evaluate` | `probe-unavailable` with `conversationId`; blocked |
| 12 | probe cost | at most one `evaluate`, and zero on non-conversation pages |

Rows 1-8 and 10 from §6.7 stand unchanged.

## 8. Audit amendments (A-gate round 3)

### 8.1 Blocker 2 [Medium] accepted — full-URL matching and the check/evaluate race

Two real defects in §7.1:

1. The Node precheck ran `/\/c\/([a-zA-Z0-9-]+)/` against the whole `page.url()`, so
   `https://chatgpt.com/?next=/c/abc123` or a `#/c/abc123` fragment on an auth page reads as
   a conversation. Upstream matches `location.pathname` only
   (`/tmp/oracle-chase-260724/src/browser/actions/navigation.ts:215-216`).
2. The Node check and the in-page probe read the URL independently, so a navigation between
   them lets conversation A's id be attached to conversation B's DOM verdict.

**Amendment: parse the pathname, and pass the expected id into the probe so the page can
refuse a mismatch.**

```diff
+/** @param {string} rawUrl @returns {string|null} */
+function conversationIdFromUrl(rawUrl) {
+    let pathname = '';
+    try {
+        pathname = new URL(String(rawUrl)).pathname;
+    } catch {
+        // Relative or malformed: accept only a leading-path shape, never query/fragment.
+        pathname = String(rawUrl || '').split(/[?#]/)[0];
+    }
+    return (pathname.match(/^\/c\/([a-zA-Z0-9-]+)$/) || [])[1] || null;
+}
+
 export async function detectChatGptWorkConversation(page) {
-    const url = typeof page?.url === 'function' ? (page.url() || '') : '';
-    const conversationId = (String(url).match(/\/c\/([a-zA-Z0-9-]+)/) || [])[1] || null;
+    const url = typeof page?.url === 'function' ? (page.url() || '') : '';
+    const conversationId = conversationIdFromUrl(url);
     if (!conversationId) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url', url } };
     if (typeof page?.evaluate !== 'function')
         return { state: 'unresolved', evidence: { reason: 'probe-unavailable', conversationId } };
-    const probe = await page.evaluate(WORK_CONVERSATION_PROBE).catch(() => null);
+    const probe = await page.evaluate(WORK_CONVERSATION_PROBE, conversationId).catch(() => null);
     return probe && typeof probe.state === 'string'
         ? probe
         : { state: 'unresolved', evidence: { reason: 'probe-failed', conversationId } };
 }
```

The probe expression becomes a function of that expected id and fails closed on mismatch:

```diff
-  const conversationId = idFromPath(location.pathname);
-  if (!conversationId) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url' } };
+  const conversationId = idFromPath(location.pathname);
+  if (!conversationId) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url' } };
+  if (expectedId && conversationId !== expectedId)
+      return { state: 'unresolved', evidence: { reason: 'navigation-race', expectedId, conversationId } };
```

`navigation-race` carries a `conversationId`, so the model-mutation guard blocks it — a page
that moved under us is exactly the case where a Work session could be corrupted. `idFromPath`
inside the page keeps using `location.pathname`, matching upstream.

### 8.2 Added accept criteria

| # | Scenario | Assertion |
|---|----------|-----------|
| 13 | `https://chatgpt.com/?next=/c/abc123` | `not-a-conversation-url`; `evaluate` never called; mutation allowed |
| 14 | `https://chatgpt.com/#/c/abc123` | same |
| 15 | `https://chatgpt.com/c/abc123/share` | `not-a-conversation-url` (anchored pathname match) |
| 16 | malformed/relative url `"/c/abc123"` | resolves to `abc123` via the fallback branch |
| 17 | page navigates between check and probe (probe sees a different id) | `navigation-race`; mutation **blocked** |
| 18 | `page.url()` throws | treated as no url -> `not-a-conversation-url`; mutation allowed |

## 9. FINAL probe specification (audit round 4, reviewer Mill — supersedes §6.1 and §8)

Round 4 found two blockers in the §8 text, both verified:

1. **The probe could never receive `expectedId`.** `WORK_CONVERSATION_PROBE` was defined as
   a self-invoking *string* expression, and Playwright sends strings with `isFunction:false`
   (`node_modules/playwright-core/lib/client/frame.js:175-178`), so the argument is dropped
   and `expectedId` is a `ReferenceError`. Every conversation would have degraded to
   `probe-failed` — which, combined with §7.1's fail-closed rule, would have blocked model
   mutation on **every** conversation page. This is the worst defect found in the whole
   round; it would have shipped as a total regression of the model-selection path.
2. **The URL contract was narrower than the repo's own parser.** The anchored
   `^\/c\/([a-zA-Z0-9-]+)$` rejects `https://chat.openai.com/g/gpt-slug/c/ABC-123/`, which
   `web-ai/conversation-url.mjs:4-25` accepts and `test/unit/web-ai-conversation-url.test.mjs:21-24`
   pins as valid. A GPT-prefixed Work conversation would have skipped the safety probe
   entirely. And `page.url()` was called outside try/catch despite §8.2 case 18 requiring
   the throwing case to be handled.

### 9.1 Reuse the canonical parser

`extractDurableConversationId` (`web-ai/conversation-url.mjs:12`) already enforces https,
the ChatGPT host set, no port/authority tricks, and a segment-bounded `/c/<id>` match with a
strict id alphabet — every property this probe needs, already unit-tested. WP5 uses it
instead of a private regex:

```js
import { extractDurableConversationId } from './conversation-url.mjs';

/** @param {any} page @returns {string|null} */
function currentConversationId(page) {
    try {
        return typeof page?.url === 'function' ? extractDurableConversationId(page.url()) : null;
    } catch {
        return null;   // a throwing url() accessor is simply "no conversation"
    }
}
```

Query- and fragment-only lookalikes are excluded because the parser matches on
`url.pathname` only; `/share/<id>` links are excluded because they have no `/c/` segment.

### 9.2 The probe is a real function

```js
/**
 * Browser-context probe. Pure function of `document` + `location`; no mutations.
 * @param {{ expectedId: string }} options
 * @returns {WorkConversationProbe}
 */
export function readWorkConversationState({ expectedId }) {
    const normalize = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const idFromPath = (v) => (String(v || '').match(/(?:^|\/)c\/([A-Za-z0-9-]+)(?=\/|$)/) || [])[1] || null;
    const isStructuredWorkBadge = (node) =>
        node instanceof HTMLElement && node.tagName === 'SPAN'
        && normalize(node.textContent) === 'work'
        && node.childElementCount === 0
        && !node.hasAttribute('dir')
        && node.classList.contains('shrink-0')
        && Boolean(node.parentElement?.matches('span.flex.items-center'));

    const conversationId = idFromPath(location.pathname);
    if (!conversationId) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url' } };
    if (expectedId && conversationId !== expectedId)
        return { state: 'unresolved', evidence: { reason: 'navigation-race', expectedId, conversationId } };

    const links = Array.from(document.querySelectorAll('a.__menu-item[href*="/c/"]')).filter((node) => {
        try {
            const url = new URL(node.getAttribute('href') || '', location.origin);
            return url.origin === location.origin && idFromPath(url.pathname) === conversationId;
        } catch { return false; }
    });
    if (links.length === 0)
        return { state: 'unresolved', evidence: { reason: 'conversation-anchor-not-found', conversationId } };

    if (links.some((link) => Array.from(link.querySelectorAll('span')).some(isStructuredWorkBadge)))
        return { state: 'work', evidence: { conversationId, matched: links.length } };

    const ariaLabels = links.map((link) => normalize(link.getAttribute('aria-label'))).filter(Boolean);
    if (ariaLabels.length === 0 || ariaLabels.some((aria) => /,\s*work\s*$/.test(aria)))
        return { state: 'unresolved', evidence: { reason: 'no-positive-chat-metadata', conversationId, matched: links.length } };
    return { state: 'chat', evidence: { conversationId, matched: links.length } };
}
```

Exported from `web-ai/product-surfaces.mjs` (or a small sibling module) so jsdom can call it
directly, exactly as `readChatGptStreamingState` is both serialized into `page.evaluate`
(`chatgpt.mjs:985-992`) and unit-tested in-process
(`test/unit/web-ai-chatgpt-response-fragments.test.mjs`). The in-page `idFromPath` now uses
the same segment-bounded pattern as `conversation-url.mjs:4`, so both sides agree.

### 9.3 Node wrapper (final)

```js
export async function detectChatGptWorkConversation(page) {
    const conversationId = currentConversationId(page);
    if (!conversationId) return { state: 'unresolved', evidence: { reason: 'not-a-conversation-url' } };
    if (typeof page?.evaluate !== 'function')
        return { state: 'unresolved', evidence: { reason: 'probe-unavailable', conversationId } };
    const probe = await page.evaluate(readWorkConversationState, { expectedId: conversationId }).catch(() => null);
    return probe && typeof probe.state === 'string'
        ? probe
        : { state: 'unresolved', evidence: { reason: 'probe-failed', conversationId } };
}
```

The guard condition from §7.1 is unchanged and still correct: block when
`state === 'unresolved' && Boolean(evidence.conversationId)`.

### 9.4 FINAL accept criteria (supersedes §6.7, §7.2, §8.2)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `/c/<id>` with a structured `work` badge on the matching sidebar anchor | `work`; mutation blocked |
| 2 | duplicate anchors, only the second badged | `work` (aggregate) |
| 3 | positive `aria-label`, no badge | `chat`; mutation allowed |
| 4 | no `aria-label` (hydration race) | `no-positive-chat-metadata`; blocked |
| 5 | `aria-label` ending in `, work` | `no-positive-chat-metadata`; blocked |
| 6 | foreign-origin anchor | ignored -> `conversation-anchor-not-found`; blocked |
| 7 | substring id (`/c/abc1234` while on `/c/abc123`) | ignored (segment-bounded) |
| 8 | message-body link without `__menu-item` | ignored |
| 9 | `https://chatgpt.com/` root | `not-a-conversation-url`; `evaluate` never called; allowed |
| 10 | `https://chatgpt.com/?next=/c/abc123` and `#/c/abc123` | `not-a-conversation-url`; allowed |
| 11 | `https://chat.openai.com/g/gpt-slug/c/ABC-123/` | id `ABC-123` extracted; probe runs (round-4 blocker 6) |
| 12 | `https://chatgpt.com/share/abc123` | `not-a-conversation-url` |
| 13 | `page.url()` throws | `not-a-conversation-url`; allowed, no exception escapes |
| 14 | `/c/<id>`, `evaluate` rejects | `probe-failed` with `conversationId`; blocked |
| 15 | `/c/<id>`, page has no `evaluate` | `probe-unavailable`; blocked |
| 16 | probe sees a different conversation than the Node check | `navigation-race`; blocked |
| 17 | **argument transport** — probe invoked through `page.evaluate(fn, arg)` | `expectedId` is received (function, not string expression; round-4 blocker 1) |
| 18 | toggle UI (radios present) | byte-identical to today |
| 19 | probe cost | at most one `evaluate`; zero on non-conversation pages |

## 10. checkJs conformance (audit round 5)

Round 5 compiled §9.2 with TypeScript 5.9.3 and found it would fail
`npm run typecheck:checkjs-dom`, which reaches this module transitively via
`chatgpt-model.mjs:539`:

```text
TS2304 Cannot find name 'WorkConversationProbe'.
TS7006 Parameter 'v' implicitly has an 'any' type.   (x2)
TS7006 Parameter 'node' implicitly has an 'any' type.
```

Required in the implementation (the §9.2 body is otherwise unchanged):

```diff
+/**
+ * @typedef {{ state: 'work'|'chat'|'unresolved', evidence: Record<string, unknown> }} WorkConversationProbe
+ */
+
 export function readWorkConversationState({ expectedId }) {
-    const normalize = (v) => ...;
-    const idFromPath = (v) => ...;
-    const isStructuredWorkBadge = (node) => ...;
+    const normalize = (/** @type {unknown} */ v) => ...;
+    const idFromPath = (/** @type {unknown} */ v) => ...;
+    const isStructuredWorkBadge = (/** @type {Element} */ node) => ...;
```

The typedef is re-declared locally rather than inherited from §6.1, which this section
supersedes. `npm run typecheck:checkjs-dom` joins `test:unit` and the docs gates for WP5's
C phase.

Round 5 also executed the §9.2 function and confirmed the behavior this phase claims:

```json
{ "jsdom-work": {"state":"work","evidence":{"conversationId":"abc-123","matched":1}},
  "jsdom-chat": {"state":"chat","evidence":{"conversationId":"abc-123","matched":1}},
  "jsdom-navigation-race": {"state":"unresolved","evidence":{"reason":"navigation-race","expectedId":"abc-123","conversationId":"other"}},
  "jsdom-gpt-prefix-trailing": {"state":"work","evidence":{"conversationId":"ABC-123","matched":1}},
  "playwright-function-arg": {"state":"work","evidence":{"conversationId":"ABC-123","matched":1}} }
```

That last row is the round-4 blocker-1 transport proof: passed as a function object, the
probe receives `expectedId` correctly under real Playwright.
