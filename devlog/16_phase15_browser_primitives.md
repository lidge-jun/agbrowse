# Phase 15 — General browser primitive parity

Close practical gaps with Playwright MCP and Vercel `agent-browser` only after
Phase 13 policy and Phase 12 trace exist. This phase is not required for
narrow web-AI production, but is required before claiming general browser-agent
CLI parity.

## PR 15.1 — Low-risk primitives

### Implementation status

Implemented as the Phase 15 completion slice. Existing low-risk primitives now
have JSON-friendly output, `check`/`uncheck` were added, `select-tab` aliases
`tab-switch`, and tab selection refuses targets owned by an active command unless
`--force` is explicit.

### Diff

- MODIFY `skills/browser/browser.mjs`
- MODIFY `test/unit/browser-active-tab.test.mjs`

### Commands

- `wait`
- `scroll`
- `select`
- `check`
- `uncheck`
- `tabs`
- `select-tab`

### Tests

- Each command supports `--json`.
- Each command returns typed errors.
- Stale `@eN` refs fail closed.
- `tabs` and `select-tab` respect active command ownership from Phase 14.

### PASS

- Low-risk commands work on static local fixtures.
- No command writes cookies/storage/downloads/uploads.

## PR 15.2 — State-changing primitives

### Implementation status

Partially implemented only for the existing `evaluate` primitive: it is now
default-denied by Phase 13 policy and requires `--unsafe-allow evaluate`.
New state-changing primitives stay out of this completion slice to avoid
over-engineering and should be reconsidered only after trace/report UX proves
useful on live workflows.

Requires Phase 12 trace coverage and Phase 13 policy enforcement.

### Diff

- MODIFY `skills/browser/browser.mjs`
- MODIFY `bin/agbrowse.mjs`
- MODIFY `README.md`
- NEW `test/integration/browser-primitives-stateful.test.mjs`

### Commands

- `upload`
- `download`
- `cookies`
- `storage`
- `network`
- `batch`

### Tests

- Policy gates every state-changing command.
- Downloads are denied by default.
- Cookie/storage access is denied by default.
- Network interception cannot leak secrets in trace output.
- Batch stops on first unsafe mutation by default.

### PASS

- All state-changing commands require explicit policy allowance.
- Trace records every state-changing action.

## PR 15.3 — Compact refs and ARIA snapshot parity

### Implementation status

Deferred. The current completion keeps existing snapshot ref semantics and adds
ownership protection around tab selection instead of introducing a second ref
format in the same phase.

### Diff

- MODIFY `web-ai/ax-snapshot.mjs`
- MODIFY `skills/browser/browser.mjs`
- NEW `test/unit/compact-ref-snapshot.test.mjs`
- NEW `test/integration/snapshot-refs.test.mjs`

### Public surface

```bash
agbrowse snapshot --format refs --json
```

### Tests

- Compact refs include role, name, value, state, and stable snapshot ID.
- Token estimate is compared to raw DOM snapshot.
- Refs are valid only within one snapshot ID.
- Stale ref action returns `mutationAllowed: false`.

### PASS

- Full page fixture stays under the token budget defined by the test.
- Ref actions are deterministic and stale-safe.

## Not now

- No autonomous planner.
- No LLM selector repair.
- No cloud browser provider.

## cli-jaw mirror

- Port command semantics only after Phase 13 policy and Phase 14 ownership are
  mirrored.
- Keep HTTP/browser routes stricter than agbrowse CLI where server state makes
  destructive actions easier to trigger.
- Mirror compact ref stale-snapshot behavior exactly.
