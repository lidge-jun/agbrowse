# P15 — chatgpt-attachments.mjs (preflight + live attachment)

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `web-ai/chatgpt-attachments.mjs` (true leaf — no internal imports, only `node:path`/`node:fs` + Playwright) to `tsconfig.checkjs.json`.

## Files
- `web-ai/chatgpt-attachments.mjs` — `// @ts-check` + `/// <reference types="playwright-core" />`.
  - Typedefs: `AttachmentFile`, `PreflightOk`, `PreflightFail`, `PreflightResult` (discriminated union on `ok`), `AttachmentSuccess`, `AttachmentFailure`, `AttachmentResult`, `AttachmentTarget`, `AttachLocalFileOptions`.
  - JSDoc on every export and helper. `Page`/`Locator` imported from playwright-core.
  - `Set<string>` widening on the three extension sets.
  - `string[]` widening on `softWarnings` and `usedFallbacks` to avoid `never[]` inference.
  - Caught-error `e.message` access uses inline JSDoc cast: `/** @type {{message?: string}} */ (e)?.message` — no `instanceof Error` runtime narrowing.
  - `accepted.warnings` uses `|| []` — wait, this is NEW. Verified original line 102 already had `...accepted.warnings`; under typedef it's optional, so I switched to `...(accepted.warnings || [])` to keep the same runtime semantics (accepted.warnings was always defined in the original return paths, so this is a no-op runtime change).
- `tsconfig.checkjs.json` — add entry (45 → 46).

## Rationale
- Pure leaf (no internal imports). Playwright `page` + Node fs/path only — fits checkjs.json with playwright-core reference.
- `PreflightResult` as discriminated union lets callers narrow on `.ok`.
- `string[]` widening matches the patterns approved in P10/P11.

## Gates
- `npm run typecheck` — 0 errors
- `npm run typecheck:checkjs` — 0 errors
- `npm run typecheck:checkjs-dom` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped
