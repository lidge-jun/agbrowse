# Phase 10 — MCP / AI SDK bridge

Expose agbrowse capabilities as MCP tools so cli-jaw and external coding
agents can call them through a stable contract. CLI remains the primary
interface; MCP is an opt-in bridge.

Inspired by Playwright MCP (snapshot/ref contract as MCP tools) and AI SDK
6 (tool schema + Agent loop). agbrowse stays CLI-first; MCP-first
conversion is explicitly out of scope.

Depends on Phase 7 (snapshot), Phase 8 (self-heal), Phase 4 (doctor).

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Tool schema | NEW `web-ai/tool-schema.mjs`; unit tests. |
| **PR2** | MCP server | NEW `web-ai/mcp-server.mjs`; MODIFY `web-ai/cli.mjs`; integration tests. |

## Tool catalog

```js
export const WEB_AI_TOOLS = {
    web_ai_snapshot: {
        description: 'Return compact accessibility snapshot with @eN refs.',
        inputSchema: { provider: 'string', compact: 'boolean' },
    },
    web_ai_click_ref: {
        description: 'Click an element ref from the latest snapshot.',
        inputSchema: { sessionId: 'string', ref: 'string' },
    },
    web_ai_submit_prompt: {
        description: 'Submit prompt to ChatGPT/Gemini/Grok web UI.',
        inputSchema: { provider: 'string', model: 'string', prompt: 'string' },
    },
    web_ai_wait_response: {
        description: 'Wait for provider response completion.',
        inputSchema: { sessionId: 'string', timeout: 'number' },
    },
    web_ai_copy_markdown: {
        description: 'Copy last response as markdown.',
        inputSchema: { provider: 'string' },
    },
    web_ai_doctor: {
        description: 'Run provider diagnostics and return repair packet.',
        inputSchema: { provider: 'string', snapshot: 'boolean' },
    },
    web_ai_session_resume: {
        description: 'Resume a stored session by ID.',
        inputSchema: { sessionId: 'string' },
    },
};
```

## Diffs (PR1)

### NEW `web-ai/tool-schema.mjs`

```js
export const WEB_AI_TOOLS = { /* as above */ };

export function toolSchemaForAiSdk(toolName) {
    const tool = WEB_AI_TOOLS[toolName];
    if (!tool) return null;
    return {
        name: toolName,
        description: tool.description,
        parameters: tool.inputSchema,
    };
}

export function allToolSchemas() {
    return Object.keys(WEB_AI_TOOLS).map(toolSchemaForAiSdk);
}
```

## Diffs (PR2)

### NEW `web-ai/mcp-server.mjs`

Minimal MCP server that:
1. Listens on stdio (standard MCP transport).
2. Registers each tool from `WEB_AI_TOOLS`.
3. Routes tool calls to the corresponding CLI function.
4. Manages a single browser session per server lifetime.

```
agbrowse web-ai mcp-server
```

Designed to be added to a Claude Code or other agent's MCP config:

```json
{
  "mcpServers": {
    "agbrowse": {
      "command": "agbrowse",
      "args": ["web-ai", "mcp-server"]
    }
  }
}
```

## Public-surface changes

- New command: `web-ai mcp-server` (stdio MCP server).
- `web_ai_click_ref` is the first **public action** using @eN refs.
  Restricted to refs from the most recent snapshot (stale refs rejected).
- Tool schemas exported for AI SDK integration.

## Test plan

- Unit: `allToolSchemas()` returns valid schemas for all registered tools.
- Integration: MCP server responds to `tools/list` with all tool names.
- Integration: `web_ai_snapshot` tool returns valid `WebAiSnapshot`.
- Security: `web_ai_click_ref` rejects refs from a different snapshot ID.
- Security: `web_ai_submit_prompt` only works on allowed provider hosts.

## Exit criteria

- cli-jaw can call agbrowse tools via MCP without shelling out.
- External agents can add agbrowse as an MCP server and interact with
  provider UIs through structured tool calls.

## Risks

- **Most likely:** MCP server state management (browser session lifecycle)
  is complex. Mitigate by starting with single-session-per-server.
- **Secondary:** token cost of rich tool responses (snapshots + doctor
  reports) exceeds agent budgets. Mitigate by defaulting to compact mode.

## cli-jaw mirror

cli-jaw already has HTTP routes for web-ai operations. Phase 10 in cli-jaw
means:

| Item | cli-jaw status |
| --- | --- |
| `tool-schema` | **Use directly** — cli-jaw imports agbrowse's schema or defines its own matching set. |
| MCP server | **Not needed** — cli-jaw IS the server. The HTTP routes already serve as the integration surface. But cli-jaw could consume agbrowse's MCP server for the standalone case. |
