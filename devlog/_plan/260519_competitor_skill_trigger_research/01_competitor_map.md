# Competitor Map — Browser-Based AI Web UI Automation

Sources: GPT Pro (May 18, 2026) + Grok Expert (May 18, 2026)
Cross-referenced findings merged below. Items found by only one source noted.

## Tier 1: Direct Competitors (CLI/automation for AI web UIs)

### 10x-chat [GPT Pro exclusive find]
- **Repo**: MikeChongCan/10x-chat
- **Approach**: Playwright/Patchright persistent-profile
- **Providers**: ChatGPT, Gemini, Claude, Grok, Perplexity, NotebookLM
- **Model selection**: Yes (provider model flags incl. Gemini Deep Think modes)
- **Last activity**: May 16, 2026 (v0.10.12)
- **Unique**: CLI-first, multi-provider, file/glob context, session artifacts (bundle.md/response.md), --copy mode
- **vs agbrowse**: Closest CLI competitor. NOT CDP-attach; uses Playwright persistent profiles. No normalized effort control or copy-markdown extraction cascade.
- **Threat level**: HIGH — overlaps heavily

### Agentify Desktop [GPT Pro exclusive find]
- **Repo**: agentify-sh/desktop
- **Approach**: MCP/desktop layer with Chrome CDP backend
- **Providers**: ChatGPT, Claude, Perplexity, Gemini, Google AI Studio, Grok
- **Model selection**: Via MCP tools
- **Last activity**: Mar 24, 2026
- **Unique**: MCP surface, signed-in sessions, stable tab keys, parallel tabs, local repo/file context packing
- **vs agbrowse**: MCP-shaped desktop framework, not CLI-first runner. Less focused on model/effort selection and markdown extraction.
- **Threat level**: MEDIUM — different shape but similar surface

### conduit-bridge [GPT Pro exclusive find]
- **Repo**: elvatis/conduit-bridge
- **Approach**: Playwright persistent contexts, OpenAI-compatible HTTP proxy
- **Providers**: Grok, Claude, Gemini, ChatGPT
- **Model selection**: Yes (Grok Heavy, Gemini thinking/pro, GPT-5.x variants)
- **Last activity**: v0.2.3, May 17, 2026
- **Unique**: Very strong model-list coverage, OpenAI-compatible streaming
- **vs agbrowse**: API-gateway first, not CLI context packaging. No copy-markdown fallback or conversation resume beyond browser profiles.
- **Threat level**: MEDIUM-HIGH — strong model coverage

### CatGPT-Gateway [Both sources]
- **Repo**: GautamVhavle/CatGPT-Gateway
- **Approach**: Stealth Playwright/Patchright
- **Providers**: ChatGPT + Claude
- **Model selection**: Web UI control
- **Last activity**: May 18, 2026 (very active)
- **Unique**: Full OpenAI-compatible API gateway, tool calling/vision/files emulation, Docker/noVNC, TUI
- **vs agbrowse**: Only ChatGPT/Claude. Browser gateway, not CDP-attach CLI.
- **Threat level**: MEDIUM — active but narrower scope

### WebModel / web-model-bridge [GPT Pro exclusive find]
- **Repo**: linuxhsj/WebModel
- **Approach**: Browser automation with CDP attach/reuse, OpenAI/Anthropic-compatible bridge
- **Providers**: Claude, ChatGPT, DeepSeek, Kimi, Qwen, GLM, Grok, Gemini, Perplexity, Doubao, Xiaomimo
- **Last activity**: Apr 11, 2026
- **Unique**: Broadest provider coverage found; CDP attach mode documented
- **vs agbrowse**: API/dashboard bridge, not CLI-first. Less structured context packaging/session resume.
- **Threat level**: MEDIUM — broad but different shape

### Proxima [GPT Pro exclusive find]
- **Repo**: Zen4-bit/Proxima
- **Approach**: Local AI gateway using browser login sessions
- **Providers**: ChatGPT, Claude, Gemini, Perplexity (no Grok verified)
- **Last activity**: May 13, 2026
- **Unique**: REST + WebSocket + CLI + 45+ MCP tools, smart routing, multi-model queries
- **vs agbrowse**: Gateway/MCP/router shape. Claims "no DOM scraping." Non-commercial license.
- **Threat level**: MEDIUM — different mechanics

## Tier 2: Provider-Specific Automation

### AIstudioProxyAPI [Grok exclusive find]
- **Repo**: MasuRii/AIstudioProxyAPI-EN (and forks)
- **Approach**: Playwright + Camoufox anti-fingerprint
- **Providers**: Gemini web UI only
- **Last activity**: v4.1.1 Feb 2026 (forks active May 2026)
- **Unique**: Unlimited free Gemini via browser proxy, human-like requests

### openAdapter [GPT Pro]
- **Repo**: AviOfLagos/openAdapter
- **Approach**: Claude.ai Playwright DOM automation
- **Providers**: Claude only
- **Last activity**: Mar 2, 2026

### grok-bridge [GPT Pro]
- **Repo**: ythx-101/grok-bridge
- **Approach**: Safari AppleScript/JavaScript injection (NOT CDP)
- **Providers**: Grok only (SuperGrok)
- **Last activity**: v3.1.1, May 8, 2026

### chatgpt-automation-mcp [GPT Pro]
- **Repo**: cbusillo/chatgpt-automation-mcp
- **Approach**: Playwright/storage-state MCP server
- **Providers**: ChatGPT only
- **Last activity**: Archived Apr 27, 2026

### openclaw-cli-bridge-elvatis [GPT Pro]
- **Repo**: elvatis/openclaw-cli-bridge-elvatis
- **Approach**: OpenClaw bridge with persistent Chromium profiles
- **Providers**: Grok + Gemini (ChatGPT/Claude removed in v1.6.x)

## Tier 2.5: First-Party Browser Agents & Platforms (strategic substitutes)

> Added per GPT Pro R5 audit — these are not direct CLI competitors but platform threats that could reduce demand for third-party CDP adapters.

| Agent/Platform | Provider | What | Threat Level |
|---------------|----------|------|-------------|
| ChatGPT Agent / computer-use tool | OpenAI | End-to-end browser tasks via own computer | HIGH (strategic substitute) |
| Anthropic computer use | Anthropic | Screenshot + mouse + keyboard control | HIGH (strategic substitute) |
| Gemini Computer Use | Google | "See screen + generate UI actions" | MEDIUM-HIGH |
| BrowserMCP | Independent | Connects AI apps to user's browser | MEDIUM-HIGH (platform threat) |
| Chrome DevTools MCP | Google | Gives coding agents live DevTools access | MEDIUM (could add playbooks) |
| Browser Use | Independent | AI-agent-optimized Playwright | MEDIUM |
| Browserbase / cloud browser APIs | Various | Hosted browser environments | LOW-MEDIUM |

**Assessment**: These are strategic substitutes, not direct competitors. If first-party agents become reliable and affordable, they reduce demand for hand-built CDP adapters. BrowserMCP and Chrome DevTools MCP could quickly add provider-specific playbooks and erode agbrowse's CDP-attach wedge. Monitor quarterly.

## Tier 3: Generic Browser Automation Frameworks (usable substrates)

| Tool | Approach | Last Activity | Key Feature |
|------|----------|---------------|-------------|
| browser-use (Grok find) | Playwright self-healing | Apr 2026 | Cloud stealth, AI-agent optimized |
| microsoft/playwright-mcp (Both) | Playwright + MCP + a11y tree | May 2026 | Token-efficient snapshots for coding agents |
| Chrome DevTools MCP (Grok find) | Native CDP + MCP | May 2026 | Direct DevTools control |
| agent-browser (GPT Pro) | Vercel Labs CLI, CDP-aware | v0.27.0, May 2026 | Excellent browser-control CLI |
| Hanzi Browse (GPT Pro) | Browser-agent context layer | Apr 2026 | Site playbooks, MCP, ChatGPT/Claude playbooks |
| Stagehand (GPT Pro) | NL + code automation | Active | Resilient browser tasks |
| Skyvern (GPT Pro) | Playwright + AI-driven | Active | Complex UI flow automation |
| Steel Browser (GPT Pro) | Browser API for AI agents | Active | Session/browser management |

## Tier 4: Browser Extensions (human-facing orchestration)

| Tool | Providers | Unique Feature |
|------|-----------|----------------|
| ChatHub (Both) | 20+ providers | Side-by-side multi-model comparison |
| ChatMultiAI (Both) | ChatGPT/Gemini/Claude/Grok/DeepSeek | Send one prompt to all |
| HARPA AI (Grok find) | ChatGPT/Claude/Gemini/Grok/Perplexity/DeepSeek | 100+ automation commands, commercial |
| Panelize (GPT Pro) | ChatGPT/Claude/Gemini/Grok/Doubao/DeepSeek/Kimi | Privacy-focused comparison |
| CompareAI (GPT Pro) | ChatGPT/Claude/Gemini/DeepSeek/Qwen | Chrome Web Store |
| personal-ai-memory (GPT Pro) | ChatGPT/Gemini/Claude/Grok/Perplexity | Passive conversation capture/RAG |

## Tier 5: Legacy/Stale Wrappers

GPT Pro identified 8+ ChatGPT-only Selenium/Playwright wrappers (GPTDriver, ChatGPT-AutoChat, gptauto, StealthGPT, SlymeGPT, chatgpt_web_automator, mse_ai_api, chatgpt-browser-bridge). All are narrow, brittle, old, and missing multi-vendor/model/session abstractions.

## Tier 6: Free API / Reverse-Engineered Access

| Tool | What | Difference from agbrowse |
|------|------|------------------------|
| token-free-gateway | OpenAI-compat via web sessions | Gateway-first, not CLI automation |
| gpt4free | Provider aggregator/reverse API | Not browser UI automation |
| Free-GPT4-WEB-API | Self-hosted free multi-provider | Generic free API project |
| acheong08/ChatGPT | Reverse-engineered ChatGPT | API flows, not DOM automation |
| PoePT | Selenium for Poe chatbots | Poe-focused, not direct providers |
