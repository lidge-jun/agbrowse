# Phase 0 — Papercuts

Tiny correctness fixes that block bigger work. One PR. 1–1.5 engineer-days.

## Decisions resolved (post-critique)

- ChatGPT poll fallback prefers **same-host before vendor-latest** to reduce
  wrong-tab risk (added a host filter to `getLatestBaseline`).
- Port mismatch stays **warning-only** in Phase 0; refusal moves to Phase 5
  where `--port-strict` lives.

## Order within the PR

1. ChatGPT baseline fallback (`session.mjs` + `chatgpt.mjs`).
2. Grok hard-gate (`grok-live.mjs` + `cli.mjs`).
3. Docs (`SKILL.md` + `README.md`).
4. Browser CDP-mismatch warning (`skills/browser/browser.mjs`).

## Diffs

### MODIFY `web-ai/session.mjs` — host-aware latest helper

Before:

```js
export function getLatestBaseline(vendor) {
    loadStore();
    const matches = Array.from(baselines.values()).filter(baseline => baseline.vendor === vendor);
    return matches.at(-1) || null;
}
```

After:

```js
export function getLatestBaseline(vendor, options = {}) {
    loadStore();
    const sameHost = normalizeHost(options.sameHostUrl);
    const matches = Array.from(baselines.values())
        .filter(b => b.vendor === vendor)
        .filter(b => !sameHost || normalizeHost(b.url) === sameHost)
        .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
    return matches.at(-1) || null;
}

function normalizeHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
```

### MODIFY `web-ai/chatgpt.mjs` — three-tier baseline lookup in `pollWebAi`

Before:

```js
const page = await requireChatGptPage(deps);
const baseline = getBaseline(vendor, page.url());
if (!baseline) throw new Error('baseline required. Run web-ai send or query first.');

const deadline = Date.now() + timeout * 1000;
```

After:

```js
const page = await requireChatGptPage(deps);
const url = page.url();
const baseline =
    getBaseline(vendor, url) ||
    getLatestBaseline(vendor, { sameHostUrl: url }) ||
    getLatestBaseline(vendor);
if (!baseline) throw new Error('baseline required. Run web-ai send or query first.');

const deadline = Date.now() + timeout * 1000;
```

### MODIFY `web-ai/grok-live.mjs` — hard-gate context packaging

Before (current Phase-0-not-yet-applied state has the soft warning push):

```js
const envelope = normalizeEnvelope({ ...input, vendor: 'grok' });
const contextPack = await prepareContextForBrowser({ ...input, vendor: 'grok' });
if (contextPack?.attachments?.[0] && input.filePath) {
    throw new Error('context package upload and --file upload cannot be combined yet');
}
```

After:

```js
const envelope = normalizeEnvelope({ ...input, vendor: 'grok' });
if (hasContextPackaging(input) && input.allowGrokContextPack !== true) {
    const err = new Error('grok context-pack disabled by default; pass --allow-grok-context-pack to override');
    err.stage = 'grok-context-pack-not-allowed';
    throw err;
}
const contextPack = await prepareContextForBrowser({ ...input, vendor: 'grok' });
if (contextPack?.attachments?.[0] && input.filePath) {
    throw new Error('context package upload and --file upload cannot be combined yet');
}
```

The `err.stage` field is provisional; Phase 2 PR2 replaces this throw with a
typed `WebAiError`.

### MODIFY `web-ai/grok-live.mjs` — gate the warning push

Before:

```js
const warnings = [...rendered.warnings, ...(contextPack?.warnings || [])];
if (hasContextPackaging(input)) warnings.push(GROK_CONTEXT_PACK_WARNING);
```

After:

```js
const warnings = [...rendered.warnings, ...(contextPack?.warnings || [])];
if (hasContextPackaging(input) && input.allowGrokContextPack === true) {
    warnings.push(GROK_CONTEXT_PACK_WARNING);
}
```

### MODIFY `web-ai/cli.mjs` — new flag

Before:

```js
'allow-copy-markdown-fallback': { type: 'boolean', default: false },
file: { type: 'string' },
model: { type: 'string' },
```

After:

```js
'allow-copy-markdown-fallback': { type: 'boolean', default: false },
'allow-grok-context-pack': { type: 'boolean', default: false },
file: { type: 'string' },
model: { type: 'string' },
```

And in the input mapping:

Before:

```js
allowCopyMarkdownFallback: values['allow-copy-markdown-fallback'] === true,
```

After:

```js
allowCopyMarkdownFallback: values['allow-copy-markdown-fallback'] === true,
allowGrokContextPack: values['allow-grok-context-pack'] === true,
```

### MODIFY `skills/browser/browser.mjs` — best-effort foreign CDP warning (schematic)

Source not in the attached bundle; the call site sits where `launchChrome`
detects an existing CDP listener. Schematic before/after:

Before:

```js
if (await isCdpListening(port)) {
    return { ok: true, status: 'running', port, reused: true };
}
```

After:

```js
if (await isCdpListening(port)) {
    const version = await readCdpVersion(port).catch(() => null);
    const state = readBrowserState().catch(() => null);
    const warnings = detectForeignCdpWarnings({ state, version, port });
    return { ok: true, status: 'running', port, reused: true, warnings };
}
```

Helper:

```js
function detectForeignCdpWarnings({ state, version, port }) {
    const warnings = [];
    if (!state || !version) return warnings;
    if (state.browserProduct && version.Browser && state.browserProduct !== version.Browser) {
        warnings.push(`cdp-port-browser-mismatch:${port}`);
    }
    if (state.userAgent && version['User-Agent'] && state.userAgent !== version['User-Agent']) {
        warnings.push(`cdp-port-user-agent-mismatch:${port}`);
    }
    return warnings;
}
```

### MODIFY `skills/web-ai/SKILL.md`

Before:

```md
If `web-ai send/query --vendor grok` is invoked with a context package, the
runtime emits a `grok-context-pack-not-recommended` warning so agents can
self-correct without failing closed.
```

After:

```md
Grok context packages fail closed by default. To override deliberately, pass
`--allow-grok-context-pack`; the runtime still emits
`grok-context-pack-not-recommended`.
```

### MODIFY `README.md`

Before:

```md
If Chrome is already listening on the selected CDP port and responds to
`/json/version`, `agbrowse` reuses it.
```

After:

```md
If Chrome is already listening on the selected CDP port and responds to
`/json/version`, `agbrowse` reuses it and warns when the running CDP endpoint
appears to differ from agbrowse's persisted browser state.
```

## Public-surface changes

- New CLI flag: `--allow-grok-context-pack` (boolean).
- ChatGPT `web-ai poll` no longer throws `baseline required` after a same-process
  send-then-poll where the page URL has shifted to the conversation route.

## Test plan

- `chatgpt.mjs` poll fallback: stub baselines so the strict URL miss but
  same-host match wins; assert poll uses it.
- Same test with two same-host baselines (`/c/old`, `/c/new`); assert latest
  by `capturedAt` wins.
- `grok-live.mjs` send: with `hasContextPackaging(input)` true and no flag,
  expect throw with `err.stage === 'grok-context-pack-not-allowed'`.
- `grok-live.mjs` send: with `hasContextPackaging(input)` true and
  `allowGrokContextPack === true`, expect the warning still pushed and no throw.
- Source-string test: `cli.mjs` parses `--allow-grok-context-pack`.

## Smoke plan

- Live ChatGPT Pro `send → poll` against an existing chat URL — poll
  completes without the baseline-clone python workaround used during the
  2026-05-01 consultation.
- Grok inline + `--context-from-files` without flag → expect fail-closed.
- Grok inline + `--context-from-files --allow-grok-context-pack` → expect
  send proceeds with warning.

## Exit criteria

- The 2026-05-01 consultation flow runs end-to-end without manual baseline
  cloning.
- Full unit suite green: 103 → 106+ tests.
- Skills + README reflect the new flag and the new poll fallback semantics.

## Risks

- **Most likely regression:** ChatGPT `poll` picks the wrong same-host
  baseline when two ChatGPT tabs are simultaneously active. Mitigated by the
  three-tier lookup that prefers strict URL match first; still possible if
  both tabs have stale baselines from earlier in the day.
- **Test:** create two baselines for `chatgpt.com`, one old `/` and one new
  `/c/<id>`; assert strict URL wins; remove strict; same-host latest wins;
  remove same-host; vendor-latest wins; otherwise null.

## cli-jaw mirror (shipped 2026-05-01 commit `3d54c1f`)

| Item | cli-jaw status |
| --- | --- |
| Grok hard-gate | **Ports as-is** — `src/browser/web-ai/grok-live.ts` mirrors agbrowse's check; `src/browser/web-ai/types.ts` adds `allowGrokContextPack`; `bin/commands/browser-web-ai.ts` adds `--allow-grok-context-pack`. |
| Foreign CDP warning | **Ports as-is** — `src/browser/connection.ts` `launchChrome` emits a stderr warning whenever it reuses an external CDP. cli-jaw already differentiates `createExternalBrowserRuntime` vs `createJawOwnedBrowserRuntime` so the warning rides on the existing reuse branch. |
| ChatGPT three-tier baseline fallback | **Not applicable** — cli-jaw keys baselines by CDP `targetId` (not URL). The agbrowse url-shift bug never reproduces here. Phase 0 in cli-jaw skips this fix. |
| Skill docs | **Updated** — `cli-jaw/skills_ref/web-ai/SKILL.md` documents the hard-gate; submodule commit `256956c`. |
| Tests | `BWAG-006` (hard-gate) + `BWAG-007` (warning only on override) added to `tests/unit/browser-web-ai-grok-live-policy.test.ts`. 103/103 browser-web-ai unit tests pass; `npm run typecheck` clean. |
