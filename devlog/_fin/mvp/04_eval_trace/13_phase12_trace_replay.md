# Phase 12 — Trace, replay, and evidence

Add replayable evidence for fixture evals, provider smokes, and MCP tool calls.
This phase is a production blocker because failures must be debuggable without
rerunning live providers.

## PR 12.1 — Trace schema and writer

### Diff

- NEW `web-ai/trace/types.mjs`
- NEW `web-ai/trace/writer.mjs`
- NEW `web-ai/trace/redact.mjs`
- MODIFY `web-ai/chatgpt.mjs`
- MODIFY `web-ai/gemini-live.mjs`
- MODIFY `web-ai/grok-live.mjs`
- MODIFY `web-ai/mcp-server.mjs`
- MODIFY `web-ai/cli.mjs` to accept `--trace-dir`
- NEW `test/unit/web-ai-trace.test.mjs`
- NEW `test/unit/web-ai-trace-redact.test.mjs`

### Trace schema

```js
{
  traceVersion: 1,
  traceId: '01...',
  gitCommit: 'abc123' | null,
  agbrowseVersion: 'x.y.z',
  command: 'web-ai query',
  provider: 'chatgpt',
  modelAlias: 'pro',
  sessionIdHash: 'sha256:...',
  targetId: '...',
  urlOrigin: 'https://chatgpt.com',
  viewport: { width: 1440, height: 1000 },
  steps: [],
  artifacts: [],
  sourceAudit: null,
  errorEnvelope: null
}
```

### Redaction rules

- Never persist raw cookies, localStorage, sessionStorage, auth headers, API
  keys, provider conversation text, prompt text, or answer text by default.
- Hash session IDs and target IDs when they appear in shareable reports.
- Store screenshots only when explicitly requested.

### Tests

- Trace writer creates parent directories atomically.
- Redactor removes emails, tokens, cookies, storage values, and prompt/answer
  text.
- Failed provider action attaches `traceId` to the structured error envelope.
- `--trace-dir` is ignored for `web-ai render` unless explicitly enabled.

### PASS

- `agbrowse web-ai query ... --trace-dir tmp/trace --json` writes JSONL.
- Structured errors include `traceId`.
- Trace output is safe to attach to issues by default.

## PR 12.2 — Trace report and offline replay

### Diff

- NEW `web-ai/trace/report.mjs`
- NEW `scripts/render-trace-report.mjs`
- NEW `docs/traces.md`
- NEW `test/unit/web-ai-trace-report.test.mjs`
- NEW `test/integration/web-ai-trace-fixture.test.mjs`

### Report contents

- Command and provider metadata.
- Before/after snapshot hashes.
- Selected refs and candidate refs.
- Selectors tried.
- Resolver strategy or eval probe strategy.
- Action-cache hit/miss/stale status.
- After-action evidence.
- Error envelope, if any.

### Tests

- Report renders without Chrome.
- Report omits redacted values.
- Failed Phase 11 eval run can generate a report.

### PASS

- A failing fixture produces a report that identifies the broken target intent.
- The report is deterministic enough for snapshot tests.

## cli-jaw mirror

- Surface trace IDs in HTTP/CLI responses.
- Store artifacts under cli-jaw's configured artifact directory.
- Keep redaction policy compatible with agbrowse.

## Risks

- Disk bloat from screenshots. Default screenshots off, add cleanup docs.
- Trace schema churn. Version with `traceVersion: 1`.
