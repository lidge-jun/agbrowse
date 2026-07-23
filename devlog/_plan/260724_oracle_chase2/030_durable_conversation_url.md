# 030 — Durable ChatGPT conversation URL persistence (G29)

Date: 2026-07-24  
Status: Diff-level implementation roadmap  
Format: DIFFLEVEL-ROADMAP-01  
Work-phase: WP4  
Upstream evidence: Oracle `2157ab73`, `aa4e0f75`, `7936b6e5`

## Objective

Persist and later navigate to a ChatGPT `conversationUrl` only when the URL has a durable, path-derived `/c/<id>` segment. The id is limited to ASCII letters, digits, and hyphens and must end at a path-segment boundary. Parse the candidate with `URL` and inspect `URL.pathname`; query and fragment hints never qualify.

The persistence invariant is:

1. `/c/abc-123`, `/g/gpt-slug/c/abc-123`, and the same routes with a following slash are durable.
2. `/c/WEB:request-id`, `/c/abc_def`, `/c/abc:123`, provider roots, project pages, malformed URLs, foreign hosts, explicit ports, and strings containing `/c/...` only in query/fragment are not durable.
3. A non-durable observation never clears or overwrites the last durable `conversationUrl`.
4. Non-ChatGPT vendors retain their existing URL behavior.

The canonical predicate lives in a new dependency-leaf module, `web-ai/conversation-url.mjs`, rather than directly in `tab-recovery.mjs`. `tab-recovery.mjs` already imports `session.mjs`; placing the predicate there would force `session.mjs` to import its consumer and create a cycle. `isSafeChatGptConversationUrl` becomes a compatibility alias of the canonical predicate.

## Gaps covered

| Gap | Current failure | Planned closure |
| --- | --- | --- |
| G29 | `isSafeChatGptConversationUrl` partially accepts `/c/WEB:...`; ChatGPT create/update paths persist roots and transient routes | Add one pathname-only durable predicate and enforce it at `createSession` and `updateSession`, preserving the prior durable value |

## File change map

| Action | Exact path | Functions / anchors in current tree | Diff intent |
| --- | --- | --- | --- |
| NEW | `web-ai/conversation-url.mjs` | new `extractDurableConversationId`, `isDurableConversationUrl` | Canonical host/protocol/port/path predicate; no session imports |
| MODIFY | `web-ai/tab-recovery.mjs` | imports `:2-5`; `isSafeChatGptConversationUrl` `:325-346`; writes in `recoverSessionTab` `:67-82,95-120`; drift writes in `resolveSessionPage` `:472-475,536-540` | Delegate safety check to canonical predicate; keep call-site guards readable; central session gate is authoritative |
| MODIFY | `web-ai/session.mjs` | imports `:2-15`; `createSession` `:184-216`; `updateSession` `:219-226` | Gate ChatGPT creation and every patch centrally; omit rejected values so the prior durable URL survives |
| MODIFY | `web-ai/chatgpt.mjs` | initial `createSession` `:321-327`; post-commit write `:419-443`; Deep Research session creation `:1025-1036` | Pass observed URLs unchanged to the central gate; make the post-commit durability condition explicit for local clarity |
| VERIFY, no production diff | `web-ai/session-store.mjs` | `insertSession` `:322-329`; `patchSession` `:331-345` | Remains vendor-agnostic persistence; validation belongs in `session.mjs`, its public domain boundary |
| MODIFY | `test/unit/web-ai-tab-recovery.test.mjs` | predicate imports `:38-44`; guard cases after `:145` | Add executable durable/path/host boundary matrix |
| MODIFY | `test/unit/web-ai-provider-session.test.mjs` | existing session behavior suite | Add central create/update preservation tests, including all indirect ChatGPT writers |

### Enumerated ChatGPT persistence sites

`rg -n "conversationUrl\s*:" web-ai --glob '*.mjs'` found these persisted-session producers. The central `createSession` / `updateSession` gate covers all of them, including sites outside the original research anchors:

- `web-ai/tab-recovery.mjs:68,81,112-120,475,540`
- `web-ai/session.mjs:202,224-226` (central creation and patch boundaries)
- `web-ai/chatgpt.mjs:321-327,440-443,1029-1036`
- `web-ai/chatgpt-deep-research.mjs:311,335-339,432`
- `web-ai/chatgpt-multi-turn.mjs:209-216`
- `web-ai/chatgpt-work-picker.mjs:871-885`

Result/DTO-only `conversationUrl` fields (for example `chatgpt-deep-research.mjs:231,271,315,348,384,439,458`) are not store writes and are not rewritten by this phase. `cli.mjs:1942` and `mcp-server.mjs:254` feed `createSession`, so they are covered at the boundary. Gemini/Grok writers are intentionally unaffected.

## Proposed diffs

### 1. Add the canonical dependency-leaf predicate

Before: no file.

After — `web-ai/conversation-url.mjs`:

```js
// @ts-check

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const DURABLE_CONVERSATION_PATH = /(?:^|\/)c\/([A-Za-z0-9-]+)(?=\/|$)/;

/**
 * @param {string|null|undefined} candidate
 * @returns {string|null}
 */
export function extractDurableConversationId(candidate) {
    if (typeof candidate !== 'string' || candidate === '') return null;
    if (candidate.includes('..') || candidate.includes('\\') || candidate.includes('\0')) return null;
    try {
        const url = new URL(candidate);
        if (url.protocol !== 'https:') return null;
        if (url.port !== '') return null;
        if (!CHATGPT_HOSTS.has(url.hostname)) return null;
        return url.pathname.match(DURABLE_CONVERSATION_PATH)?.[1] || null;
    } catch {
        return null;
    }
}

/**
 * @param {string|null|undefined} candidate
 * @returns {boolean}
 */
export function isDurableConversationUrl(candidate) {
    return extractDurableConversationId(candidate) !== null;
}
```

The look-ahead is pathname-specific: `?` and `#` cannot occur in `URL.pathname`, so the executable boundary is `/` or end. Parsing before matching is what rejects `https://chatgpt.com/?next=/c/abc` and `https://chatgpt.com/#/c/abc`.

### 2. Make the existing reattach predicate canonical-by-delegation

Before — `web-ai/tab-recovery.mjs:334-346`:

```js
export function isSafeChatGptConversationUrl(url) {
    if (typeof url !== 'string' || url === '') return false;
    if (url.includes('..') || url.includes('\\') || url.includes('\0')) return false;
    let u;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:') return false;
    if (u.hostname !== 'chatgpt.com' && u.hostname !== 'chat.openai.com') return false;
    return /\/c\/[A-Za-z0-9_-]+/.test(u.pathname);
}
```

After:

```js
import { isDurableConversationUrl } from './conversation-url.mjs';

export function isSafeChatGptConversationUrl(url) {
    return isDurableConversationUrl(url);
}
```

Keep `openConversationInNewTab` and `resolveSessionPage` calling `isSafeChatGptConversationUrl`; their public behavior and tests remain stable while persistence and reattach share one implementation.

### 3. Enforce persistence at the session boundary

Before — `web-ai/session.mjs:201-202,224-226`:

```js
originalUrl: meta.originalUrl || null,
conversationUrl: meta.conversationUrl || meta.originalUrl || null,
```

```js
export function updateSession(sessionId, patch = {}) {
    return patchSession(sessionId, { ...patch, updatedAt: new Date().toISOString() });
}
```

After:

```js
import { isDurableConversationUrl } from './conversation-url.mjs';
```

```js
const vendor = envelope?.vendor || meta.vendor || null;
const observedConversationUrl = meta.conversationUrl || meta.originalUrl || null;
const conversationUrl = vendor === 'chatgpt'
    ? (isDurableConversationUrl(observedConversationUrl) ? observedConversationUrl : null)
    : observedConversationUrl;

/** @type {WebAiSession} */
const session = {
    sessionId: generateSessionId(),
    vendor,
    // existing fields unchanged
    originalUrl: meta.originalUrl || null,
    conversationUrl,
    // existing fields unchanged
};
```

```js
export function updateSession(sessionId, patch = {}) {
    const current = getSession(sessionId);
    if (!current) return null;
    const nextPatch = { ...patch };
    if (
        current.vendor === 'chatgpt' &&
        Object.hasOwn(nextPatch, 'conversationUrl') &&
        !isDurableConversationUrl(/** @type {string|null|undefined} */ (nextPatch.conversationUrl))
    ) {
        delete nextPatch.conversationUrl;
    }
    return patchSession(sessionId, { ...nextPatch, updatedAt: new Date().toISOString() });
}
```

Deleting the rejected patch key, rather than assigning `null`, is the preservation mechanism. Status, answer, warnings, and other fields in the same patch still persist.

### 4. Make the normal send site self-documenting

Before — `web-ai/chatgpt.mjs:440-443`:

```js
const finalUrl = page.url();
if (session && finalUrl !== session.conversationUrl) {
    updateSession(session.sessionId, { conversationUrl: finalUrl });
}
```

After:

```js
const finalUrl = page.url();
if (session && isDurableConversationUrl(finalUrl) && finalUrl !== session.conversationUrl) {
    updateSession(session.sessionId, { conversationUrl: finalUrl });
}
```

Add `import { isDurableConversationUrl } from './conversation-url.mjs';`. Other producers may continue passing observed URLs to `updateSession`; the central gate is mandatory because it covers Deep Research, multi-turn, Work, CLI/MCP session creation, and future call sites.

## Test plan

Repository test command is `npm test` (`package.json:41`, Vitest). Focused implementation command:

```sh
npx vitest run test/unit/web-ai-tab-recovery.test.mjs test/unit/web-ai-provider-session.test.mjs --reporter=verbose
```

New focused cases:

- `isDurableConversationUrl accepts segment-bounded ChatGPT conversation paths`
- `isDurableConversationUrl accepts a conversation below a GPT prefix`
- `isDurableConversationUrl rejects /c/WEB: transient routes without partial matching`
- `isDurableConversationUrl rejects underscore and colon ids`
- `isDurableConversationUrl rejects bare origins, project paths, foreign hosts, HTTP, and explicit ports`
- `isDurableConversationUrl rejects query-only and fragment-only /c/ hints`
- `createSession stores null for a non-durable initial ChatGPT URL but preserves originalUrl`
- `createSession leaves Gemini and Grok conversation URL behavior unchanged`
- `updateSession preserves the last durable ChatGPT URL when patched with root or transient URL`
- `updateSession still applies status/answer fields beside a rejected conversationUrl`
- `updateSession accepts a later durable URL after an initial root URL`

Full regression command after focused green:

```sh
npm test
```

## Accept criteria

- One implementation of the durable predicate exists and both persistence and reattach use it.
- Every persisted ChatGPT URL passes protocol, no-port, allowed-host, parsed-path, id-character, and segment-boundary checks.
- A transient/root observation cannot overwrite or erase an existing durable URL.
- Non-URL patch fields persist even when `conversationUrl` is rejected.
- Gemini and Grok behavior does not change.
- Focused tests and the full Vitest suite pass.

### C-ACTIVATION-GROUNDING-01 activation scenarios

| Conditional path | How to trigger | Observable proof that the branch fired |
| --- | --- | --- |
| Durable initial ChatGPT URL | Create a ChatGPT session with `https://chatgpt.com/c/abc-123` | Stored `conversationUrl` equals the candidate |
| Initial root/transient rejection | Create with `/` or `/c/WEB:req-1` | Stored `conversationUrl === null`; `originalUrl` retains the observed page |
| Durable update acceptance | Patch a ChatGPT session from null to `/c/abc-123` | Store changes to the durable URL |
| Last-durable preservation | Patch an existing durable URL with `/`, `/c/WEB:req-2`, or query-only hint | Stored URL remains byte-for-byte unchanged while `updatedAt`/other patch fields advance |
| Segment-boundary rejection | Evaluate `/c/abc_def` and `/c/abc:def` | Predicate returns false; no partial `abc` match |
| Path-only rejection | Evaluate `/?next=/c/abc` and `/#/c/abc` | Predicate returns false |
| Reattach guard | Call `openConversationInNewTab` with a transient candidate | Returns `{ opened: false, reason: 'unsafe-conversation-url' }`; `createTab` is not called |
| Vendor bypass | Patch a Gemini session with its normal conversation URL | URL persists unchanged |

## Risks / rollback

- **Legacy poisoned records:** this phase prevents new bad writes but does not migrate existing roots/transient values. Recovery continues to fail closed; a separate migration is out of scope.
- **Unexpected ChatGPT id alphabet:** the upstream contract intentionally excludes underscore and colon. If ChatGPT introduces a new durable alphabet, update the one regex and its matrix rather than weakening call sites.
- **Central-boundary coupling:** `updateSession` performs one read before patch. This is acceptable for the file-backed store but must remain inside the existing lock semantics; do not move validation into `session-store.mjs`, which is vendor-neutral.
- **Rollback:** revert the new import/predicate and session boundary gate together. Do not roll back only `tab-recovery.mjs`, which would reintroduce mismatch between persistence and navigation safety.

