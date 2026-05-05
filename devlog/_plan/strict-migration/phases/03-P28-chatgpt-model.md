#  web-ai/chatgpt-model.mjs (DOM tsconfig)P28 

VERDICT-B per-file ts-check on the 603-line ChatGPT model selector. Pure leaf (only imports `./errors.mjs`). Goes into `tsconfig.checkjs-dom.json` because `page.evaluate` callbacks dereference DOM types inside the file.

## Changes
- Add `// @ts-check`
- Typedefs: ModelChoice, EffortChoice, ModelOptionConfig, EffortConfig, BoundingBox, Page, Locator (playwright-core), SelectModelOptions/Result, CapabilityProbeOptions/Result.
- `Readonly<Record<ModelChoice, ModelOptionConfig>>` on CHATGPT_MODEL_OPTIONS.
- `Readonly<Record<string, EffortConfig>>` on CHATGPT_MODEL_EFFORT_OPTIONS.
- `Readonly<Record<string, ModelChoice>>` on MODEL_ALIASES.
- `Readonly<Record<string, EffortChoice>>` on EFFORT_ALIASES.
- JSDoc on all 7 exports + 14 internal helpers.
- Inline `/** @type {HTMLElement} */ (item)` casts for `.innerText` reads inside `page.evaluate(...)` callbacks (Element doesn't have innerText).
- Inline `/** @type {ModelChoice} */ (model)` casts where original code uses dynamic string keys against a typed object.
- `/** @type {Locator | null} */ let standaloneHeavy = null;` annotations preserve runtime exactly.
- Append `web-ai/chatgpt-model.mjs` to `tsconfig.checkjs-dom.json`.

## Runtime invariants
- No new `Boolean(...)`, `String(...)`, `Number(...)` wrappers.
- No new `?.` introduced.
- No fallback values added or removed.
- All DOM-side casts are JSDoc  zero output diff for runtime callers.comments 

## Unblocks
After P28 lands, `vendor-editor-contract.mjs` can be added next (its remaining unchecked dep is `chatgpt-composer.mjs`, which is the natural P29).
