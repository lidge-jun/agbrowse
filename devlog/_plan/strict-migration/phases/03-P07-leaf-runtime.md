# P07 — Leaf Runtime Helpers (JSDoc opt-in, 8 files)

## Scope

Extend `tsconfig.checkjs.json` opt-in coverage by 8 leaf-runtime utility modules. No `.mjs` rename, no behavior change, no new deps. Pure annotation + sibling tsconfig include.

## Files (8)

| File | Lines | Notes |
|------|-------|-------|
| `web-ai/mcp-state.mjs` | 34 | `McpSnapshot`/`McpState` typedefs |
| `web-ai/policy/enforce.mjs` | 45 | `PolicyAction` typedef; reuses imported `WebAiPolicy` |
| `web-ai/trace/writer.mjs` | 51 | `TraceWriteInput` typedef matching `createTraceRecord` shape |
| `web-ai/action-trace.mjs` | 57 | `TraceContext.record()` / `setSnapshotHashBefore()` method types |
| `web-ai/capability.mjs` | 85 | `CapabilityRow.evidence: unknown`; err cast pattern |
| `web-ai/answer-artifact.mjs` | 85 | generic `withAnswerArtifact<R>` via `@template R` |
| `web-ai/ref-registry.mjs` | 87 | `RefRegistry` mutable shape; `unknown` page param |
| `web-ai/tool-schema.mjs` | 113 | `ToolDefinition` typedef; `Record<...>` casts on spread |

Total checked files in tsconfig.checkjs.json: 23 → **31** (verified by `--listFiles`).

## Pro-honored patterns

- No runtime-changing JS. Pre-existing `... || 0`, `String(x)`, `(err)?.message` semantics preserved.
- Where typedefs would narrow (literal-typed object spreads), use explicit typedef + `Record<string, ToolDefinition>` assertion on import — never widen by mutation.
- `errorEnvelope: unknown` and `command?: string` (no `null`) match the canonical `createTraceRecord` signature in `web-ai/trace/types.mjs`. Writer typedef now defers to that contract instead of redefining a looser one.
- `allToolSchemas` uses an inline `(name) => mapper(name)` closure to avoid `(string, number, string[])` arity bleed-through from `Array#map`.

## Gates (all green)

- `npx tsc --noEmit -p tsconfig.checkjs.json --listFiles` → 31 .mjs entries
- `npm run typecheck` ✓
- `npm run typecheck:checkjs-dom` ✓
- `npm run smoke:bins` ✓
- `npm test` → 473 passed, 12 skipped (no regression)
- Negative probe: replacing `@returns {boolean}` on `isKnownMcpTool` with `{number}` triggers TS2322 → restored.

## Out of scope

- Any rename `.mjs → .ts/.mts` (deferred to P14).
- DOM-touching code (`web-ai/snapshot/*`, `chatgpt-composer.mjs`, etc.) — those need `tsconfig.checkjs-dom.json` track.
- Larger session/cli orchestration (P08+).
