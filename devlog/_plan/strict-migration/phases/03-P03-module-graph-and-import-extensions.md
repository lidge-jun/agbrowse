---
created: 2026-05-05
phase: P03
status: done
parent: ../01-strategy.md
gpt-pro-verdict: pending (round 3 — pre-merge sweep)
---
# P03 — module graph + import extension policy

## Goal

Map the entire `.mjs` module graph for the agbrowse repo and classify
modules by depth tier so future phases (P04 → P12) can convert
`.mjs → .ts` from the leaves up without breaking the import graph or the
package surface frozen by P02.

## Method

`scripts/check-module-graph.mjs` walks the repo (excluding `node_modules`,
`.git`, `dist`, `.next`, `_legacy`), parses every static and dynamic
module specifier, and resolves each relative specifier with the candidate
set `['', '.mjs', '/index.mjs']`.

Specifier forms recognised (GPT Pro round 3 blocker #2 fix):
- `import x from '…'`, `export { x } from '…'`
- `import '…'` (bare side-effect import)
- `export * from '…'`
- `import('…')` (dynamic import, literal argument only)

The result is:

- `fan_in[file]` — how many other modules import `file`.
- `fan_out[file]` — how many internal modules `file` imports.
- A topological *tier* assigned to every node by longest-path-from-leaf
  (cycles short-circuit at depth 0; none observed).

## Tier inventory (excluding `test/`)

| Tier | Non-test modules | Notes |
|---:|---:|---|
| 0 | 36 | True leaves (no internal imports). P04/P05 conversion candidates. |
| 1 | 21 | Single-hop modules. Eligible after Tier 0 lands. |
| 2 |  9 | Composer/policy enforce/eval-runner. P06–P08. |
| 3 |  5 | Vendor editor contracts, tab pool, tab lifecycle. P07–P10. |
| 4+ | 17 | High-level CLI, MCP server, provider live-runners (P09–P12). |

Total `.mjs`: 166 (164 source + `vitest.config.mjs` + `scripts/check-module-graph.mjs` itself). Test files: 77. Source-only modulo tests: 89. Max tier 11.

## Highest-fan-in hubs (load-bearing modules)

| Fan-in | Module | Conversion phase |
|---:|---|---|
| 19 | `web-ai/errors.mjs` | **P04b** (deferred — risk-C, GPT Pro r3) |
| 15 | `web-ai/session.mjs` | P07 (browser-session types) |
|  8 | `web-ai/active-command-store.mjs` | P08 (action/command types) |
|  7 | `web-ai/cli.mjs` | P05 (CLI parser types) |
|  7 | `web-ai/copy-markdown.mjs` | P04 (leaf util) |
|  7 | `web-ai/tab-lease-store.mjs` | P07 |
|  6 | `web-ai/chatgpt.mjs` | P09 (provider) |
|  6 | `web-ai/vendor-editor-contract.mjs` | P10 (vendor contract types) |
|  6 | `skills/browser/tab-manager.mjs` | P07 |

## Import-extension policy (binding for P04+)

1. **No bare specifiers for relatives.** Every relative import MUST carry
   an explicit `.mjs` or `.ts` extension. `tsconfig.json#module:NodeNext`
   plus `verbatimModuleSyntax:true` enforces this for `.ts` consumers.
2. **`.ts` modules that import an existing `.mjs` module MUST author a
   sibling `.d.mts`** — required by `allowJs:false`. TypeScript's
   extension-substitution rule for an explicit `import './mod.mjs'`
   resolves to `./mod.mts → ./mod.d.mts → ./mod.mjs`; `./mod.d.ts` is
   *not* the preferred sibling declaration for an `.mjs` target. The
   `.d.mts` is owned by the converting phase and lives next to the
   `.mjs` until the `.mjs` itself is renamed in a later phase. (GPT Pro
   round 3 blocker #1.)
3. **`.mjs` modules continue to import `.mjs` siblings unchanged.** No
   spec rewrite is permitted on a non-converted file.
4. **`.mjs` may NOT import a `.ts` module directly** at runtime under the
   substrate (no transpiler is in the loader chain). When a `.ts`
   replacement is introduced for a hub like `errors.mjs`, the conversion
   phase MUST either (a) rename to `.ts` *and* keep the existing `.mjs`
   filename via build emission (deferred to P14), or (b) keep the
   reverse-direction boundary as `.mjs` until the importing layer is
   itself converted.
5. **No new `.js` files anywhere.** The repo is `"type": "module"` only.
6. **No new circular imports.** P03 baseline confirms zero cycles in the
   module graph. Future phases that introduce a cycle MUST justify it in
   their phase doc.

## Conversion candidates for P04 (Tier 0 leaf utils)

> **GPT Pro round 3 risk-C remediation**: `errors.mjs` (fan-in 19) is
> deferred out of the first P04 batch. The first batch must validate the
> `.mjs → .ts` + sibling `.d.mts` strategy on low-fan-in leaves before
> a 19-importer hub is touched. `errors.mjs` becomes a P04b candidate
> after declaration resolution is proven.

Selected for Plan A leaf-conversion scope based on:
- Tier 0 (no internal imports).
- Pure data / formatting / validation (no Node side-effects beyond
  `node:crypto`, `node:url`, `node:path`).
- LOC ≤ 200.
- High fan-in OR foundational typedef hub.
- **Fan-in ≤ 7 in the first batch** (errors.mjs deferred to P04b).

| File | LOC | Fan-in | Why |
|---|---:|---:|---|
| `web-ai/types.mjs` | 133 | 2 | Repo-wide JSON/value typedefs. |
| `web-ai/constants.mjs` | 30 | 6 | Pure constants, foundational. |
| `web-ai/dom-hash.mjs` | 35 | 4 | Pure hash util. |
| `web-ai/cache-metrics.mjs` | 67 | 2 | Counter struct + getters. |
| `web-ai/churn-log.mjs` | 77 | 2 | Pure log struct. |
| `web-ai/context-pack/types.mjs` | 55 | 0 | Pure typedefs. |
| `web-ai/eval/types.mjs` | 88 | 5 | Pure typedefs. |
| `web-ai/trace/types.mjs` | 74 | 3 | Pure typedefs. |
| `web-ai/trace/redact.mjs` | 44 | 3 | Pure string scrubber. |
| `web-ai/policy/default-policy.mjs` | 14 | 1 | Pure constants. |
| `web-ai/observe-targets.mjs` | 65 | 2 | Pure data table. |
| `web-ai/copy-markdown.mjs` | 154 | 7 | Pure transform. |
| (P04b) `web-ai/errors.mjs` | 87 | 19 | Hub; deferred until decl-resolution proven. |

Total proposed P04 (first batch) surface: ~1000 LOC across 12 files.

## Out of scope for P03

- No `.mjs` rename in P03.
- No new runtime code; only graph/inventory artifacts.
- Test files (`test/**`) classified separately in P11.

## Gates (all green at HEAD)

- `npm run typecheck`             → ok
- `npm run check:strict-baseline` → ok (frozen floor unchanged)
- `npm run smoke:bins`            → ok
- `npm run pack:dry`              → 170 files, manifest unchanged
- `npm test`                      → vitest baseline maintained

## Artifacts

- `scripts/check-module-graph.mjs` — graph builder, idempotent.
- `docs/migration/module-graph.json` — cached output for the phase report.
- This phase doc.
