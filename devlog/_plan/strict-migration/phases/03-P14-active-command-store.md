# P14 — active-command-store.mjs (active command lock + lifecycle)

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `web-ai/active-command-store.mjs` (226 lines) to `tsconfig.checkjs.json` (Node-only file).

## Files
- `web-ai/active-command-store.mjs` — `// @ts-check` + JSDoc on every export and helper.
  - 4 typedefs: `ActiveCommandError` (`Error & { code?, cause?, command? }`), `ActiveCommandRow` (the canonical row written to `~/.browser-agent/web-ai-active-commands.json`), `ActiveCommandInput` (Partial<Row> + ttl/heartbeat/port options), `ActiveCommandStoreFile`.
  - `Error.code` / `Error.cause` / `Error.command` mutations cast through `ActiveCommandError` (typedef-only). Pattern: `const error = /** @type {ActiveCommandError} */ (new Error(...))`.
  - `withActiveCommandLock` and `withActiveCommand` use `@template T`.
  - `currentCommandContext` annotated `/** @type {ActiveCommandRow|null} */`.
  - Caught-error `.code` access uses inline JSDoc cast: `/** @type {{code?: string}} */ (error)?.code` and `/** @type {{message?: string}} */ (cause)?.message`.
  - `normalizeActiveCommand` casts `input.commandId`/`startedAt`/`heartbeatAt`/`expiresAt` to `string` because all callers go through `registerActiveCommand`, which guarantees these via `||` defaults before normalize.
- `tsconfig.checkjs.json` — add entry (44 → 45).

## Rationale
- File only uses Node APIs (`node:fs`, `node:path`, `node:os`) — fits checkjs.json.
- The Error mutations are intentional metadata for downstream callers (`error.code`, `error.command`). The `ActiveCommandError` typedef formalizes the shape without changing semantics.
- `Partial<ActiveCommandRow>` for `ActiveCommandInput` keeps the public API compatible (callers pass only some fields).

## Gates
- `npm run typecheck` — 0 errors
- `npm run typecheck:checkjs` — 0 errors
- `npm run typecheck:checkjs-dom` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped
