# P06 — session core JSDoc opt-in

## Goal
Bring the session/error/policy core into per-file `// @ts-check` opt-in coverage without renaming `.mjs` to `.ts` (deferred to P14, per VERDICT-B). All imports stay `.mjs`; no runtime behavior changes.

## Files added to `tsconfig.checkjs.json#include`
1. `web-ai/errors.mjs` — `WebAiErrorInit` typedef + JSDoc on `WebAiError` class and `wrapError`/`providerError`/`contextError`/`toErrorJson`.
2. `web-ai/policy/schema.mjs` — explicit `WebAiPolicy` typedef widening flexible policy fields (`allowUploads`/`allowClipboardWrite`/`allowCrossOriginNavigation`) to `boolean|string`, JSDoc on `loadPolicy`/`normalizePolicy`/`policyError`.
3. `web-ai/session-store.mjs` — `WebAiSession` and `WebAiSessionStore` typedefs (producer of session shape), JSDoc on all 12 exports including generic `withStoreLock<T>` / `withSessionCommandLock<T>`.
4. `web-ai/session.mjs` — `WebAiEnvelope` and `WebAiBaseline` typedefs, JSDoc on all 18 exports. Imports `WebAiSession` from session-store via `import('./session-store.mjs').WebAiSession`.
5. `web-ai/trace-persistence.mjs` — `redactSensitive(unknown): unknown`, `appendTraceToSession(sessionId, steps: unknown[]|null|undefined): void`. `Record<string, unknown>` accumulator on the recursive object branch. (Deferred from P05.)

## Verification
- `tsc --noEmit -p tsconfig.checkjs.json --listFiles` → 23 files (was 18 after P05; +5 expected).
- `npm run typecheck`, `npm run typecheck:checkjs`, `npm run typecheck:checkjs-dom`, `npm run smoke:bins`, `npm test` all green (473 passed).
- Negative probe: injected `/** @returns {number} */` on `hashPrompt` → emitted `TS2322: Type 'string' is not assignable to type 'number'`. Restored.

## Notes for reviewers
- `WebAiSession` is intentionally permissive (`[extra: string]: unknown`) because session-store treats sessions as a JSON pass-through; consumers narrow at use sites.
- Generic `<T>` on `withStoreLock`/`withSessionCommandLock` preserves caller return type — no `any` widening.
- `redactSensitive` returns `unknown` (lossy by design) because shape can change on the recursive object branch. Consumers cast explicitly when needed (`appendTraceToSession` casts the redacted steps back to `unknown[]`).
- Legacy baseline API (`saveBaseline`/`getBaseline`/`getLatestBaseline`/`clearBaseline`) is kept on disk under `web-ai-baselines.json` for one minor release while new code switches to session API.
