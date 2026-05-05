#  web-ai/chatgpt-composer.mjs (DOM tsconfig)P29 

VERDICT-B per-file ts-check on the 363-line ChatGPT composer driver. Pure leaf (only imports `./browser-primitives.mjs` already DOM-checked, and `./errors.mjs`). Goes into `tsconfig.checkjs-dom.json` because every helper drives `page.evaluate(...)` callbacks against `document`/`HTMLElement`/`InputEvent`.

## Changes
- Add `// @ts-check`
- Typedefs: ComposerTarget, SendTarget, ComposerCandidate, ComposerState, ComposerOptions, SubmitResult, plus `Page`/`Locator`/`CDPSession` from playwright-core.
- JSDoc on all 5 exports (findComposerCandidate, insertPromptIntoComposer, submitPromptFromComposer, verifyPromptCommitted, countConversationTurns) and 8 internal helpers.
- Inline `/** @type {HTMLElement} */ (node)` casts for `.innerText` reads inside `page.evaluate`.
- Inline `/** @type {HTMLInputElement | HTMLTextAreaElement} */ (node)` casts for `node.value = value` assignments inside fallback writers.
- JSDoc on `page.evaluate` payload destructure: `({ selectors, value }) => ...` typed as `{ selectors: readonly string[], value: string }`.
- JSDoc on every inner closure parameter (`write`, `read`, `isVisible`, `dispatchClickSequence`, etc.).
- `(/** @type {Locator} */ (fallbackLocator))` inline narrowing in `readComposerState` after the `if (!fallbackLocator) reassign`  no new variable, no `??`, no `?.` introduced.block 
- Append `web-ai/chatgpt-composer.mjs` to `tsconfig.checkjs-dom.json` after `chatgpt-model.mjs`.

## Runtime invariants
- No new `Boolean(...)`, `String(...)`, `Number(...)` wrappers.
- No new `?.` or `??` operators introduced over original `.` access.
- No fallback values added or removed.
- Control flow byte-identical: same branches, same statements, same order.

## Unblocks
After P29, `vendor-editor-contract.mjs` can be annotated (its remaining unchecked deps were chatgpt-model + chatgpt-composer, both now done). That cascades to `contract-audit.mjs`, `action-intent.mjs`, `target-resolver.mjs`.
