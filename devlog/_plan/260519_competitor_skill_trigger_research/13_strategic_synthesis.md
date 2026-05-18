# Strategic Synthesis — Where agbrowse Goes From Here

Date: 2026-05-19
Synthesized from: 12 research documents, GPT Pro + Grok Expert sessions, 8 sub-agent deep-dives

## The Big Picture

agbrowse sits at the intersection of three growing markets:
1. **AI web UI automation** — making ChatGPT/Gemini/Grok accessible from CLI/scripts
2. **Media generation automation** — programmatic access to Midjourney/Suno/Runway/Pika
3. **MCP tool ecosystem** — agents delegating to other AI services

No single tool covers all three today. agbrowse's CDP-attach-first architecture is uniquely positioned to expand across all three.

## Competitive Position Summary

### Chat Automation (Current)

| Dimension | agbrowse | 10x-chat | Agentify Desktop |
|-----------|----------|----------|------------------|
| Providers | 3 | 6 | 6 |
| Architecture | CDP-attach | Playwright (own browser) | CDP + MCP tools |
| Session resume | YES | YES | YES |
| Model normalization | YES (effort control) | Partial | No |
| File input | Context packaging | Glob bundling | Context packing |
| MCP integration | Planned | Skill system | Core |

**Assessment**: 10x-chat is wider (more providers), agbrowse is deeper (better per-provider tuning). Agentify is a different niche (agent delegation).

### Media Automation (Expansion)

| Service | Automation Status | agbrowse Opportunity |
|---------|------------------|---------------------|
| Midjourney | No API, heavy community CDP | VERY HIGH — most demanded |
| Suno | No API, multiple reverse-eng wrappers | VERY HIGH — wrappers break often |
| Pika 2.5 | Only 2.2 on fal.ai API | HIGH — web-exclusive features |
| Udio | No API | HIGH — sparse automation |
| Runway | Full API + MCP | MEDIUM — CDP for web extras only |
| ElevenLabs | Full API + MCP | LOW — skip CDP |

### Code Generation (Future)

| Service | API Status | CDP Feasibility |
|---------|-----------|-----------------|
| bolt.new | None | High opportunity, target bolt.diy |
| Replit Agent | None | Highest complexity |
| Lovable | Partial | Medium, reference project exists |
| v0.dev | Full SDK | Skip CDP |

## Three Strategic Moves

### Move 1: Ship agbrowse MCP Server (P1 — near-term)

**Why**: No CLI-first, CDP-attach, normalized effort/model, resumable-session MCP server spans chat + media using the user's existing browser. Agentify Desktop covers multi-provider MCP but lacks CLI-first usage, effort normalization, and copy-markdown fallback. chatgpt-automation-mcp is archived and ChatGPT-only.

```
agbrowse_chat       — send prompt to ChatGPT/Gemini/Grok
agbrowse_media      — generate image/video/audio
agbrowse_status     — check job/session status
agbrowse_sessions   — list/resume sessions
agbrowse_models     — list available models per vendor
```

**Moat**: CLI + MCP + multi-provider + CDP-attach + effort normalization + session resume + copy-markdown cascade. Agentify is the nearest MCP peer, but its desktop-app shape and lack of effort/model normalization leave clear differentiation.

### Move 2: Launch `agbrowse media` Namespace (P2 — medium-term)

**Architecture** (from GPT Pro):
```
agbrowse-core (BrowserPlatform: CDP, tabs, sessions, downloads)
├── agbrowse chat (TextProvider: ChatGPT, Gemini, Grok)
└── agbrowse media (MediaProvider: Midjourney, Suno, Pika, Runway)
```

**Implementation order**: Midjourney → Suno → Pika 2.5 → Udio

**Key design decisions**:
- Separate TypeScript interfaces: TextProvider vs MediaProvider
- Shared BrowserPlatform layer
- Job-based lifecycle: submit → queue → running → download
- API-first where available (Runway), CDP-first where not (Midjourney, Suno)

### Move 3a: Fix Skill Trigger & Runtime Reliability (P0 — immediate)

- Install web-ai as active skill in cli-jaw
- Add comprehensive trigger keywords to SKILL.md
- Add disambiguation line to browser skill
- Fix empty-shell runtime blocker (interstitial check before composer renders)
- Execute routing regression suite (not just "expected" matrix)

### Move 3b: Provider Expansion (P1 — competitive response)

- Add Claude, Perplexity providers (10x-chat parity)
- Add `--file` glob bundling, `--dry-run`, `--copy` features
- Track 10x-chat release cadence

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Midjourney ToS enforcement | MEDIUM | HIGH | automationAllowed/tosStatus metadata as hard gate, explicit CLI consent prompt, compliance-first (not evasion) |
| 10x-chat adds CDP-attach | LOW | MEDIUM | Deepen per-provider tuning, ship MCP first |
| AI services add official APIs | MEDIUM | MEDIUM | API-first/CDP-second architecture already planned |
| Web UI DOM changes break selectors | HIGH | LOW | Copy-markdown fallback, DOM hash verification |
| Patchright/Playwright catches up on stealth | LOW | LOW | agbrowse uses real Chrome, not headless |

## What We Learned

1. **The category is no longer empty.** 10x-chat (36 stars, 6 providers, active) is the closest competitor. But agbrowse's CDP-attach approach is architecturally superior for the "reuse your browser" use case.

2. **MCP is the emerging distribution channel.** Agentify Desktop (394 stars) proves that MCP-first AI web UI tools get adoption. agbrowse should expose MCP tools.

3. **Media generation is a differentiation opportunity.** No unified CDP/browser-automation CLI/MCP uses the user's own subscriptions across Midjourney/Suno/Pika/Runway. PiAPI and @felores/kie-ai-mcp-server are proxy/API alternatives, but CDP-based automation using existing subscriptions is a distinct value prop.

4. **The boundary is generation mode, not vendor.** GPT Pro's insight: separate TextProvider (chat) from MediaProvider (media jobs) at the interface level, share BrowserPlatform underneath.

5. **Some services don't need CDP.** v0.dev (SDK), ElevenLabs (API + MCP), Runway (API). Always check before automating.

6. **First-party computer-use agents are strategic substitutes.** OpenAI ChatGPT Agent, Anthropic computer use, and Gemini Computer Use can reduce demand for hand-built CDP adapters if they become reliable and affordable. These are not direct CLI competitors but platform threats that warrant quarterly monitoring.

## Quarterly Watchlist

| Threat | Type | Why Watch |
|--------|------|-----------|
| OpenAI ChatGPT Agent / computer-use tool | First-party | Can automate browser tasks end-to-end |
| Anthropic computer use / Claude desktop control | First-party | Screenshot+mouse+keyboard control |
| Gemini Computer Use / Chrome integration | First-party | "See screen + generate UI actions" |
| BrowserMCP | Platform | Connects AI apps to user's browser for automation |
| Chrome DevTools MCP | Platform | Gives coding agents live Chrome/DevTools access |
| Browser Use | Platform | AI-agent-optimized browser automation |
| Browserbase / cloud browser APIs | Infrastructure | Could add provider-specific playbooks |
| 10x-chat | Direct | Very active (v0.10.13), closest CLI competitor |
