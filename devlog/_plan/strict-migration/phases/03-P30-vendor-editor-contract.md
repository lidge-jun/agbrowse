#  web-ai/vendor-editor-contract.mjs (DOM tsconfig)P30 

VERDICT-B per-file ts-check on the 116-line vendor-editor contract module. All transitive deps already checked: chatgpt-composer (DOM, P29), copy-markdown (DOM), chatgpt-model (DOM, P28), chatgpt-attachments (P22). Goes into `tsconfig.checkjs-dom.json` because it imports from DOM-checked files.

## Changes
- Add `// @ts-check`
- Re-import `ComposerOptions`/`SubmitResult` from chatgpt-composer.mjs as JSDoc typedefs.
- Define VendorName, SemanticTarget, EditorContract, EditorAdapter, EditorAdapterBaseline typedefs.
- JSDoc on 3 exports: createChatGptEditorAdapter, editorContractForVendor, semanticTargetsForVendor.
- Append `web-ai/vendor-editor-contract.mjs` to `tsconfig.checkjs-dom.json`.

## Runtime invariants
- No new `?.` / `??` / Boolean/String/Number wrappers.
- No fallback values added or removed.
- Control flow byte-identical: only added `// @ts-check` and JSDoc comments.
