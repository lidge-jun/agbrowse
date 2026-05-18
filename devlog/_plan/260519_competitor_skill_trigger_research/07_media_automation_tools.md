# Media Automation Tools — Existing Projects

Sources: Grok Expert (2 sessions), Web Search (May 19, 2026)

## Midjourney Automation

| Project | Approach | Last Activity |
|---------|----------|---------------|
| **TheMizeGuy/midjourney-claude-plugin** | Playwright browser automation, Claude Code plugin | v1.0.0 Apr 2026 |
| **passivebot/midjourney-automation-bot** | Playwright + Python Discord web UI + GPT-3 prompts | Archived Jul 2024, 201 stars |
| **Draym/discord-puppet** | Puppeteer (Node/TS) headless Discord puppet + MidjourneyPuppet | Active, ~49 stars |
| **Apify igolaizola/midjourney-automation** | Cloud browser automation, bulk gen + auto-upscale | Active, $19/mo + usage |
| **Chrome extensions (Midbot, etc.)** | Extension-based | Active (TOS risk noted) |

Key finding: Midjourney has **NO public API** (enterprise-only). Browser automation is the primary programmatic access path. Heavy community automation activity exists.

## Suno Automation (Music)

| Project | Approach | Last Activity |
|---------|----------|---------------|
| **gcui-art/suno-api** | Playwright + rebrowser-patches + 2Captcha → OpenAI-compat API | Active 2026, 2.9k stars |
| **schobiDotDev/sunokit** | Node.js CLI, rebrowser-puppeteer-core, full Suno.com automation | Active, MIT |
| **Suno-API/Suno-API** (Golang) | OpenAI-compatible interface, streaming/non-streaming | Active 2026 |
| **worthable/suno-api** (TypeScript) | Client library for audio gen/extend/concat/lyrics | Active |
| **SunoAI-API/Suno-API** (Python/FastAPI) | Token maintenance + keep-alive | Active |
| **igolaizola/musikai** | End-to-end pipeline: Suno + Udio + Midjourney covers + DistroKid | Active, hundreds of commits |

Key finding: Suno has **NO official API**. Multiple competing unofficial wrappers exist. **igolaizola/musikai** is the closest to "multi-service media automation" — it orchestrates Suno + Udio + Midjourney in one pipeline.

## Udio Automation (Music)

| Project | Approach | Last Activity |
|---------|----------|---------------|
| **flowese/UdioWrapper** (Python/PyPI) | Reverse-engineered API, NOT browser automation | v0.0.2 on PyPI |

Key finding: Udio also has **NO official API**. UdioWrapper uses reverse-engineered endpoints. Browser automation projects for Udio are sparse.

## Runway ML Automation

| Project | Approach | Last Activity |
|---------|----------|---------------|
| **igolaizola/vidai** | Go CLI, browser token extraction for Gen2/Gen3 | Dec 2024, 94 stars |
| **runwayml/runway-api-mcp-server** | OFFICIAL MCP server wrapper | Active |
| **Apify igolaizola/runway-automation** | Cloud browser automation | Active |

Key finding: Runway HAS a full official API (Gen-3/4, text/image-to-video, characters) AND an official MCP server. API limitations: no webhooks for reliable async, limited for production at scale. Web UI exclusive features: Motion Brush, style transfer, real-time previews, Agent iteration.

## Multi-Service Media Automation

**No equivalent to agbrowse found for media services.** All existing projects are single-service:
- jayeshmepani/Media-AI — "Ultimate AI Media Generation Tools Master List" (curated list, not a tool)
- AI Media Studio CLI — multi-modal but Google-models-only
- n8n / Langflow — workflow orchestration (not browser automation)

**This is a clear gap in the market.** There is no "agbrowse for media" that provides unified CDP-based automation across Midjourney + Suno + Runway + Pika from one CLI.

## MCP Servers for Media Services (Emerging Pattern)

| Project | Services Covered | Notes |
|---------|-----------------|-------|
| **runwayml/runway-api-mcp-server** | Runway only | OFFICIAL |
| **@felores/kie-ai-mcp-server** (npm) | Runway Aleph + Suno V5 + Midjourney + Recraft | Multi-service unified MCP |
| **AceDataCloud MCP endpoints** | Midjourney/Suno/Flux/Luma | Hosted MCP service |
| **mcp-suno** (PyPI) | Suno only | Python MCP wrapper |

Key insight: **MCP is becoming the emerging bridge for agentic multi-service media use.** The @felores/kie-ai-mcp-server is the closest thing to a unified multi-provider media interface, but it's API-based, not browser-automation-based.

## Automation Approach Landscape

| Service | Primary Automation Approach | Browser Automation Used? |
|---------|---------------------------|------------------------|
| Midjourney | Playwright/Puppeteer (web + Discord) | YES — primary path |
| Suno | Reverse-engineered API + CAPTCHA solving | Playwright for auth only |
| Udio | Reverse-engineered API | No |
| Runway | Official API | Apify actors for web-only features |
| Pika | Limited (fal.ai for some models) | Sparse |
| bolt.new | None found | HIGH CDP opportunity |
