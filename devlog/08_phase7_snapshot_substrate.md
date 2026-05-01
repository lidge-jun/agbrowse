# Phase 7 — Agent snapshot substrate

Agent-facing representation of provider UI state. Gives agents a compact,
token-efficient view of what they can interact with — without reading raw
DOM or relying on screenshots.

Inspired by Vercel Labs agent-browser (@eN refs + accessibility snapshots),
Playwright MCP (snapshot-local refs), and AgentQL (semantic descriptors).

Depends on Phase 4 (doctor uses snapshot internally).

## Motivation

Phase 4 doctor diagnoses *what broke*. Phase 7 gives agents a standard way
to *see* the provider UI so they can decide what to do next — or let a
human debug faster.

Key insight from research: accessibility tree snapshots are ~200-400 tokens
vs ~3000-5000 for screenshots. Every major agent browser project converges
on this as the primary interface.

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | AX snapshot + ref registry | NEW `web-ai/ax-snapshot.mjs`; NEW `web-ai/ref-registry.mjs`; MODIFY `web-ai/types.mjs`; unit tests. |
| **PR2** | Observe-targets + CLI surface | NEW `web-ai/observe-targets.mjs`; NEW `web-ai/vendor-editor-contract.mjs`; MODIFY `web-ai/cli.mjs`; MODIFY `web-ai/doctor.mjs`; MODIFY skill docs. |

## Core types

```js
/**
 * @typedef {Object} WebAiSnapshot
 * @property {string} snapshotId
 * @property {'chatgpt'|'gemini'|'grok'} provider
 * @property {string} url
 * @property {string} domHash
 * @property {string} axHash
 * @property {string} text          — compact accessible tree as text
 * @property {Record<string, ElementRef>} refs
 * @property {{nodeCount:number, interactiveCount:number, tokenEstimate:number}} stats
 */

/**
 * @typedef {Object} ElementRef
 * @property {string} ref           — e.g. "@e12"
 * @property {string} role          — textbox, button, link
 * @property {string} name          — accessible name or compact label
 * @property {string|null} selector
 * @property {string[]} framePath
 * @property {string[]} shadowPath
 * @property {string} signatureHash
 */
```

## Diffs (PR1)

### NEW `web-ai/ax-snapshot.mjs`

API surface:

```js
export async function buildWebAiSnapshot(page, options = {}) {}
export function estimateSnapshotTokens(snapshotText) {}
export function hashAccessibilitySnapshot(snapshotText) {}
export function extractInteractiveRefs(snapshot) {}
export function summarizeSnapshotForDoctor(snapshot) {}
```

Skeleton:

```js
import { createHash } from 'node:crypto';

export async function buildWebAiSnapshot(page, {
    provider = null,
    compact = true,
    interactiveOnly = true,
    maxDepth = 6,
    rootSelector = null,
} = {}) {
    const tree = await page.accessibility.snapshot({ interestingOnly: interactiveOnly });
    const text = serializeAxTree(tree, { compact, maxDepth });
    const refs = extractInteractiveRefs(tree);
    return {
        snapshotId: crypto.randomUUID(),
        provider,
        url: page.url(),
        domHash: null,
        axHash: hashAccessibilitySnapshot(text),
        text,
        refs,
        stats: {
            nodeCount: countNodes(tree),
            interactiveCount: Object.keys(refs).length,
            tokenEstimate: estimateSnapshotTokens(text),
        },
    };
}

export function hashAccessibilitySnapshot(text) {
    return `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
}

export function estimateSnapshotTokens(text) {
    return Math.ceil(text.length / 4);
}

export function extractInteractiveRefs(tree, prefix = '@e') {
    const refs = {};
    let counter = 1;
    function walk(node) {
        if (!node) return;
        if (node.role && ['textbox', 'button', 'link', 'menuitem', 'combobox', 'checkbox'].includes(node.role)) {
            const ref = `${prefix}${counter++}`;
            refs[ref] = { ref, role: node.role, name: node.name || '', selector: null, framePath: [], shadowPath: [], signatureHash: '' };
        }
        if (node.children) node.children.forEach(walk);
    }
    walk(tree);
    return refs;
}

export function summarizeSnapshotForDoctor(snapshot) {
    const topRefs = Object.values(snapshot.refs).slice(0, 5);
    return {
        enabled: true,
        snapshotId: snapshot.snapshotId,
        axHash: snapshot.axHash,
        interactiveCount: snapshot.stats.interactiveCount,
        tokenEstimate: snapshot.stats.tokenEstimate,
        topRefs: topRefs.map(r => ({ ref: r.ref, role: r.role, name: r.name })),
    };
}
```

### NEW `web-ai/ref-registry.mjs`

API surface:

```js
export function createRefRegistry(snapshot) {}
export async function resolveRef(page, registry, ref, options = {}) {}
export function invalidateRefsOnDomChange(registry, context) {}
```

Skeleton:

```js
export function createRefRegistry(snapshot) {
    return {
        snapshotId: snapshot.snapshotId,
        axHash: snapshot.axHash,
        domHash: snapshot.domHash,
        refs: { ...snapshot.refs },
        createdAt: Date.now(),
    };
}

export async function resolveRef(page, registry, ref, {
    expectedSnapshotId = null,
    allowStale = false,
} = {}) {
    if (expectedSnapshotId && registry.snapshotId !== expectedSnapshotId && !allowStale) {
        throw new Error(`ref ${ref} belongs to snapshot ${expectedSnapshotId} but registry is ${registry.snapshotId}`);
    }
    const entry = registry.refs[ref];
    if (!entry) throw new Error(`ref ${ref} not found in registry`);
    return entry;
}

export function invalidateRefsOnDomChange(registry, { domHash, axHash }) {
    if (registry.axHash !== axHash || registry.domHash !== domHash) {
        registry.refs = {};
        registry.axHash = axHash;
        registry.domHash = domHash;
    }
}
```

**Key rule:** refs are NOT permanent selectors. They are bound to
`snapshotId + axHash + domHash`. After navigation, streaming completion,
or provider DOM churn, refs must be invalidated and a new snapshot taken.

## Diffs (PR2)

### NEW `web-ai/observe-targets.mjs`

API surface:

```js
export async function observeProviderTargets(page, options = {}) {}
export function rankTargetCandidates(candidates, criteria) {}
```

Skeleton:

```js
export async function observeProviderTargets(page, {
    provider,
    featureMap,
    snapshot,
} = {}) {
    const results = {};
    for (const [feature, target] of Object.entries(featureMap.semanticTargets || {})) {
        const candidates = [];
        if (snapshot) {
            for (const ref of Object.values(snapshot.refs)) {
                if (target.roles?.includes(ref.role) && target.names?.some(p => p.test(ref.name))) {
                    candidates.push({ source: 'snapshot-ref', ref: ref.ref, role: ref.role, name: ref.name });
                }
            }
        }
        for (const sel of target.cssFallbacks || []) {
            const count = await page.locator(sel).count().catch(() => 0);
            if (count > 0) candidates.push({ source: 'css', selector: sel, count });
        }
        results[feature] = candidates;
    }
    return results;
}

export function rankTargetCandidates(candidates, { expectedRole, expectedNames }) {
    return candidates.sort((a, b) => {
        const aScore = (a.role === expectedRole ? 2 : 0) + (expectedNames?.some(p => p.test(a.name)) ? 1 : 0);
        const bScore = (b.role === expectedRole ? 2 : 0) + (expectedNames?.some(p => p.test(b.name)) ? 1 : 0);
        return bScore - aScore;
    });
}
```

### NEW `web-ai/vendor-editor-contract.mjs`

Semantic descriptors per provider, shared by observe-targets, self-heal,
and doctor:

```js
export const CHATGPT_EDITOR_TARGETS = {
    composer: {
        roles: ['textbox'],
        names: [/message/i, /prompt/i],
        excludeNames: [/search/i],
        cssFallbacks: CHATGPT_COMPOSER_SELECTORS,
        required: true,
    },
    uploadSurface: {
        roles: ['button'],
        names: [/attach/i, /upload/i, /file/i],
        cssFallbacks: CHATGPT_UPLOAD_SELECTORS,
    },
    copyButton: {
        roles: ['button'],
        names: [/copy/i],
        cssFallbacks: CHATGPT_COPY_SELECTORS.copyButtonSelectors,
    },
};
```

### MODIFY `web-ai/cli.mjs` — add snapshot command

```js
const COMMANDS = new Set([
    'render', 'status', 'send', 'poll', 'query', 'stop',
    'sessions', 'resume', 'reattach',
    'doctor', 'snapshot',
    'context-dry-run', 'context-render',
]);
```

CLI:

```
agbrowse web-ai snapshot --vendor chatgpt --interactive --compact --json
```

### MODIFY `web-ai/doctor.mjs` — include snapshot in report

Doctor report gains a `snapshot` section when `--snapshot interactive` is
passed:

```json
{
  "snapshot": {
    "enabled": true,
    "snapshotId": "01J...",
    "axHash": "sha256:...",
    "interactiveCount": 37,
    "tokenEstimate": 418,
    "topRefs": [
      { "ref": "@e1", "role": "textbox", "name": "Message ChatGPT" },
      { "ref": "@e2", "role": "button", "name": "Attach files" }
    ]
  }
}
```

Doctor also gains observe-targets output:
"current selector is 0 matches but snapshot semantic candidate is 2" — the
most useful signal for DOM churn PRs.

## Public-surface changes

- New command: `web-ai snapshot --vendor <v> [--interactive] [--compact] [--json]`
- Doctor gains `--snapshot interactive` option.
- New internal modules: `ax-snapshot.mjs`, `ref-registry.mjs`, `observe-targets.mjs`, `vendor-editor-contract.mjs`.
- `@eN` refs are internal-only in Phase 7. Public `click @e12` deferred to Phase 10.

## Test plan

- Unit: `buildWebAiSnapshot` returns valid `WebAiSnapshot` with refs for a
  fake page with known accessible roles.
- Unit: `extractInteractiveRefs` counts match known interactive elements.
- Unit: `hashAccessibilitySnapshot` is stable for same content, unstable for
  structural changes.
- Unit: `invalidateRefsOnDomChange` clears refs when hash changes.
- Unit: `observeProviderTargets` returns snapshot-ref and css candidates.
- Privacy: snapshot text does not contain raw user prompt/response text.

## Exit criteria

- An agent can call `web-ai snapshot --vendor chatgpt --json` and receive a
  compact representation (< 500 tokens) of what it can interact with.
- Doctor report includes snapshot section that helps diagnose selector
  breakage without looking at raw DOM.

## Risks

- **Most likely:** Playwright `page.accessibility.snapshot()` returns
  different trees across Chromium versions. Mitigate by testing against
  pinned Chromium and normalizing role names.
- **Secondary:** token estimate diverges significantly from actual LLM
  tokenization. Mitigate by calibrating with tiktoken on real snapshots.

## cli-jaw mirror

cli-jaw's registry already has `WebAiCapability` with evidence. Phase 7
adds:

| Item | cli-jaw status |
| --- | --- |
| `ax-snapshot` | **Port as-is** to `src/browser/web-ai/ax-snapshot.ts`. |
| `ref-registry` | **Port as-is**. |
| `observe-targets` | **Port as-is**. |
| `vendor-editor-contract` | **Map to existing** vendor configs in `src/browser/web-ai/vendors/`. |
| `snapshot` CLI command | **Add** to `bin/commands/browser-web-ai.ts`. |
| Doctor snapshot section | **Extend** existing diagnose response. |
