# P24 — web-ai/tab-finalizer.mjs

VERDICT-B per-file `// @ts-check`. 33-line glue between session.mjs (already in checkjs) and tab-pool.mjs (P20-annotated).

## Annotations
- `FinalizeDeps`, `FinalizeSession`, `FinalizePage`, `FinalizeOptions` typedefs (loose, all-optional matching defaults).
- `FinalizeResult` discriminated union on `finalized: true|false`.
- JSDoc on `finalizeProviderTab` returning `Promise<FinalizeResult>`.

## Runtime
Zero runtime changes. All `||` fallbacks (`page?.url?.() || session.conversationUrl || ... || null`, `deps?.getPort?.() || 9222`, `vendor || session.vendor || 'chatgpt'`) preserved verbatim. No coercion wrappers. No optional chaining added vs original.

## Gates
- `npm run typecheck` ✓
- `npx tsc --noEmit -p tsconfig.checkjs.json` ✓ (53 entries)
- `npm run smoke:bins` ✓
- `npm test` ✓
