# Phase 18 — MCP and AI SDK hardening

Phase 10 introduced the bridge. Phase 18 makes it safe enough to call
production-grade MCP.

## PR 18.1 — General `browser_*` MCP tools

### Diff

- NEW `web-ai/browser-tool-schema.mjs`
- MODIFY `web-ai/tool-schema.mjs`
- MODIFY `web-ai/mcp-server.mjs`
- NEW `test/unit/browser-tool-schema.test.mjs`

### Tools

- `browser_navigate`
- `browser_snapshot`
- `browser_click_ref`
- `browser_fill_ref`
- `browser_wait`
- `browser_screenshot`
- `browser_tabs`
- `browser_select_tab`
- `browser_console`
- `browser_network`

### PASS

- Browser tools share stale-ref guards with web-AI tools.
- Tool responses are compact by default.
- Phase 13 policy is enforced for mutations.

## PR 18.2 — Protocol and session isolation

### Diff

- NEW `web-ai/mcp-state.mjs`
- MODIFY `web-ai/mcp-server.mjs`
- NEW `test/integration/mcp-protocol.test.mjs`

### Tests

- `initialize` passes.
- `tools/list` passes.
- `tools/call` passes.
- Invalid JSON does not crash.
- Unknown tools do not crash.
- Stale refs do not mutate.
- Tool errors return structured JSON-RPC errors.
- Each MCP server instance has isolated latest snapshot/session state.

### PASS

- MCP client contract tests pass without needing live providers.

## PR 18.3 — AI SDK schema export

### Diff

- MODIFY `web-ai/tool-schema.mjs`
- NEW `docs/ai-sdk.md`
- NEW `test/unit/ai-sdk-schema.test.mjs`

### PASS

- MCP and AI SDK schemas are generated from one source.
- `additionalProperties: false` is preserved.
- cli-jaw can import schemas without starting an MCP server.

## cli-jaw mirror

- cli-jaw may import schemas or snapshot them with version checks.
- Do not duplicate agbrowse's MCP server if cli-jaw remains the server.

## Not now

- No broad DevTools performance/memory clone.
- No hosted MCP gateway.
