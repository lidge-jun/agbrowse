# Action Items — Prioritized

## P0: Trigger & Runtime Reliability (immediate) — REINFORCED in doc 14

### A. Install web-ai as active skill in cli-jaw ✅ DONE (doc 15)
Moved from skills_ref to active skills.

### B. Update web-ai SKILL.md with trigger keywords ✅ DONE (doc 15)
Comprehensive `Triggers:` list added.

### C. Update browser SKILL.md with disambiguation ✅ DONE (doc 15)
`NOT for:` line added to browser skill.

### D. Fix empty-shell runtime blocker (NEW — GPT Pro R5)
Interstitial check fires before React composer renders → false positive empty-shell detection. Fix: wait for `#prompt-textarea` or equivalent composer readiness before `detectInterstitial`, with backoff.

### E. Execute routing regression suite (NEW — GPT Pro R5)
Current verification matrix is "Expected", not "Executed". Must run real tests covering: fresh install, instance restart, CLI upgrade, config reset, Korean spacing variants, mixed-language provider aliases, browser-vs-web-ai disambiguation.

### F. Add model→CLI mapping table to web-ai SKILL.md body
Quick-reference table so LLM can translate "Grok Heavy" → `--vendor grok --model heavy` without reading source code.

## P1: Competitive Response + MCP Server

### G. MCP Server (consolidated from former P1.G + P2.I)
Build agbrowse MCP server exposing `agbrowse_chat`, `agbrowse_media`, `agbrowse_sessions`, `agbrowse_models`. Moat: CLI-first + CDP-attach + effort normalization + session resume + copy-markdown cascade. Agentify is nearest MCP peer but lacks CLI-first + effort normalization.

### H. 10x-chat Feature Parity Deltas
- Add `--file` glob bundling, `--dry-run`, `--copy` features
- Claude/Perplexity provider expansion
- Session artifacts and history
- Track release cadence (v0.10.13, very active)

## P1: Competitive Response (RESEARCHED — see docs 09-12)

### E. 10x-chat Response (doc 09) ✅ RESEARCHED
- **Playwright + Patchright**, NOT CDP-attach. Owns browser lifecycle.
- 6 providers (ChatGPT, Gemini, Claude, Grok, Perplexity, NotebookLM)
- Unique: file bundling (`--file "src/**/*.ts"`), image gen, deep research mode, `--dry-run`/`--copy`, NotebookLM RPC, session history
- **Action**: Consider adding `--file` glob bundling, `--dry-run`, and image gen as feature responses
- **Action**: Track their release cadence (v0.10.13, very active)

### F. Agentify Desktop Response (doc 09) ✅ RESEARCHED
- CDP-based, 394 stars, MCP-first design for AI-to-AI delegation
- Stable tab keys, parallel hidden/visible tabs, artifact persistence
- **Action**: agbrowse's MCP server should expose similar tool surface (see doc 10)
- Different niche (agent delegation vs CLI automation), moderate threat

### G. MCP Server Opportunity (doc 10) ✅ RESEARCHED — NEW HIGH-PRIORITY
- **No production MCP server automates multiple AI web UIs** — this is the gap
- `chatgpt-automation-mcp` covers ChatGPT only (Playwright)
- PiAPI covers media services but via paid API proxy
- **Action**: Build agbrowse MCP server exposing `agbrowse_chat`, `agbrowse_media`, `agbrowse_sessions`, `agbrowse_models`
- Moat: CLI + MCP + multi-provider + media + CDP-attach = nobody does this

## P2: Remaining Skill Triggers & Disambiguation

### I. Fix diagram, imagegen, github, notion, telegram, memory, screen-capture, desktop-control
All lack explicit `Triggers:` — see doc 14 for per-skill proposed keywords.
8 failure modes identified: F1 (missing skill) through F8 (abbreviation gap).
Extended failure modes (GPT Pro R5): user opt-out/negative routing, multi-skill composition, stale model alias drift, canonical trigger drift, typo/romanization variants, prompt-injection in provider text.

### J. Add Korean triggers to ALL skills (30+1)
Universal Korean action verb dictionary + per-skill nouns.
Current coverage: 7/30 (23%) → target: 31/31 (100%).

### K. Add cross-skill disambiguation rules
12 ambiguous phrase pairs mapped with routing rules.
Each affected skill gets `NOT for:` + `Use <other-skill> instead.` line in description.

### L. Document competitive positioning
- Update README/comparison.md — acknowledge competitors and differentiate
- Do NOT claim "no competitors" — narrow the claim to agbrowse's specific combination
- Consider OpenAI-compatible proxy mode (conduit-bridge, CatGPT-Gateway show demand)

## P3: Media Architecture Prototype (docs 06-08, 12)

### M. Media command namespace — `agbrowse media`
- Hybrid architecture: same binary, different command namespace (doc 08)
- Shared BrowserPlatform layer, separate TextProvider/MediaProvider contracts
- TypeScript interfaces designed by GPT Pro (doc 08)
- **Implementation order**: Start with a ToS-compliant, high CDP-value provider first
- Add provider-level `automationAllowed`/`tosStatus` metadata as hard gate (GPT Pro R5)
- Include: credit preflight, CAPTCHA/manual-intervention states, artifact URL expiry, crash-resume, content-policy refusal states in MediaJobStatus

### N. Runway: API-first, CDP-second
- Official API covers core generation; MCP server exists
- CDP only for web-exclusive features (Motion Brush, Agent iteration, style transfer)
- Dual provider: `RunwayApiMediaProvider` + `RunwayWebMediaProvider`

### O. Pika 2.5 web-exclusive features (doc 12)
- fal.ai only has Pika 2.2; web has 2.5 + Pikaffects + lip sync + sound FX
- **HIGH CDP value** — significant web-only feature gap

**Note on Midjourney**: Midjourney ToS explicitly prohibit automated tools. Do NOT frame mitigation as "reduces detection" — that is evasion, not compliance. Require explicit CLI consent prompt for providers with automation restrictions.

## P4: Longer-Term Research

### N. Code generation UIs (doc 11)
- bolt.new and Replit Agent have NO API — pure CDP targets
- Recommend bolt.diy (OSS) over bolt.new for initial target
- v0.dev has full SDK — skip CDP
- Lovable has reference automation project (lovable-automation)

### O. Anti-fingerprint techniques
- Grok found AIstudioProxyAPI using Camoufox
- 10x-chat uses Patchright (stealth Playwright fork)
- Evaluate Patchright for heavy anti-bot sites

### P. Accessibility-tree reliability
- Playwright MCP uses a11y tree over screenshots for token efficiency
- agbrowse already has `ax-snapshot.mjs` — benchmark

### Q. Monitor 10x-chat release cadence
- v0.10.13, last push May 16, 2026. Very active.
- If they add CDP-attach or effort control, gap narrows

### R. OpenAI-compatible proxy mode
- conduit-bridge and CatGPT-Gateway show demand
- Lower priority than MCP but high distribution potential

## Research Session Artifacts

| File | Source | Content |
|------|--------|---------|
| /tmp/gptpro_competitor_research.json | GPT Pro | Full competitive map, 30+ tools |
| /tmp/grok_competitor_research.json | Grok Expert | Independent verification |
| /tmp/gptpro_runway_arch.json | GPT Pro | Runway architecture + TypeScript interfaces |
| /tmp/grok_generative_poll.json | Grok Expert | Generative AI landscape (recovered orphan) |
| /tmp/grok_media_tools_v2.json | Grok Expert | Media automation tools scan |
| This devlog directory | Synthesis | 13 files (00-12), jawdev format |
