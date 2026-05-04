# Phase 26 — Browser MCP snapshot and ref click

This slice starts Phase 18.1 with the smallest safe generic browser MCP surface:
snapshot and ref-scoped click.

## Changes

- Added `web-ai/browser-tool-schema.mjs` with strict schemas for
  `browser_snapshot` and `browser_click_ref`.
- Added `web-ai/mcp-state.mjs` so generic browser snapshots and provider
  web-AI snapshots do not overwrite each other.
- Updated the MCP and AI SDK schema source to include `browser_*` tools while
  preserving the existing `WEB_AI_TOOLS` compatibility export.
- Implemented `browser_snapshot` through the existing compact accessibility
  snapshot builder.
- Implemented `browser_click_ref` with stale snapshot rejection, current URL
  equality checks, origin policy enforcement, duplicate accessible-name
  occurrence handling, and active-command ownership.
- Updated structure docs so drift checks cover the new MCP tool names.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-mcp-home npx vitest run test/unit/web-ai-tool-schema.test.mjs test/unit/browser-tool-schema.test.mjs test/integration/web-ai-mcp-server.test.mjs test/integration/web-ai-policy-mcp.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`

## Follow-ups

- Add `browser_fill_ref`, `browser_wait`, screenshot, tabs, console, and network
  tools after extracting importable generic browser actions from
  `skills/browser/browser.mjs`.
- Add a protocol-focused MCP test file for invalid JSON and isolated server
  instances once the broader `browser_*` surface lands.
