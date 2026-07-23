# 080 — Sol CLI reachability and current-tier effort override

Date: 2026-07-24  
Format: `DIFFLEVEL-ROADMAP-01`  
Upstream mechanisms: `f2f4a6c3`, `52649bad`, `e827942f`

## Objective

Make the existing ChatGPT `gpt-5.6-sol` family selector reachable from ordinary `web-ai send/query/code` CLI calls without introducing a second public model-selection flag, fail closed if final composer state conflicts with a requested Sol family, and permit an explicit effort override against the browser's currently selected tier.

The public contract is:

- Extend `--model <alias>` with ChatGPT value `gpt-5.6-sol`. It selects only the family; it does not force `instant`, `thinking`, or `pro`, so the currently checked Intelligence tier remains the tier target.
- Preserve every currently accepted ChatGPT model alias (`instant`, `fast`, `gpt-5-3`, `gpt-5.3`, `thinking`, `think`, `gpt-5-5-thinking`, `gpt-5.5-thinking`, `pro`, `gpt-5-5-pro`, `gpt-5.5-pro`) and every Gemini/Grok alias unchanged.
- Do not add `--family`; one public `--model` axis avoids an ambiguous `--model pro --family gpt-5.6-sol` combination.
- Allow ChatGPT `--effort <alias>` / `--reasoning-effort <alias>` without `--model`. The core resolves the currently checked tier. Omission of both flags remains zero-touch.
- If the current tier has no enforceable effort control (currently Pro), effort-only selection fails with `provider.model-mismatch`, stage `provider-select-mode`, retry hint `model-fallback`, and evidence containing `{ model: 'pro', effort }`. Explicit legacy `--model pro --effort standard|extended|normal|regular|default` retains its existing warning-only compatibility behavior.
- Non-ChatGPT effort-only calls remain preflight errors because those providers have no equivalent current-tier effort contract.

## Gaps covered

| Gap | Closure |
| --- | --- |
| G20 | Parse `gpt-5.6-sol` as an accepted ChatGPT `--model` value, split it into `input.family`, and forward that field to `selectChatGptModel`. |
| G22 | Re-read final family/composer state after selection and reject requested Sol when the checked family is not Sol or an active composer pill is Pro-conflicting. |
| G27 | Remove the unconditional effort-needs-model rejection for ChatGPT, validate model-less effort aliases, resolve the checked tier in core, and hard-error when that tier exposes no effort control. |

## File change map

| Path | Action | Function / section | Verified current anchor |
| --- | --- | --- | --- |
| `web-ai/cli.mjs` | MODIFY | `WEB_AI_USAGE`; `parseArgs` option/input construction; `rejectFutureScope`; `isSupportedWebAiModel`; `isSupportedWebAiEffort` | help `:117-133`; parser `:590-654`; input `:682-725`; validation `:1634-1674`; model/effort predicates `:1713-1734` |
| `web-ai/chatgpt.mjs` | MODIFY | ordinary Chat send model-selection pass-through | `:298-310` (`selectChatGptModel` call is currently `:309`) |
| `web-ai/chatgpt-model.mjs` | MODIFY | `selectChatGptModel`; new final composer Pro-conflict reader beside family evidence helpers | family normalization/entry `:266-325`; current-tier effort `:326-388`; final verification `:389-415`; family evidence helpers `:784-883` |
| `test/integration/web-ai-cli-contract.test.mjs` | MODIFY | `web-ai CLI contract` model-default/validation cases | current effort-without-model rejection `:286-294`; unsupported model case begins `:296` |
| `test/unit/web-ai-chatgpt-model.test.mjs` | MODIFY | `web-ai ChatGPT model selector policy`; fake model page support | policy tests begin `:7`; flat-picker/current-effort tests `:30-145`; fake page implementation follows in the same file |
| `README.md` | MODIFY | Web-AI selector table/examples | selector table `:790-800` |
| `structure/commands.md` | MODIFY | `Web-AI Commands` contract table/selector note | section begins `:171`; command table `:173-200`; model/effort flags are not currently enumerated |

## Proposed diffs

### 1. CLI: map the family-valued model alias and allow ChatGPT effort-only preflight

`web-ai/cli.mjs` already imports `normalizeChatGptFamilyChoice` at current line 26; reuse it rather than adding a parallel alias table.

Before (`WEB_AI_USAGE`, current lines 120-133):

```js
  --model <alias>     Provider model alias; aliases below
                        ChatGPT: instant, thinking, pro
                        Gemini  models: flash-lite, flash, pro
                        Gemini  tool:   deepthink
                        Grok:   auto, fast, expert, thinking, heavy
  --effort <alias>    ChatGPT reasoning effort. The reasoning-effort menu is
                      ONLY touched when this flag is provided; otherwise the
                      currently-checked effort in the browser is left as-is.
                      Requires a model because legacy Pro/Thinking menus and the
                      simplified Intelligence menu map efforts differently.
                        Pro: standard, extended
                        Thinking: light, standard, extended, heavy
```

After:

```js
  --model <alias>     Provider model alias; aliases below
                        ChatGPT: instant, thinking, pro, gpt-5.6-sol
                        Gemini  models: flash-lite, flash, pro
                        Gemini  tool:   deepthink
                        Grok:   auto, fast, expert, thinking, heavy
                      ChatGPT gpt-5.6-sol selects the family while preserving
                      the currently checked Intelligence tier.
  --effort <alias>    ChatGPT reasoning effort. The reasoning-effort menu is
                      ONLY touched when this flag is provided; otherwise the
                      currently-checked effort in the browser is left as-is.
                      Without --model, applies to the current ChatGPT tier and
                      fails if that tier has no effort control (for example Pro).
                        Pro with explicit --model: standard, extended
                        Thinking/current tier: light, standard, extended, heavy
```

Before (input, current lines 722-724):

```js
        thinkingTime: values['thinking-time'],
        model: values.model,
        reasoningEffort: values.effort || values['reasoning-effort'],
```

After:

```js
        thinkingTime: values['thinking-time'],
        model: normalizeChatGptFamilyChoice(values.model) ? undefined : values.model,
        family: normalizeChatGptFamilyChoice(values.model) || undefined,
        reasoningEffort: values.effort || values['reasoning-effort'],
```

This mapping is intentionally ChatGPT-specific by normalization: all existing aliases return `null` from `normalizeChatGptFamilyChoice` and therefore continue through `input.model` byte-for-byte.

Before (`rejectFutureScope`, current lines 1654-1674):

```js
    const effort = values.effort || values['reasoning-effort'];
    if (effort && !values.model) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `${webAiVendorLabel(values.vendor || 'chatgpt')} reasoning effort requires --model because effort menus differ by model`,
            evidence: { effort },
        });
    }
    if (effort && !isSupportedWebAiEffort(values.vendor || 'chatgpt', values.model, effort)) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `unsupported ${webAiVendorLabel(values.vendor || 'chatgpt')} reasoning effort: ${effort}`,
            evidence: { effort },
        });
    }
```

After:

```js
    const effort = values.effort || values['reasoning-effort'];
    const vendor = values.vendor || 'chatgpt';
    if (effort && !values.model && vendor !== 'chatgpt') {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor,
            retryHint: 'model-fallback',
            message: `${webAiVendorLabel(vendor)} reasoning effort requires --model`,
            evidence: { effort },
        });
    }
    if (effort && !isSupportedWebAiEffort(vendor, values.model, effort)) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor,
            retryHint: 'model-fallback',
            message: `unsupported ${webAiVendorLabel(vendor)} reasoning effort: ${effort}`,
            evidence: { effort, model: values.model || null },
        });
    }
```

Before (`isSupportedWebAiModel` ChatGPT return and `isSupportedWebAiEffort`, current lines 1713-1734):

```js
    return Boolean((/** @type {any} */ (byVendor))[String(vendor || 'chatgpt')]?.has(key));
}

function isSupportedWebAiEffort(vendor, model, effort) {
    if (String(vendor || 'chatgpt') !== 'chatgpt') return false;
    return isChatGptEffortSupported(model, effort);
}
```

After:

```js
    if (String(vendor || 'chatgpt') === 'chatgpt' && normalizeChatGptFamilyChoice(key)) return true;
    return Boolean((/** @type {any} */ (byVendor))[String(vendor || 'chatgpt')]?.has(key));
}

function isSupportedWebAiEffort(vendor, model, effort) {
    if (String(vendor || 'chatgpt') !== 'chatgpt') return false;
    if (!model) return Boolean(normalizeChatGptEffortChoice(effort));
    return isChatGptEffortSupported(model, effort);
}
```

Also extend the existing import at line 26:

```js
import { isChatGptEffortSupported, normalizeChatGptEffortChoice, normalizeChatGptFamilyChoice } from './chatgpt-model.mjs';
```

### 2. Ordinary Chat path: forward family

Before (`web-ai/chatgpt.mjs`, current line 309):

```js
    const selectedModel = await selectChatGptModel(page, input.model, { effort: input.reasoningEffort });
```

After:

```js
    const selectedModel = await selectChatGptModel(page, input.model, {
        effort: input.reasoningEffort,
        family: input.family,
    });
```

### 3. Core: final Sol/Pro guard and effort-only Pro error

Add beside `readVisibleChatGptFamilyEvidence`:

```js
/**
 * @param {Page} page
 * @returns {Promise<string|null>}
 */
async function readActiveProComposerPill(page) {
    const pills = await page.locator([
        'button.__composer-pill',
        '[role="button"].__composer-pill',
    ].join(', ')).all().catch(() => /** @type {Locator[]} */ ([]));
    for (const pill of pills) {
        if (!(await pill.isVisible().catch(() => false))) continue;
        const text = (await pill.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)) return text;
    }
    return null;
}
```

Change the Pro no-control branch so compatibility applies only to an explicit Pro model request.

Before (current lines 362-368):

```js
        if (targetModel === 'pro' && Object.keys(CHATGPT_MODEL_EFFORT_OPTIONS.pro?.efforts || {}).length === 0) {
            if (PRO_UNENFORCED_LEGACY_EFFORTS.has(rawEffort)) {
                selectedEffort = { requested: requestedEffort, selected: null, changed: false };
                warnings.push(`reasoning-effort-unenforced: Pro has no effort control; selected Pro for legacy effort ${rawEffort}`);
            } else {
                throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort ${requestedEffort} is not supported for Pro`, evidence: { model: 'pro', effort: requestedEffort } });
            }
```

After:

```js
        if (targetModel === 'pro' && Object.keys(CHATGPT_MODEL_EFFORT_OPTIONS.pro?.efforts || {}).length === 0) {
            if (requested === 'pro' && PRO_UNENFORCED_LEGACY_EFFORTS.has(rawEffort)) {
                selectedEffort = { requested: requestedEffort, selected: null, changed: false };
                warnings.push(`reasoning-effort-unenforced: Pro has no effort control; selected Pro for legacy effort ${rawEffort}`);
            } else {
                throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort ${requestedEffort} is not supported for Pro`, evidence: { model: 'pro', effort: requestedEffort } });
            }
```

Replace final verification (current lines 389-396) with a fresh family read before menu close and a fresh composer read after close:

```js
    const afterEvidence = await readCheckedModelEvidence(page, targetModel);
    const after = afterEvidence?.choice || null;
    const finalFamilyEvidence = requestedFamily
        ? await readVisibleChatGptFamilyEvidence(page)
        : familyEvidence;
    await closeModelMenu(page);
    const proConflict = requestedFamily === 'gpt-5.6-sol'
        ? await readActiveProComposerPill(page)
        : null;
    const expectedFamilyLabel = requestedFamily ? CHATGPT_FAMILY_OPTIONS[requestedFamily].label : null;
    if (requestedFamily && (!finalFamilyEvidence?.verified || finalFamilyEvidence.label !== expectedFamilyLabel)) {
        throw familyMismatch(requestedFamily, expectedFamilyLabel);
    }
    if (proConflict) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: 'chatgpt',
            retryHint: 'model-fallback',
            message: `ChatGPT family verification failed: requested ${requestedFamily}; active composer state is ${proConflict}`,
            evidence: { requestedFamily, expectedFamilyLabel, activeComposerLabel: proConflict },
        });
    }
    if (after !== targetModel) {
        usedFallbacks.push('model-verification-unavailable-current-model');
        warnings.push(`model ${targetModel} was not verified; current detected model is ${after || 'unknown'}`);
    }
    const verified = after === targetModel && (!requestedFamily || finalFamilyEvidence?.verified === true);
```

In returned evidence, use the fresh value:

```js
            familyLabel: finalFamilyEvidence?.label || null,
```

### 4. Tests

In `test/integration/web-ai-cli-contract.test.mjs`, replace the current effort-without-model rejection assertion with a no-browser preflight assertion that the request passes CLI validation (it may then fail only at headed-browser startup), add `--model gpt-5.6-sol` to the accepted-model matrix, retain all old aliases in that matrix, and assert non-ChatGPT effort-only still fails before startup.

In `test/unit/web-ai-chatgpt-model.test.mjs`, add executable fake-page cases for:

```js
it('applies effort-only to the currently checked thinking tier', async () => {
    const page = createFakeModelPage({
        model: 'thinking',
        simplifiedIntelligenceMenu: true,
        checkedModelRows: false,
        checkedEffortRows: false,
    });
    await expect(selectChatGptModel(page, undefined, { effort: 'high' })).resolves.toMatchObject({
        selected: 'thinking',
        effort: 'high',
    });
});

it('rejects effort-only when the current tier is Pro', async () => {
    const page = createFakeModelPage({ model: 'pro', simplifiedIntelligenceMenu: true });
    await expect(selectChatGptModel(page, undefined, { effort: 'extended' })).rejects.toMatchObject({
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        evidence: { model: 'pro', effort: 'high' },
    });
});
```

Extend the existing family fake-page scenario to expose a post-selection `Pro` composer pill and assert that `selectChatGptModel(page, undefined, { family: 'gpt-5.6-sol' })` rejects even though the Sol family row was checked. Keep a paired no-conflict Sol success case.

### 5. Documentation synchronization

- Update `README.md` selector table to list `gpt-5.6-sol`, state family-only/current-tier preservation, and state effort-only/current-tier behavior plus the Pro failure.
- Add a compact selector-options table immediately after `structure/commands.md`'s Web-AI command table. This file currently lists commands but does not document `--model`/`--effort`; include the same aliases and semantics as `WEB_AI_USAGE`.
- Run `npm run docs:drift` after all three contract surfaces (`WEB_AI_USAGE`, `README.md`, `structure/commands.md`) are synchronized.

## Test plan

1. `npx vitest run test/unit/web-ai-chatgpt-model.test.mjs` — family pass-through behavior, final Sol/Pro veto, effort-only thinking success, current-Pro failure, explicit-Pro legacy compatibility.
2. `npx vitest run test/integration/web-ai-cli-contract.test.mjs` — accepted old aliases, `gpt-5.6-sol`, effort-only ChatGPT preflight, non-ChatGPT rejection, help text.
3. `npm run typecheck:checkjs` — JSDoc/input pass-through and helper signatures.
4. `npm run docs:drift` — CLI/help/README/structure contract synchronization.
5. `git diff --check` — whitespace and patch integrity.

No live provider mutation is required for the implementation gate; a follow-up headed smoke may run `agbrowse web-ai send --vendor chatgpt --model gpt-5.6-sol --inline-only --prompt "Reply OK"`, but only with an authenticated test tab and explicit mutation authorization.

## Accept criteria

- `--model gpt-5.6-sol` passes CLI validation, reaches `selectChatGptModel` as `{ model: undefined, family: 'gpt-5.6-sol' }`, and does not force a tier.
- Every model alias accepted before this phase remains accepted and maps exactly as before.
- Omitted model/family/effort remains zero-touch.
- ChatGPT effort-only resolves the checked tier and succeeds for a tier with an enforceable effort option.
- Effort-only on current Pro returns the structured mismatch error; explicit Pro + legacy effort retains warning-only behavior.
- Requested Sol is not reported verified unless final checked family is Sol and no active Pro composer pill exists.
- Help, README, and `structure/commands.md` describe the same flags, aliases, and failure behavior.

### C-ACTIVATION-GROUNDING-01 scenarios

| Conditional | Activation scenario | Required evidence |
| --- | --- | --- |
| Family alias routing | ChatGPT CLI receives `--model gpt-5.6-sol` | CLI contract test proves `input.family` path and old aliases remain model-valued. |
| Family-only preservation | Sol is requested without a tier alias | Unit fake page starts on thinking (and separately instant); result retains that tier while family becomes Sol. |
| Final family guard | Family click reports Sol but final checked family is absent/different | `provider.model-mismatch`; no verified result returned. |
| Final Pro conflict | Final family row is Sol but composer pill is `Pro`, `Standard Pro`, or `Extended Pro` | Each observed label activates the veto and appears in error evidence. |
| Effort-only current tier | `--effort high` with no model and checked tier thinking | Core selects/verifies High without a model click. |
| No effort control | `--effort extended` with no model and checked tier Pro | Structured mismatch with `{ model: 'pro', effort: 'high' }`. |
| Legacy compatibility | Explicit `--model pro --effort extended` | Existing unenforced warning path remains successful. |
| Provider boundary | Gemini/Grok receives effort without model | CLI rejects before browser mutation. |

## Risks / rollback

- Risk: a broad composer selector could mistake unrelated Pro text for active model state. Mitigation: only visible `.__composer-pill` role/button elements and exact observed Pro labels activate the veto.
- Risk: family verification may be unreadable after an effort submenu transition. Mitigation: final read occurs while the root picker is reopened; failure is explicit rather than silently claiming Sol.
- Risk: `--model` now represents either tier or family. Mitigation: values are disjoint and normalized through the core's existing canonical family table; no new combination syntax exists.
- Risk: current-tier effort changes behavior formerly rejected at CLI. Mitigation: scope exception to ChatGPT and retain core fail-closed behavior for missing/unsupported controls.
- Rollback: remove the family input mapping/pass-through and restore the effort-needs-model branch. Core family support remains dormant and old CLI aliases remain unaffected.
