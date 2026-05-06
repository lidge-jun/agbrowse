# Phase 3 — Capability probe rows

Runtime answer to "can I safely send right now?" before any mutation, with
evidence per probe. Splits into 2 PRs. PR1 can run alongside Phase 2 PR2.

## Decisions resolved (post-critique)

- **Evidence schema:** loose JSON plus tests. No Zod/JSON Schema dependency
  for now.
- **Rows on send failure:** yes for **pre-mutation failures only** — attach
  `capabilities` to `WebAiError.evidence` so an agent can self-diagnose
  without a separate `status` call.
- **Logged-in detection:** accept provider-specific probes. Generic login
  detection will be noisy.
- **Side-effect contract (added per critique):** probes **may open and close
  provider menus** but **must never submit a prompt**. Each probe ends with a
  cleanup phase that closes whatever it opened.

## Initial capability set

Per provider:

- `<vendor>.host.matches` — active tab matches expected host.
- `<vendor>.composer.visible` — input visible.
- `<vendor>.session.logged-in` — heuristic (login link absent, conversation
  list visible).
- `<vendor>.model.alias-selectable` — passed `--model` alias maps to a
  visible UI control.
- `<vendor>.upload.surface-visible` — upload button reachable.
- `<vendor>.copy.button-present` — Copy fallback selector present on the
  latest assistant message.
- `<vendor>.response.streaming` — streaming indicator state.

Cross-provider:

- `agbrowse.cdp.connected` — Playwright/CDP healthy.
- `agbrowse.profile.matches` — running Chrome's profile dir matches the
  persisted state.

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Capability core + base rows | NEW `web-ai/capability.mjs`; MODIFY `chatgpt.mjs`, `gemini-live.mjs`, `grok-live.mjs` (host + composer rows); MODIFY `cli.mjs` (`--probe`); unit tests. |
| **PR2** | Model/upload/copy/streaming rows + SKILL matrix replacement | MODIFY `*-model.mjs` to expose probes; MODIFY provider files for remaining rows; MODIFY `skills/web-ai/SKILL.md` to drop the static matrix. |

## Capability row shape

```json
{
  "capabilityId": "chatgpt-composer-visible",
  "state": "ok | warn | fail | unknown",
  "evidence": { "selector": "#prompt-textarea", "matched": 1, "visible": true },
  "next": "send | re-snapshot | model-fallback | login | tab-switch"
}
```

**Canonical ID format (post-closeout, GPT Pro):** use cli-jaw's
**hyphenated** ID convention. Existing cli-jaw IDs include
`chatgpt-model-selection`, `chatgpt-active-tab-verification`,
`web-ai-session-lifecycle`. Do not introduce dot-separated IDs like
`chatgpt.model.alias-selectable` — pick the cli-jaw shape or add an
explicit alias map; do not ship both.

## Diffs (PR1)

### NEW `web-ai/capability.mjs`

API surface:

```js
export function defineCapability(capabilityId, probeFn) {}
export async function runCapabilities(deps, capabilities, input = {}) {}
export function selectorVisibleCapability(capabilityId, selectors, next) {}
export function worstCapabilityState(rows) {}
```

Skeleton:

```js
export function defineCapability(capabilityId, probeFn) {
    return { capabilityId, probeFn };
}

export async function runCapabilities(deps, capabilities, input = {}) {
    const rows = [];
    for (const cap of capabilities) {
        if (input.probe && input.probe !== cap.capabilityId) continue;
        try {
            const probeResult = await cap.probeFn(deps, input);
            rows.push({ capabilityId: cap.capabilityId, ...probeResult });
        } catch (e) {
            rows.push({ capabilityId: cap.capabilityId, state: 'unknown', evidence: { error: e.message }, next: 're-snapshot' });
        }
    }
    return rows;
}

export function worstCapabilityState(rows) {
    if (rows.some(r => r.state === 'fail')) return 'fail';
    if (rows.some(r => r.state === 'warn')) return 'warn';
    return 'ok';
}
```

`selectorVisibleCapability` is a tiny factory for the recurring "is this
selector visible?" probe pattern.

### MODIFY `web-ai/chatgpt.mjs` — replace `statusWebAi`

Before:

```js
export async function statusWebAi(deps, input = {}) {
    const page = await requireChatGptPage(deps);
    return { ok: true, vendor: input.vendor || 'chatgpt', status: 'ready', url: page.url(), warnings: [] };
}
```

After:

```js
export const chatGptCapabilities = [
    defineCapability('chatgpt.host.matches', chatGptHostProbe),
    defineCapability('chatgpt.composer.visible', chatGptComposerProbe),
    defineCapability('chatgpt.model.alias-selectable', chatGptModelProbe),
    defineCapability('chatgpt.copy.button-present', chatGptCopyProbe),
];

export async function statusWebAi(deps, input = {}) {
    const page = await deps.getPage();
    const capabilities = await runCapabilities({ ...deps, page }, chatGptCapabilities, input);
    return {
        ok: !capabilities.some(r => r.state === 'fail'),
        vendor: 'chatgpt',
        status: 'ready',
        url: page.url(),
        capabilities,
        warnings: [],
    };
}
```

### MODIFY `web-ai/gemini-live.mjs` and `web-ai/grok-live.mjs`

Same pattern. Each declares an exported `<vendor>Capabilities` array and
replaces the body of its `*StatusWebAi` with `runCapabilities` over that
array. Probes follow the side-effect contract (open menu → read → close).

### MODIFY `web-ai/cli.mjs` — `--probe` flag

Before:

```js
json: { type: 'boolean', default: false },
```

After:

```js
probe: { type: 'string' },
json: { type: 'boolean', default: false },
```

Input mapping:

Before:

```js
allowCopyMarkdownFallback: values['allow-copy-markdown-fallback'] === true,
```

After:

```js
allowCopyMarkdownFallback: values['allow-copy-markdown-fallback'] === true,
probe: values.probe,
```

## Diffs (PR2)

### MODIFY `web-ai/chatgpt-model.mjs` — expose probe

Before:

```js
export async function selectChatGptModel(page, model) {
    const requested = normalizeChatGptModelChoice(model);
    if (!requested) {
        if (model) throw new Error(`unsupported ChatGPT model selection: ${model}`);
        return null;
    }
    ...
}
```

After (keep `selectChatGptModel` for the send path; add a non-mutating
probe):

```js
export async function chatGptModelCapabilityProbe(page, model) {
    const requested = normalizeChatGptModelChoice(model);
    if (!model) return { state: 'unknown', evidence: { requested: null }, next: 'send' };
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    const usedFallbacks = [];
    await openModelMenu(page, usedFallbacks).catch(() => null);
    const option = await findModelOption(page, requested).catch(() => null);
    await closeModelMenu(page).catch(() => undefined);
    return option
        ? { state: 'ok', evidence: { requested, usedFallbacks }, next: 'send' }
        : { state: 'fail', evidence: { requested }, next: 'model-fallback' };
}
```

### MODIFY `web-ai/gemini-model.mjs` — expose probe

Before:

```js
export async function selectGeminiModel(page, model) {
    if (isGeminiDeepThinkChoice(model)) return null;
    const requested = normalizeGeminiModelChoice(model);
    ...
}
```

After:

```js
export async function geminiModelCapabilityProbe(page, model) {
    if (isGeminiDeepThinkChoice(model)) {
        return { state: 'unknown', evidence: { requested: model, tool: 'deepthink' }, next: 'send' };
    }
    const requested = normalizeGeminiModelChoice(model);
    if (!model) return { state: 'unknown', evidence: { requested: null }, next: 'send' };
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    const before = await readGeminiModel(page).catch(() => null);
    return before === requested
        ? { state: 'ok', evidence: { active: before }, next: 'send' }
        : { state: 'warn', evidence: { active: before, requested }, next: 'model-fallback' };
}
```

### MODIFY `web-ai/grok-model.mjs` — expose probe

Same shape as the others; `grokModelCapabilityProbe(page, model)` returns
`ok`/`warn`/`fail` based on whether the active model matches the requested
alias without opening any menu (Grok's pill is readable without a click).

### MODIFY `skills/web-ai/SKILL.md` — drop static matrix

Before:

```md
## Provider Matrix

| Provider | Inline | File upload | Context package upload | Model select | Copy fallback |
```

After:

```md
## Runtime capabilities

Use `agbrowse web-ai status --vendor <v> --json` before mutation. The JSON
contains `capabilities[]` rows with `capabilityId`, `state`, `evidence`, and
`next`. Scope a probe with `--probe <capabilityId>`.
```

## Public-surface changes

- `web-ai status --json` adds a `capabilities` array.
- New flag `--probe <capabilityId>`.
- Pre-mutation throws (Phase 2 `WebAiError`) include `evidence.capabilities`
  with the rows that were collected before the failure.

## Test plan

- Unit: `runCapabilities` aggregates rows in declared order; one failing
  probe does not abort the rest.
- Unit: each provider's capability list contains the expected IDs (snapshot
  test).
- Unit: side-effect contract — fake page that records open/close events;
  assert each model probe leaves the page in the same menu state it found.
- Contract: `web-ai status --json` shape stable across the three vendors.
- Source: SKILL.md no longer contains the hand-typed Provider Matrix table.

## Smoke plan

- ChatGPT: with no Pro entitlement, `model.alias-selectable` returns
  `state: 'fail'` and `next: 'model-fallback'`.
- Gemini: with `--model deepthink`, capability returns `state: 'unknown'`
  with `evidence.tool === 'deepthink'`.
- Grok: with composer hidden behind a modal, `composer.visible` returns
  `state: 'warn'`.

## Exit criteria

- `web-ai status --json` is the single agent-facing pre-mutation gate.
- Every documented vendor capability has a probe.
- SKILL.md matrix no longer hand-edited; runtime probes are the source of
  truth.

## Risks

- **Most likely regression:** `status` becomes slow or changes UI state by
  opening model menus and not closing them.
- **Test:** fake page with model menu; run probe; assert it returns within
  budget and sends `Escape`/closes the menu before resolving.

## cli-jaw mirror

cli-jaw is **significantly further ahead** than agbrowse here:

- `src/browser/web-ai/capability-registry.ts` — registry + lookup primitives.
- `src/browser/web-ai/capability-types.ts` — typed capability rows.
- `src/browser/web-ai/capability-observation-presets.ts` — provider preset
  bundles.
- HTTP route `/api/browser/web-ai/capabilities` exposes them; CLI accepts
  `--family` and `--frontend-status` filters.
- Tests already cover the registry (`tests/unit/browser-web-ai-capability-registry.test.ts`).

Phase 3 in cli-jaw is therefore "consume what already exists":

| Item | cli-jaw status |
| --- | --- |
| `defineCapability`/`runCapabilities` runtime | **Already exists** — registry-driven instead of array-driven. agbrowse should consider porting the registry shape back rather than inventing a parallel one. |
| `<vendor>.host.matches` / `composer.visible` / `model.alias-selectable` / `copy.button-present` | **Already partly modeled** — verify each is registered with a probe; add the ones that are missing. |
| `web-ai status --json --vendor <v>` returns `capabilities[]` | **Partially shipped** — `status` returns a basic `{ ok, vendor, status, url, warnings }`. Phase 3 adds `capabilities[]` to that response so the CLI gets parity with the existing `/api/browser/web-ai/capabilities` route. |
| `--probe <capabilityId>` flag | **Missing** — add to `bin/commands/browser-web-ai.ts`. |
| Side-effect contract (probes never submit) | **Apply equally** — audit the existing probes in cli-jaw to confirm they only read DOM. |
| SKILL matrix replacement | **Apply** — `cli-jaw/skills_ref/web-ai/SKILL.md` static "Provider Matrix" already minimal; replace with a pointer to runtime capabilities. |

Direction reversal — when this phase runs:

1. **First**: agbrowse imports the cli-jaw capability shape rather than
   inventing a new one. The agbrowse `web-ai/capability.mjs` skeleton in
   this phase file becomes a port of `capability-registry.ts`, not greenfield.
2. **Then**: cli-jaw augments `status` to embed `capabilities[]` and adds
   the `--probe` CLI flag.
3. Both repos share the canonical capability ID list.

PR slicing:

- **PR1 (cli-jaw)**: extend `status` response with `capabilities[]`, add
  `--probe` flag, update SKILL.
- **PR1 (agbrowse)**: port registry shape; implement host/composer probes
  using the cli-jaw catalog as source of truth.
- **PR2 (both)**: model/upload/copy/streaming probes + SKILL matrix removal.
