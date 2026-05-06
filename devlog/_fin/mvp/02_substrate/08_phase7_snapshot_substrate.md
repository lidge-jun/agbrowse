# Phase 7 — Agent Snapshot Substrate

GPT Pro diff-level plan finalized 2026-05-01. Research sources: Playwright MCP
YAML-like accessibility snapshots (~200-400 tokens vs ~3000-5000 for screenshots),
Playwright ARIA snapshot docs, Stagehand observe/act self-healing patterns,
AgentQL semantic descriptors.

**Critical risk:** Playwright `page.accessibility` was removed in v1.57 after
deprecation. Phase 7 must either pin to a compatible Playwright version or add
a CDP/ARIA fallback in `captureAccessibilitySnapshot()`.

## Scope

Implement:

```bash
agbrowse web-ai snapshot --vendor chatgpt --interactive --compact --json
agbrowse web-ai doctor --vendor chatgpt --snapshot interactive
```

Key behavior:

* uses `page.accessibility.snapshot()` as the capture foundation;
* serializes to Playwright MCP-style YAML-like text;
* assigns monotonic `@eN` refs to interactive nodes;
* invalidates refs when `domHash` or `axHash` changes;
* keeps doctor snapshot output content-safe by hashing names and never emitting
  snapshot text or raw accessible names in doctor reports.

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | AX snapshot + ref registry | NEW `ax-snapshot.mjs`, `ref-registry.mjs`; MODIFY `types.mjs`; unit tests |
| **PR2** | Observe-targets + CLI surface | NEW `observe-targets.mjs`, `vendor-editor-contract.mjs`; MODIFY `cli.mjs`, `doctor.mjs`; unit tests |

---

## File plan

| Action | File | Description |
| --- | --- | --- |
| **NEW** | `web-ai/ax-snapshot.mjs` | ~220 lines. AX tree capture, serialization, hashing, ref extraction, doctor summary. |
| **NEW** | `web-ai/ref-registry.mjs` | ~80 lines. Snapshot-bound ref registry with staleness detection and invalidation. |
| **NEW** | `web-ai/observe-targets.mjs` | ~65 lines. Semantic target observation using snapshot refs + CSS fallbacks. |
| **NEW** | `web-ai/vendor-editor-contract.mjs` | ~100 lines. Per-vendor semantic target descriptors (composer, upload, copy, streaming). |
| **MODIFY** | `web-ai/types.mjs` | Add `ElementRef` and `WebAiSnapshot` typedefs. |
| **MODIFY** | `web-ai/doctor.mjs` | Add `snapshot` and `semanticTargets` sections when `--snapshot interactive`. |
| **MODIFY** | `web-ai/cli.mjs` | Add `snapshot` command, help text, arg parsing, doctor `--snapshot` option. |

---

## NEW file: `web-ai/ax-snapshot.mjs`

### Exported API surface

```js
export const DEFAULT_SNAPSHOT_MAX_DEPTH;       // 6
export const DEFAULT_MAX_NAME_CHARS;           // 900
export const DEFAULT_INTERACTIVE_ROLES;        // Set of 20 roles

export async function buildWebAiSnapshot(page, options = {});
export function estimateSnapshotTokens(snapshotText);
export function hashAccessibilitySnapshot(snapshotText);
export function extractInteractiveRefs(snapshot, prefix = '@e');
export function summarizeSnapshotForDoctor(snapshot, options = {});
```

### Complete skeleton

```js
import { createHash, randomUUID } from 'node:crypto';
import { domHashAround } from './dom-hash.mjs';
import { WebAiError } from './errors.mjs';

export const DEFAULT_SNAPSHOT_MAX_DEPTH = 6;
export const DEFAULT_MAX_NAME_CHARS = 900;
export const DEFAULT_INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
    'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab',
    'slider', 'spinbutton', 'treeitem', 'listbox', 'gridcell', 'cell',
]);

export async function buildWebAiSnapshot(page, {
    provider = null,
    compact = true,
    interactiveOnly = true,
    maxDepth = DEFAULT_SNAPSHOT_MAX_DEPTH,
    rootSelector = null,
    refPrefix = '@e',
    redactText = false,
    includeDomHash = true,
    domHashMaxChars = 32768,
} = {}) {
    const tree = await captureAccessibilitySnapshot(page, { interactiveOnly, rootSelector });
    const serialized = serializeAxTree(tree, { compact, maxDepth, refPrefix, redactText });
    const domHash = includeDomHash
        ? await domHashAround(page, rootSelector ? [rootSelector] : ['body'], { maxChars: domHashMaxChars }).catch(() => null)
        : null;
    const text = serialized.text || '- document';
    return {
        snapshotId: randomUUID(),
        provider,
        url: page.url?.() || null,
        domHash,
        axHash: hashAccessibilitySnapshot(text),
        text,
        refs: serialized.refs,
        stats: {
            nodeCount: serialized.nodeCount,
            interactiveCount: Object.keys(serialized.refs).length,
            tokenEstimate: estimateSnapshotTokens(text),
        },
    };
}

export function estimateSnapshotTokens(snapshotText) {
    return Math.ceil(String(snapshotText || '').length / 4);
}

export function hashAccessibilitySnapshot(snapshotText) {
    const normalized = String(snapshotText || '').replace(/\s+/g, ' ').trim();
    return `sha256:${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

export function extractInteractiveRefs(snapshot, prefix = '@e') {
    if (snapshot?.refs && typeof snapshot.refs === 'object') return { ...snapshot.refs };
    const refs = {};
    let counter = 1;
    walkAx(snapshot, (node, depth, path) => {
        if (!isInteractiveNode(node)) return;
        const ref = `${prefix}${counter++}`;
        const name = truncateName(node.name || '');
        refs[ref] = {
            ref,
            role: String(node.role || 'unknown'),
            name,
            selector: null,
            framePath: [],
            shadowPath: [],
            signatureHash: hashElementSignature({ role: node.role, name, depth, path }),
        };
    });
    return refs;
}

export function summarizeSnapshotForDoctor(snapshot, { maxRefs = 8 } = {}) {
    const refs = Object.values(snapshot?.refs || {}).slice(0, maxRefs);
    return {
        enabled: true,
        contentSafe: true,
        snapshotId: snapshot?.snapshotId || null,
        axHash: snapshot?.axHash || null,
        domHash: snapshot?.domHash || null,
        interactiveCount: snapshot?.stats?.interactiveCount || 0,
        tokenEstimate: snapshot?.stats?.tokenEstimate || 0,
        topRefs: refs.map(ref => ({
            ref: ref.ref,
            role: ref.role,
            nameHash: ref.name ? hashDoctorField(ref.name) : null,
            nameChars: ref.name ? ref.name.length : 0,
        })),
    };
}

// --- internal ---

async function captureAccessibilitySnapshot(page, { interactiveOnly, rootSelector }) {
    if (!page?.accessibility || typeof page.accessibility.snapshot !== 'function') {
        throw new WebAiError({
            errorCode: 'snapshot.unavailable',
            stage: 'snapshot-capture',
            retryHint: 'pin-playwright-or-add-cdp-fallback',
            message: 'page.accessibility.snapshot() is not available in this Playwright runtime',
        });
    }
    let root = null;
    try {
        if (rootSelector) {
            root = await page.locator(rootSelector).elementHandle().catch(() => null);
            if (!root) {
                throw new WebAiError({
                    errorCode: 'snapshot.root-not-found',
                    stage: 'snapshot-capture',
                    retryHint: 'fix-root-selector',
                    message: `snapshot root selector did not match: ${rootSelector}`,
                    evidence: { rootSelector },
                });
            }
        }
        return await page.accessibility.snapshot({ interestingOnly: interactiveOnly, ...(root ? { root } : {}) });
    } finally {
        await root?.dispose?.().catch(() => undefined);
    }
}

function serializeAxTree(tree, options) {
    const ctx = { ...options, refs: {}, nextRef: 1, nodeCount: 0 };
    const lines = serializeNode(tree || { role: 'document', name: '' }, 0, ctx, []);
    return { text: lines.join('\n'), refs: ctx.refs, nodeCount: ctx.nodeCount };
}

function serializeNode(node, depth, ctx, path) {
    if (!node || depth > ctx.maxDepth) return [];
    ctx.nodeCount += 1;
    const role = sanitizeRole(node.role || 'generic');
    const rawName = truncateName(node.name || '');
    const name = ctx.redactText && rawName ? `[redacted:${hashDoctorField(rawName)}]` : rawName;
    const indent = '  '.repeat(depth);
    const attrs = [];

    if (isInteractiveNode(node)) {
        const ref = `${ctx.refPrefix}${ctx.nextRef++}`;
        attrs.push(`ref=${ref}`);
        ctx.refs[ref] = {
            ref, role, name: rawName,
            selector: null, framePath: [], shadowPath: [],
            signatureHash: hashElementSignature({ role, name: rawName, depth, path }),
        };
    }
    for (const attr of ['checked', 'disabled', 'expanded', 'selected', 'pressed', 'level', 'value']) {
        if (node[attr] !== undefined && node[attr] !== null && node[attr] !== '') attrs.push(`${attr}=${formatAttrValue(node[attr])}`);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    const singleText = ctx.compact ? singleTextChild(node) : null;
    if (role === 'text') return [`${indent}- text: ${quoteAxString(name)}`];
    if (singleText && !name) {
        const renderedText = ctx.redactText ? `[redacted:${hashDoctorField(singleText)}]` : truncateName(singleText);
        return [`${indent}- ${role}: ${quoteAxString(renderedText)}${attrs.length ? ` [${attrs.join(' ')}]` : ''}`];
    }

    const head = `${indent}- ${role}${name ? ` ${quoteAxString(name)}` : ''}${attrs.length ? ` [${attrs.join(' ')}]` : ''}${children.length ? ':' : ''}`;
    const out = [head];
    children.forEach((child, index) => out.push(...serializeNode(child, depth + 1, ctx, [...path, index])));
    return out;
}

function walkAx(node, visit, depth = 0, path = []) {
    if (!node) return;
    visit(node, depth, path);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child, index) => walkAx(child, visit, depth + 1, [...path, index]));
}

function isInteractiveNode(node) {
    if (!node?.role) return false;
    if (DEFAULT_INTERACTIVE_ROLES.has(String(node.role))) return true;
    return node.focused === true || node.focusable === true;
}

function singleTextChild(node) {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length !== 1) return null;
    const child = children[0];
    if (child?.role !== 'text' || !child.name) return null;
    return child.name;
}

function truncateName(value, max = DEFAULT_MAX_NAME_CHARS) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function sanitizeRole(role) {
    return String(role || 'generic').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function quoteAxString(value) { return JSON.stringify(String(value || '')); }

function formatAttrValue(value) {
    if (typeof value === 'string') return JSON.stringify(truncateName(value, 120));
    return String(value);
}

function hashElementSignature(input) {
    return `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)}`;
}

function hashDoctorField(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}
```

---

## NEW file: `web-ai/ref-registry.mjs`

### Exported API surface

```js
export function createRefRegistry(snapshot);
export async function resolveRef(page, registry, ref, options = {});
export function invalidateRefsOnDomChange(registry, context = {});
export function isRegistryStale(registry, context = {});
```

### Complete skeleton

```js
import { WebAiError } from './errors.mjs';

export function createRefRegistry(snapshot) {
    return {
        snapshotId: snapshot?.snapshotId || null,
        axHash: snapshot?.axHash || null,
        domHash: snapshot?.domHash || null,
        refs: { ...(snapshot?.refs || {}) },
        createdAt: Date.now(),
        stale: false,
        invalidatedAt: null,
    };
}

export async function resolveRef(page, registry, ref, {
    expectedSnapshotId = null,
    currentDomHash = null,
    currentAxHash = null,
    allowStale = false,
} = {}) {
    void page;
    const normalized = normalizeRef(ref);
    if (!allowStale) assertRegistryFresh(registry, { expectedSnapshotId, currentDomHash, currentAxHash, ref: normalized });
    const entry = registry?.refs?.[normalized];
    if (!entry) {
        throw new WebAiError({
            errorCode: 'snapshot.ref-not-found',
            stage: 'snapshot-ref-resolve',
            retryHint: 're-snapshot',
            message: `ref ${normalized} not found in current snapshot registry`,
            evidence: { ref: normalized, snapshotId: registry?.snapshotId || null },
        });
    }
    return entry;
}

export function invalidateRefsOnDomChange(registry, { domHash = null, axHash = null } = {}) {
    if (!registry) return false;
    const changed = (domHash && registry.domHash && domHash !== registry.domHash)
        || (axHash && registry.axHash && axHash !== registry.axHash);
    if (!changed) return false;
    registry.refs = {};
    registry.domHash = domHash || registry.domHash;
    registry.axHash = axHash || registry.axHash;
    registry.stale = true;
    registry.invalidatedAt = Date.now();
    return true;
}

export function isRegistryStale(registry, { expectedSnapshotId = null, currentDomHash = null, currentAxHash = null } = {}) {
    if (!registry || registry.stale === true) return true;
    if (expectedSnapshotId && registry.snapshotId !== expectedSnapshotId) return true;
    if (currentDomHash && registry.domHash && currentDomHash !== registry.domHash) return true;
    if (currentAxHash && registry.axHash && currentAxHash !== registry.axHash) return true;
    return false;
}

function assertRegistryFresh(registry, context = {}) {
    if (!isRegistryStale(registry, context)) return;
    throw new WebAiError({
        errorCode: 'snapshot.ref-stale',
        stage: 'snapshot-ref-resolve',
        retryHint: 're-snapshot',
        message: `ref ${context.ref || ''} belongs to a stale snapshot registry`.trim(),
        evidence: {
            snapshotId: registry?.snapshotId || null,
            expectedSnapshotId: context.expectedSnapshotId || null,
            domHash: registry?.domHash || null,
            currentDomHash: context.currentDomHash || null,
            axHash: registry?.axHash || null,
            currentAxHash: context.currentAxHash || null,
        },
    });
}

function normalizeRef(ref) {
    const value = String(ref || '').trim();
    if (!value) return value;
    if (value.startsWith('@')) return value;
    return `@${value}`;
}
```

**Key rule:** refs are NOT permanent selectors. They are bound to
`snapshotId + axHash + domHash`. After navigation, streaming completion,
or provider DOM churn, refs must be invalidated and a new snapshot taken.

---

## NEW file: `web-ai/observe-targets.mjs`

### Complete skeleton

```js
export async function observeProviderTargets(page, {
    provider = null,
    featureMap = {},
    snapshot = null,
} = {}) {
    void provider;
    const semanticTargets = featureMap.semanticTargets || featureMap || {};
    const results = {};
    for (const [feature, target] of Object.entries(semanticTargets)) {
        const candidates = [];
        if (snapshot?.refs) {
            for (const ref of Object.values(snapshot.refs)) {
                if (!targetMatchesRef(target, ref)) continue;
                candidates.push({
                    source: 'snapshot-ref', ref: ref.ref,
                    role: ref.role, name: ref.name || '',
                    confidence: scoreCandidate({ role: ref.role, name: ref.name || '' }, target),
                });
            }
        }
        for (const selector of target.cssFallbacks || []) {
            const count = await page.locator(selector).count().catch(() => 0);
            if (count > 0) candidates.push({ source: 'css', selector, count, confidence: count === 1 ? 2 : 1 });
        }
        results[feature] = rankTargetCandidates(candidates, {
            expectedRole: target.roles?.[0] || null,
            expectedNames: target.names || [],
        });
    }
    return results;
}

export function rankTargetCandidates(candidates, { expectedRole = null, expectedNames = [] } = {}) {
    return [...(candidates || [])].sort((a, b) => {
        const aScore = Number(a.confidence || 0)
            + (expectedRole && a.role === expectedRole ? 2 : 0)
            + (expectedNames.some(pattern => pattern.test?.(a.name || '')) ? 1 : 0)
            + (a.source === 'snapshot-ref' ? 0.5 : 0);
        const bScore = Number(b.confidence || 0)
            + (expectedRole && b.role === expectedRole ? 2 : 0)
            + (expectedNames.some(pattern => pattern.test?.(b.name || '')) ? 1 : 0)
            + (b.source === 'snapshot-ref' ? 0.5 : 0);
        return bScore - aScore;
    });
}

function targetMatchesRef(target, ref) {
    if (target.roles?.length && !target.roles.includes(ref.role)) return false;
    const name = ref.name || '';
    if (target.excludeNames?.some(pattern => pattern.test(name))) return false;
    if (target.names?.length && !target.names.some(pattern => pattern.test(name))) return false;
    return true;
}

function scoreCandidate(candidate, target) {
    let score = 0;
    if (target.roles?.includes(candidate.role)) score += 2;
    if (target.names?.some(pattern => pattern.test(candidate.name || ''))) score += 2;
    if (target.required) score += 1;
    return score;
}
```

---

## NEW file: `web-ai/vendor-editor-contract.mjs`

Per-vendor semantic target descriptors. Imports existing selector arrays from
`copy-markdown.mjs` and `chatgpt-model.mjs`. Exports:

```js
export const CHATGPT_EDITOR_CONTRACT;
export const GEMINI_EDITOR_CONTRACT;
export const GROK_EDITOR_CONTRACT;
export const EDITOR_CONTRACT_BY_VENDOR;
export function editorContractForVendor(vendor = 'chatgpt');
export function semanticTargetsForVendor(vendor = 'chatgpt');
```

Each contract defines semantic targets for: `composer`, `modelPicker`,
`uploadSurface`, `responseFeed`, `copyButton`, `streamingIndicator`.

Each target has: `roles[]`, `names[]` (regex), `excludeNames[]` (regex),
`cssFallbacks[]` (CSS selectors), optional `required: true`.

---

## MODIFY `web-ai/types.mjs`

Add JSDoc typedefs:

```js
/**
 * @typedef {Object} ElementRef
 * @property {string} ref
 * @property {string} role
 * @property {string} name
 * @property {string|null} selector
 * @property {string[]} framePath
 * @property {string[]} shadowPath
 * @property {string} signatureHash
 *
 * @typedef {Object} WebAiSnapshot
 * @property {string} snapshotId
 * @property {WebAiVendor|null} provider
 * @property {string|null} url
 * @property {string|null} domHash
 * @property {string} axHash
 * @property {string} text
 * @property {Record<string, ElementRef>} refs
 * @property {{nodeCount:number, interactiveCount:number, tokenEstimate:number}} stats
 */
```

---

## MODIFY `web-ai/doctor.mjs`

Add imports for `buildWebAiSnapshot`, `summarizeSnapshotForDoctor`,
`observeProviderTargets`, `editorContractForVendor`.

When `options.snapshot === true || options.snapshot === 'interactive'`:
1. Build AX snapshot.
2. Run `summarizeSnapshotForDoctor` (content-safe: hashes only, no raw names).
3. Run `observeProviderTargets` and sanitize output (replace `name` with
   `nameHash` + `nameChars`).
4. Add `snapshot` and `semanticTargets` to report.

If snapshot capture fails, add `snapshot-failed` warning and continue.

Doctor JSON output gains:

```json
{
  "snapshot": {
    "enabled": true,
    "contentSafe": true,
    "snapshotId": "uuid",
    "axHash": "sha256:...",
    "domHash": "sha256:...",
    "interactiveCount": 37,
    "tokenEstimate": 418,
    "topRefs": [
      { "ref": "@e1", "role": "textbox", "nameHash": "sha256:...", "nameChars": 15 }
    ]
  },
  "semanticTargets": {
    "composer": [
      { "source": "snapshot-ref", "ref": "@e1", "role": "textbox", "confidence": 5, "nameHash": "sha256:...", "nameChars": 15 },
      { "source": "css", "selector": "#prompt-textarea", "count": 1, "confidence": 2 }
    ]
  }
}
```

This intentionally does **not** include `snapshot.text` or raw accessible
names in doctor output.

---

## MODIFY `web-ai/cli.mjs`

Add `snapshot` to COMMANDS. Add `WEB_AI_SNAPSHOT_USAGE` help text. Wire arg
parsing (`--interactive`, `--compact`, `--max-depth`, `--root-selector`).
Add `--snapshot` option to doctor. Add `runSnapshotCommand` and
`printSnapshotHuman`.

New error codes in usage: `snapshot.unavailable | snapshot.ref-stale`.

New CLI help: `agbrowse web-ai snapshot --help`

```text
Usage:
  agbrowse web-ai snapshot --vendor <chatgpt|gemini|grok> [options]

Capture the active provider tab as a compact accessibility-tree snapshot.
The text format follows Playwright MCP's YAML-like shape and assigns @eN refs
to interactive elements. Refs are valid only for the captured snapshot.

Options:
  --vendor <name>       chatgpt | gemini | grok (default: chatgpt)
  --interactive         Capture interactive AX nodes. Default: true
  --compact             Compact serializer with single-text-child folding. Default: true
  --max-depth <n>       Maximum AX tree depth. Default: 6
  --root-selector <css> Restrict snapshot to a page subtree.
  --json                Print full WebAiSnapshot JSON.

Human output:
  - textbox "Message ChatGPT" [ref=@e1]
  - button "Attach files" [ref=@e2]
```

Doctor snapshot usage:

```text
agbrowse web-ai doctor --vendor <v> --snapshot interactive [--json]
```

---

## Public-surface changes

- New command: `web-ai snapshot --vendor <v> [--interactive] [--compact] [--json]`
- Doctor gains `--snapshot interactive` option.
- New internal modules: `ax-snapshot.mjs`, `ref-registry.mjs`,
  `observe-targets.mjs`, `vendor-editor-contract.mjs`.
- `@eN` refs are internal-only in Phase 7. Public `click @e12` deferred to
  Phase 10.

---

## Test plan

### `tests/unit/web-ai-ax-snapshot.test.mjs` (11 cases)

```js
test('buildWebAiSnapshot calls page.accessibility.snapshot with interestingOnly true by default');
test('buildWebAiSnapshot serializes YAML-like roles and @e refs');
test('buildWebAiSnapshot assigns monotonic @eN refs only to interactive elements');
test('buildWebAiSnapshot truncates accessible names at 900 chars');
test('buildWebAiSnapshot computes axHash and domHash');
test('buildWebAiSnapshot supports rootSelector');
test('hashAccessibilitySnapshot is stable for equivalent whitespace');
test('hashAccessibilitySnapshot changes when structure changes');
test('extractInteractiveRefs works on raw AX tree input');
test('summarizeSnapshotForDoctor omits raw names and includes nameHash/nameChars');
test('buildWebAiSnapshot throws snapshot.unavailable when page.accessibility.snapshot is missing');
```

### `tests/unit/web-ai-ref-registry.test.mjs` (10 cases)

```js
test('createRefRegistry binds refs to snapshotId axHash and domHash');
test('resolveRef returns entry when registry is fresh');
test('resolveRef accepts eN without at-sign by normalizing to @eN');
test('resolveRef throws snapshot.ref-stale when expectedSnapshotId mismatches');
test('resolveRef throws snapshot.ref-stale when currentDomHash mismatches');
test('resolveRef throws snapshot.ref-stale when currentAxHash mismatches');
test('resolveRef throws snapshot.ref-not-found for unknown ref');
test('invalidateRefsOnDomChange clears refs when domHash changes');
test('invalidateRefsOnDomChange clears refs when axHash changes');
test('invalidateRefsOnDomChange preserves refs when hashes match');
```

### `tests/unit/web-ai-observe-targets.test.mjs` (5 cases)

```js
test('observeProviderTargets returns snapshot-ref candidates for matching role and name');
test('observeProviderTargets honors excludeNames');
test('observeProviderTargets includes css fallback candidates with counts');
test('observeProviderTargets sorts higher confidence snapshot candidates first');
test('rankTargetCandidates scores expected role and expected name');
```

### `tests/unit/web-ai-cli-snapshot.test.mjs` (4 cases)

```js
test('web-ai snapshot --help prints exact snapshot help');
test('web-ai snapshot prints snapshot text in human mode');
test('web-ai snapshot --json prints WebAiSnapshot JSON');
test('web-ai snapshot passes vendor compact interactive max-depth and root-selector');
```

### `tests/unit/web-ai-doctor-snapshot.test.mjs` (6 cases)

```js
test('runDoctor without --snapshot preserves existing report shape');
test('runDoctor with snapshot interactive includes content-safe snapshot summary');
test('runDoctor with snapshot interactive never includes snapshot.text');
test('runDoctor with snapshot interactive never includes raw ref names');
test('runDoctor semanticTargets shows snapshot candidate when css selector count is zero');
test('runDoctor records snapshot-failed warning and continues when snapshot capture fails');
```

---

## Exit criteria

1. `agbrowse web-ai snapshot --vendor chatgpt` prints YAML-like text.
2. `agbrowse web-ai snapshot --vendor chatgpt --json` returns a valid `WebAiSnapshot`.
3. Refs are monotonic `@e1`, `@e2`, … and only assigned to interactive roles.
4. A ref registry invalidates refs when `domHash` or `axHash` changes.
5. Snapshot token estimate is present and snapshots are compact by default.
6. `agbrowse web-ai doctor --snapshot interactive --json` includes `snapshot` and `semanticTargets`.
7. Doctor output contains no `snapshot.text` and no raw accessible names.
8. Existing 237 tests plus Phase 6 and Phase 7 tests pass.
9. Runtime Playwright version exposes `page.accessibility.snapshot()` or project
   explicitly pins to a compatible version before shipping.

---

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `page.accessibility` removed in newer Playwright | All access isolated in `captureAccessibilitySnapshot()`. Pin compatible Playwright or add CDP/ARIA fallback in that one function. |
| AX tree differs across Chromium versions | Normalize role casing, whitespace, name length; hash serialized text not raw AX objects. Test against pinned browser. |
| Snapshot text can contain user prompt/answer | Snapshot command is agent-facing; doctor output only includes hashes and counts. |
| `@eN` refs mistaken for durable selectors | `ref-registry.mjs` binds to `snapshotId + domHash + axHash`; throws `snapshot.ref-stale` on mismatch. |
| Semantic target regexes overmatch | Use `excludeNames`, CSS fallback counts, tests for known false positives. |
| `domHashAround(page, ['body'])` hashes too much | Truncates at `domHashMaxChars`; `rootSelector` can scope. |

---

## Estimate

**4.0–5.5 engineer-days**

* AX snapshot serializer and hashing: 1.25–1.5 days
* ref registry and invalidation tests: 0.75 day
* semantic target contract and observe integration: 0.75–1.0 day
* CLI snapshot command: 0.5 day
* doctor snapshot integration and privacy tests: 0.75–1.0 day
* browser-version compatibility hardening: 0.75–1.25 days

---

## Combined estimate (Phase 6 + Phase 7)

**6.5–9.0 engineer-days**, assuming existing provider poll functions are stable
and Playwright pin still supports `page.accessibility.snapshot()`.

## cli-jaw mirror

| Item | cli-jaw status |
| --- | --- |
| `ax-snapshot` | **Port as-is** to `src/browser/web-ai/ax-snapshot.ts` |
| `ref-registry` | **Port as-is** |
| `observe-targets` | **Port as-is** |
| `vendor-editor-contract` | **Map to existing** vendor configs in `src/browser/web-ai/vendors/` |
| `snapshot` CLI command | **Add** to `bin/commands/browser-web-ai.ts` |
| Doctor snapshot section | **Extend** existing diagnose response |
