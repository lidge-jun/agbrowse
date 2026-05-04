# Phase 14 — Active command ownership

Prevent CLI, MCP, send/poll, and cleanup commands from stealing or closing each
other's targets. This phase extends the tab lease work into an active command
contract.

## PR 14.1 — Active command store

### Implementation status

Implemented as the Phase 14 completion slice. The durable store now records
running CLI/MCP commands, refreshes heartbeats, marks expired records stale, and
rejects same-target ownership conflicts before mutation.

### Diff

- NEW `web-ai/active-command-store.mjs`
- MODIFY `skills/browser/tab-lifecycle.mjs`
- MODIFY `web-ai/tab-lease-store.mjs`
- MODIFY `web-ai/mcp-server.mjs`
- MODIFY `web-ai/cli.mjs`
- NEW `test/unit/active-command-store.test.mjs`
- MODIFY `test/unit/tab-lifecycle.test.mjs`
- MODIFY `test/integration/web-ai-policy-mcp.test.mjs`

### Store record

```js
{
  commandId: '01...',
  command: 'web-ai poll',
  provider: 'chatgpt',
  sessionId: '01...',
  targetId: '...',
  owner: 'cli' | 'mcp',
  startedAt: '...',
  heartbeatAt: '...',
  expiresAt: '...',
  status: 'running' | 'completed' | 'stale'
}
```

### Tests

- Register/update/release are atomic.
- Heartbeat refreshes while polling or waiting.
- Expired commands are reclaimed only when target is dead or heartbeat is
  expired.
- Store ignores unrelated profile/home directories.

### PASS

- Running commands own `{ commandId, sessionId, targetId, provider }`.
- Cleanup refuses active command targets.
- Completion finalizer releases ownership exactly once.

## PR 14.2 — Cross-process race tests

### Implementation status

Implemented at the durable-store and mutation-boundary level for this phase.
Full live multi-process provider contention remains a later smoke/benchmark
task because provider tabs are shared external resources.

### Diff

- NEW `test/unit/active-command-store.test.mjs`
- MODIFY `test/unit/web-ai-provider-session.test.mjs`
- MODIFY `test/integration/web-ai-policy-mcp.test.mjs`

### Tests

- Two concurrent checkouts return one pooled target to exactly one command.
- MCP click and CLI poll against different sessions do not change ownership.
- Cleanup during poll leaves the polling target open.
- Stale command cleanup does not close a live target.

### PASS

- No target ID is shared by two active commands.
- Race failures produce structured errors, not silent fallbacks.

## cli-jaw mirror

- Prefer cli-jaw's server lifecycle for command ownership.
- Mirror the record shape so diagnostics match.
- Keep cleanup protection semantics identical.

## Risks

- Stale locks can block legitimate cleanup. Mitigate with heartbeat TTL and
  dead-target checks.
