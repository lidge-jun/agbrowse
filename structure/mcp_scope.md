# MCP Browser Scope — Decision Record (G04)

> Last updated: 2026-05-06 — Phase 22 / Gap G04 closeout
>
> agbrowse intentionally exposes a **smaller** browser MCP surface than mainstream
> MCP runtimes (Playwright MCP, etc.). This document is the canonical record of
> *what is exposed, what is deliberately deferred, and on what conditions a
> deferred tool may be promoted*.

## Frozen MCP scope (today)

Two browser tools are registered:

| Tool | Description | Source of truth |
| --- | --- | --- |
| `browser_snapshot` | Return compact accessibility snapshot of the active tab | `web-ai/browser-tool-schema.mjs` |
| `browser_click_ref` | Click an element ref from the latest snapshot | `web-ai/browser-tool-schema.mjs` |

Enforced by `gate:mcp-scope-frozen` in both `agbrowse` and `cli-jaw`.

## Deferred (NOT registered) — explicit decision record

Each row below is a tool agbrowse could register but does **not**, with the reason,
the CLI equivalent that already covers the use-case, and the closest competitor
counterpart. See `web-ai/browser-tool-schema.mjs::DEFERRED_BROWSER_TOOLS` for the
machine-readable copy. Enforced by `gate:mcp-deferred-metadata`.

| Tool | Reason for deferral | CLI equivalent (today) | Competitor reference |
| --- | --- | --- | --- |
| `browser_type_ref` | Input validation surface still hardening | `agbrowse type <ref> --text "..."` | `playwright-mcp:browser_type` |
| `browser_navigate` | CLI already covers this; MCP duplicate adds attack surface without parity gain | `agbrowse navigate <url>` | `playwright-mcp:browser_navigate` |
| `browser_back` | Same as `browser_navigate` | `agbrowse back` | `playwright-mcp:browser_navigate_back` |
| `browser_forward` | Same as `browser_navigate` | `agbrowse forward` | `playwright-mcp:browser_navigate_forward` |
| `browser_reload` | Same as `browser_navigate` | `agbrowse reload` | `playwright-mcp:browser_navigate (reload)` |
| `browser_wait_for` | Wait policy + boundaries not yet finalized for non-snapshot refs | `agbrowse wait-for <ref-or-text>` | `playwright-mcp:browser_wait_for` |
| `browser_screenshot` | CLI exposure today; MCP duplicate planned with policy | `agbrowse screenshot --out <path>` | `playwright-mcp:browser_take_screenshot` |
| `browser_extract_text` | Already covered by `browser_snapshot` interactive output | `agbrowse snapshot --interactive` | `playwright-mcp:browser_extract_text` (planned upstream) |

## Probe-safe failure behavior

When an MCP client calls `tools/call` for a deferred browser tool, agbrowse
responds with a deterministic structured envelope (NOT a JSON-RPC error):

```json
{
  "ok": false,
  "code": "capability.unsupported",
  "tool": "browser_navigate",
  "reason": "planned: navigate the active tab to a URL via MCP (CLI already covers this)",
  "cliEquivalent": "agbrowse navigate <url>",
  "competitorRef": "playwright-mcp:browser_navigate",
  "since": "phase22",
  "scope": "browser",
  "mcpScope": "frozen"
}
```

This lets capability probers (Playwright MCP-style benchmark harnesses, Vercel
agent SDK, etc.) detect *exactly* which tools are missing and route to the CLI
equivalent without crashing.

## Unfreeze criteria

A deferred tool may be promoted to `BROWSER_TOOLS` when **all** of the
following hold:

1. A written threat model exists for the tool's policy surface (origin allow-list,
   downloads, evaluate, clipboard, file access).
2. The tool has a unit test covering happy-path + at least one policy violation.
3. `gate:mcp-deferred-metadata` is updated to drop the tool's row.
4. `structure/CAPABILITY_TRUTH_TABLE.md` row is added with status `ready`.
5. The cli-jaw mirror gate continues to assert zero browser MCP tools (cli-jaw
   does not host the browser tool surface).

## Non-goals

- Parity with Playwright MCP for the sake of parity.
- Adding any tool that requires hosted/cloud runtime, stealth, CAPTCHA bypass,
  or external CDP. See `gate:no-cloud-claims` (G10) and `docs/EXTERNAL_CDP.md`.
- Exposing browser MCP tools from cli-jaw — cli-jaw remains a control plane
  only.

## See also

- `web-ai/browser-tool-schema.mjs` — frozen + deferred tool tables
- `web-ai/mcp-server.mjs` — `tools/call` deferred-tool envelope
- `scripts/release-gates.mjs` — `gate:mcp-scope-frozen`, `gate:mcp-deferred-metadata`
- `structure/CAPABILITY_TRUTH_TABLE.md` — MCP rows
