# MCP Server Ecosystem for AI Provider Access

Sources: GitHub research, web search (May 19, 2026)

## Executive Summary

The MCP ecosystem has two clear patterns:
1. **API-proxy MCP servers** — wrap existing APIs (LiteLLM, PiAPI, Bifrost). Mature, many providers.
2. **Browser-automation MCP servers** — wrap web UIs via Playwright/CDP. Nascent, single-provider only.

**No production MCP server automates multiple AI web UIs through browser control.** This is agbrowse's exact niche and a potential MCP server opportunity.

## Landscape Table

| Category | Project | Approach | Providers | Notes |
|----------|---------|----------|-----------|-------|
| **Web UI Automation** | chatgpt-automation-mcp | Playwright browser automation | ChatGPT only | GPT-5, GPT-5 Thinking; single provider |
| **Web UI Bridge** | MCP-SuperAssistant | Chrome/Firefox extension injecting MCP into web UIs | ChatGPT, Gemini, Grok, DeepSeek, Perplexity, AI Studio | Reverse approach — MCP INTO UIs, not wrapping them |
| **Media Generation** | piapi-mcp-server (PiAPI) | Paid API proxy | Midjourney, Flux, Kling, LumaLabs, Suno, Udio, Trellis | Dominant unified media MCP; no browser automation |
| **Media (Midjourney)** | AceDataCloud/MidjourneyMCP | API via AceDataCloud | Midjourney only | Hosted proxy |
| **Media (Suno)** | AceDataCloud/SunoMCP | API via AceDataCloud | Suno only | Hosted proxy |
| **Media (Runway)** | runwayml/runway-api-mcp-server | OFFICIAL API wrapper | Runway only | First-party |
| **Media (Multi)** | @felores/kie-ai-mcp-server | API-based unified MCP | Runway Aleph + Suno V5 + Midjourney + Recraft | Multi-service but API-only |
| **Multi-LLM Gateway** | LiteLLM + MCP | API unification | 100+ LLM providers | API-only, not web UI |
| **Multi-LLM Gateway** | Bifrost | Unified API gateway | OpenAI, Anthropic, Bedrock, Vertex (12+) | API-only |
| **Browser (General)** | Playwright MCP (Microsoft) | Playwright, accessibility snapshots | General web | Not AI-specific |
| **Browser (General)** | BrowserMCP | CDP, attaches to user's browser | General web | Closest to agbrowse's approach |
| **Claude Code** | @anthropic-ai/claude-code | MCP as first-class extension; can be MCP server itself | Claude | Plugin system |

## Key Insights

### 1. Web UI Wrappers Are Rare

Only `chatgpt-automation-mcp` directly automates a competitor's web UI via Playwright — ChatGPT only. No equivalent for Gemini, Grok, or Claude web UIs. The gap is enormous.

### 2. Media Generation Is API-Proxied, Not Browser-Automated

PiAPI's MCP server is the dominant unified option (Midjourney/Suno/Kling/Udio/Flux/Trellis) through a **paid API proxy**. None use browser automation against Midjourney Discord or Suno's web UI. This means:
- Users pay PiAPI markup on top of service costs
- Limited to what PiAPI reverse-engineers
- When PiAPI breaks, all downstream MCP consumers break

**CDP-based media automation would be more resilient and cost-neutral** (uses user's own subscription).

### 3. MCP-SuperAssistant: Interesting Reverse Pattern

Instead of wrapping AI UIs for external consumption, MCP-SuperAssistant **injects MCP tool calls INTO the AI web UIs**. This is complementary to agbrowse, not competitive — it makes the AI services consume tools, while agbrowse makes tools consume AI services.

### 4. BrowserMCP: Closest Architectural Match

BrowserMCP uses CDP to control the user's existing browser — same attach model as agbrowse. But it's general-purpose web automation, not AI-service-specific. No prompt handling, response extraction, session management, or model selection.

### 5. Claude Code MCP Integration

Claude Code treats MCP as a first-class plugin system (global or project-level). agbrowse could expose itself as an MCP server, letting Claude Code/Codex agents query ChatGPT/Gemini/Grok through agbrowse's CDP automation.

## Strategic Opportunity: agbrowse as MCP Server

```
agbrowse today:  CLI tool → CDP → AI web UIs

agbrowse + MCP:  MCP Server → agbrowse core → CDP → AI web UIs
                      ↑
                 Claude Code / Codex / any MCP client
```

This would make agbrowse the **only MCP server** that:
- Automates multiple AI web UIs (not just one)
- Uses CDP-attach (reuses user's browser/session)
- Covers both chat AND media generation
- Doesn't require paid API proxies

### Proposed MCP Tools

```
agbrowse_chat       — send prompt to ChatGPT/Gemini/Grok, get text response
agbrowse_media      — generate image/video/audio via Midjourney/Suno/Runway
agbrowse_status     — check job/session status
agbrowse_download   — download generated artifacts
agbrowse_sessions   — list/resume sessions
agbrowse_models     — list available models per vendor
```

## Competitive Moat via MCP

| Path | Who Can Copy | Moat Strength |
|------|-------------|---------------|
| CLI tool only | 10x-chat already close | WEAK |
| CLI + MCP server | chatgpt-automation-mcp covers 1 provider | MEDIUM |
| CLI + MCP + multi-provider + media | Nobody does this today | STRONG |
| CLI + MCP + multi-provider + media + CDP-attach | Nobody | VERY STRONG |
