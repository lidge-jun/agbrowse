#  web-ai/tab-recovery.mjsP26 

VERDICT-B per-file ts-check on 174-line tab recovery module. All deps (tab-manager, session) already checked.

## Changes
- Add `// @ts-check`
- Typedefs: RecoverDeps, RecoverResult, VerifyResult, ResolvedPage<T>.
- `WebAiSession` reused via `import('./session-store.mjs')`.
- `recoverSessionTab/verifySessionTab/withSessionPage` annotated; `withSessionPage` takes `@template T` for the callback return.
- `targetId` typed as `string | null` in result types to match `WebAiSession.targetId`.
- Inline casts `/** @type {string} */ (session.targetId)` where original code dereferenced without null-guard, preserving runtime semantics.
- Inline cast `/** @type {WebAiSession} */ (getSession(sessionId))` on the post-recovery lookup (the original code already assumed non-null).

## Runtime invariants
- No `Boolean(...)` wrappers added.
- No new `?.` introduced. Existing `err?.message` preserved (kept on a cast variable `e` of identical reference).
- No null-guards added. All casts comment-only.
- Append-only tsconfig.checkjs.json entry: `web-ai/tab-recovery.mjs`.
