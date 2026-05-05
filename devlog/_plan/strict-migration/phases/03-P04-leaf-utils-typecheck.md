# P04 — Leaf utils typecheck (VERDICT-B, batch A)

## Decision binding

GPT Pro arbitration (`devlog/_plan/strict-migration/_gpt-pro-arbitration-p04-meta.md`) returned
**VERDICT B**: do **not** rename `.mjs` → `.ts`/`.mts` in P04. Keep `.mjs` filenames,
keep `bin/*.mjs`, keep all import specifiers verbatim. Type-check `.mjs` source via
JSDoc + per-file `// @ts-check`, with a sibling `tsconfig.checkjs.json` that flips
`allowJs: true, checkJs: true` and includes only the leaves we have opted in. The
hard rename to `.ts`/`.mts` is deferred to **P14**.

This is the binding interpretation for P04 / P04b / P04c.

## Why two tsconfigs

Repo `tsconfig.json` has hard invariants we must not move:

- `strict: true`, `noEmit: true`
- `allowJs: false`, `checkJs: false`
- `exclude: ["**/*.mjs", "**/*.js"]`, `include: [".ts only"]`

If we flip `allowJs`/`checkJs` on `tsconfig.json` we expand the surface area of every
typecheck across all `.mjs` and force the whole tree into the migration in one step,
which Pro VERDICT-B explicitly rejects.

Instead we ship a **second program**: `tsconfig.checkjs.json` extends the main
config and turns on `allowJs`/`checkJs` only for explicit leaves. Each leaf is
opted in via the `include` list. A new npm script `typecheck:checkjs` runs that
program. The main `typecheck` script is unchanged and continues to ignore `.mjs`.

This lets us migrate one leaf (or one tight cluster) per phase without leaking
errors into the rest of the tree.

## Batch A — first opt-in (this phase)

Files included in `tsconfig.checkjs.json` for P04 batch A:

| # | File | Notes |
|---|------|-------|
| 1 | `web-ai/types.mjs` | Pure JSDoc typedefs already, no runtime logic. |
| 2 | `web-ai/constants.mjs` | `const`/`Object.freeze` only, no params. |
| 3 | `web-ai/context-pack/types.mjs` | Pure JSDoc typedefs only. |
| 4 | `web-ai/policy/default-policy.mjs` | `Object.freeze` literal default policy. |

Each gets a `// @ts-check` directive at line 1 (defensive: makes the opt-in
explicit per file even if `tsconfig.checkjs.json` is later refactored).

Verified: `tsc --noEmit -p tsconfig.checkjs.json` → 0 errors.

## Deferred to follow-up sub-phases

| Phase | Files | Reason |
|-------|-------|--------|
| P04b | `web-ai/trace/redact.mjs`, `web-ai/trace/types.mjs`, `web-ai/eval/types.mjs`, `web-ai/cache-metrics.mjs`, `web-ai/churn-log.mjs` | Need JSDoc `@param` annotations to remove implicit-any from factory/sink params. |
| P04c | `web-ai/observe-targets.mjs`, `web-ai/copy-markdown.mjs`, `web-ai/dom-hash.mjs` | Bodies execute inside `page.evaluate(...)` Playwright callbacks which reference DOM globals; need a scoped `lib: ["DOM"]` strategy or wrapped callback annotations. |

Each sub-phase is its own PR and Pro round.

## Gates run in this phase

- `npm run typecheck` → green
- `npm run typecheck:checkjs` → green (NEW)
- `npm run smoke:bins` → green
- `npm test` → green (473 passed, 12 skipped)
- Manifest contract test (P02) — the four edited files were already shipped in
  `package.json#files`; only their content changed (`// @ts-check` line) so the
  manifest is unchanged.

## Strategy doc amendment

`devlog/_plan/strict-migration/01-strategy.md` says `allowJs: true, checkJs: false`
in the `tsconfig.json` row of the Phase Table, which does not match HEAD. Per
VERDICT-B we keep the main tsconfig as-is (`allowJs: false`, `.mjs` excluded)
and use the side `tsconfig.checkjs.json` per phase. We will land a strategy
amendment in a tiny follow-up patch (`_strategy-amendment-p04.md`) rather than
rewrite `01-strategy.md` mid-stream.

## Out of scope

- No file renames.
- No changes under `bin/`.
- No changes to `package.json#bin` / `package.json#files`.
- No changes to import specifiers.
- No new runtime dependencies.
