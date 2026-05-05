---
created: 2026-05-05
status: done
tags: [agbrowse, strict-migration, typescript]
---
# P01 — JSDoc bridge + type inventory

## Goal

Produce the boundary-typedef bridge and an explicit hotspot inventory the next phases will consume. **No `.mjs` → `.ts` rename happens here.** The only typing surface is the shared `.d.ts` set in `types/`. The inventory below is the source of truth for which modules each later phase converts.

## Boundary types (already added in P00)

`types/agbrowse-shared.d.ts` — `Json`, `JsonObject`, `CliResult<T>`, `VendorTabRef`. These are the only cross-module shapes the migration commits to before the leaf-utils phase.

## Module inventory (162 .mjs total)

### web-ai/ (45 modules, 9,583 LOC)

Primary domain. Largest files (top 10):

```
476 web-ai/watcher.mjs
382 web-ai/tab-lease-store.mjs
174 web-ai/tab-recovery.mjs
133 web-ai/types.mjs
116 web-ai/vendor-editor-contract.mjs
113 web-ai/tool-schema.mjs
 56 web-ai/tab-pool.mjs
 51 web-ai/trace-persistence.mjs
 31 web-ai/target-resolver.mjs
```

Boundary hotspots (these become typed first in P05–P10):

| Module | Hotspot |
|---|---|
| `web-ai/types.mjs` | de-facto type module; promote to `.d.ts` first. |
| `web-ai/tool-schema.mjs` | external MCP contract surface. |
| `web-ai/vendor-editor-contract.mjs` | vendor tab → composer contract. |
| `web-ai/target-resolver.mjs` | DOM ref resolution; many implicit-any lookup objects. |
| `web-ai/source-audit.mjs` | citation gating, fail-closed booleans. |
| `web-ai/chatgpt-composer.mjs`, `chatgpt.mjs`, `gemini.mjs`, `grok.mjs` | provider cores; converted in P10–P11. |
| `web-ai/watcher.mjs` | long-running session watcher; converted in P12. |

### bin/ (2 modules)

| Module | Status |
|---|---|
| `bin/agbrowse.mjs` | shebang shim; remains `.mjs` until P14 decision. Inner CLI logic lives in modules and is converted incrementally. |
| `bin/agbrowse-vision-click.mjs` | same constraints. |

### scripts/ (4 modules)

`scripts/run-web-ai-eval.mjs`, `scripts/check-strict-baseline.mjs` (P00), `scripts/smoke-bins.mjs` (P00), plus one helper. Converted in P14.

### benchmarks/ (2 modules)

`benchmarks/agbrowse/run-task.mjs`, `benchmarks/agbrowse/trajectory.mjs`. Converted in P14.

### test/ (77 .mjs test files)

Stay `.mjs` through P10. P11 introduces test fixture types only. Tests themselves remain `.mjs` indefinitely unless conversion is required for shared helper types.

## Implicit-any / unsafe boundary hotspots (qualitative)

1. **CDP response payloads** in `web-ai/browser-primitives.mjs`, `web-ai/tab-recovery.mjs`. Currently `params`/`result` are untyped objects. Will require typed CDP response interfaces.
2. **Provider DOM scrubber outputs** in `web-ai/dom-scrubber.mjs` (referenced by tests). Mixed shape per vendor; needs vendor-tagged unions.
3. **Trace event payloads** in `web-ai/trace/*`. Already partly structured; ratchet to discriminated union in P12.
4. **Session-store records** in `web-ai/tab-lease-store.mjs`, `web-ai/session-store.mjs`. JSON-on-disk records — shape is enforceable via `JsonObject` boundary type.
5. **CLI option bags** in `bin/agbrowse.mjs`'s argv parser and the per-subcommand normalizers. Many `opts?.foo ?? default` patterns — typed in P05.

## What this phase did NOT change

- No source `.mjs` file was modified.
- No file was renamed to `.ts`.
- No JSDoc `@param`/`@type` was added — the migration target is real `.ts`, so JSDoc only lands on the rare boundary that must remain `.mjs` past its phase. The shared boundary types live in `types/agbrowse-shared.d.ts`.

## Verification

```bash
npm run typecheck             # ok
npm run check:strict-baseline # ✅
npm run smoke:bins            # ✅
npm run pack:dry              # manifest unchanged
npm test                      # 463 passed | 12 skipped
```

All P01 gates GREEN.

## Hand-off to P02

P02 (`03-P02-bin-shim-contract.md`) locks both bin shims with executable + smoke coverage and adds an explicit CI-grade smoke step into the strict-baseline gate (already wired via `npm run smoke:bins`). After P02, P03 begins the leaf-utils `.ts` conversion.
