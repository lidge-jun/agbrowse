#  web-ai/contract-audit.mjs (DOM tsconfig)P31 

VERDICT-B per-file ts-check on the 30-line contract audit module. Both deps already DOM-checked: vendor-editor-contract (P30), ax-snapshot.

## Changes
- Add `// @ts-check`
- Typedefs: AuditDrift, AuditResult; reuse VendorName from vendor-editor-contract.
- JSDoc on the single export `auditContractAgainstSnapshot`.
- `/** @type {AuditDrift[]} */` annotation on `drifts` array.
- `/** @type {any} */ (snapshot.refs).filter(...)`  `WebAiSnapshot.refs` is typed as `Record<string, InteractiveRef>` (no `.filter` method). The original code calls `.filter` on it; this is a pre-existing semantic mismatch. VERDICT-B preserves the runtime call exactly via JSDoc-only `any` cast.cast 
- Append `web-ai/contract-audit.mjs` to `tsconfig.checkjs-dom.json`.

## Runtime invariants
- No new `?.` / `??` introduced.
- No new wrappers, no fallback values added or removed.
- Control flow byte-identical: only added `// @ts-check`, JSDoc comments, and JSDoc-only inline casts.
