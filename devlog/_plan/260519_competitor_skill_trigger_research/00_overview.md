# 260519 — Competitor Research & Skill Trigger Metadata Enhancement

Date: 2026-05-19
Sources: GPT Pro (ChatGPT Pro model), Grok Expert
Method: agbrowse web-ai query against both providers with comprehensive prompts

## Research Scope

1. **Competitor/alternative landscape** for browser-based AI web UI automation
2. **Skill trigger metadata** in cli-jaw — how model names (grok, gemini, deepthink, heavy) should route to web-ai skill

## Key Findings

### 1. Competitive Landscape (Track A)
The space is no longer empty. **10x-chat** (6 providers, Playwright + Patchright) is the closest CLI competitor. **Agentify Desktop** (394 stars, CDP + MCP) targets AI-to-AI delegation. agbrowse's defensible position is: CDP-attach-first + CLI-first + normalized effort controls + session resume + copy-markdown fallback chain. No single competitor combines all six.

### 2. Media Generation Gap (Track B)
**No "agbrowse for media" exists.** Midjourney, Suno, Pika 2.5, and Udio have NO public APIs — browser automation is the only programmatic path. The recommended architecture: shared BrowserPlatform with separate TextProvider (chat) and MediaProvider (media jobs) interfaces, exposed as `agbrowse chat` and `agbrowse media` commands.

### 3. MCP Server Opportunity (Track D)
**No production MCP server automates multiple AI web UIs.** `chatgpt-automation-mcp` covers ChatGPT only. PiAPI covers media via paid proxy. agbrowse as MCP server (multi-provider chat + media via CDP-attach) would occupy a vacant niche with strong moat.

### 4. Code Generation UIs (Track D)
bolt.new and Replit Agent have zero APIs — pure CDP automation targets. v0.dev has a full SDK (skip CDP). bolt.diy (OSS) is recommended over bolt.new for initial media target.

## Research Scope (Expanded)

3. **Generative AI service landscape** — non-chat services (Midjourney, Suno, Runway, Pika, bolt.new) and their CDP automation potential
4. **Media automation architecture** — how agbrowse should expand to media generation services
5. **Top competitor deep-dives** — 10x-chat, Agentify Desktop, bolt.new automation landscape

## Devlog Index

### Track A: Competitive Landscape & Skill Triggers
- [00_overview.md](00_overview.md) — this file
- [01_competitor_map.md](01_competitor_map.md) — full competitive landscape from GPT Pro + Grok (30+ tools, 6 tiers)
- [02_gap_analysis.md](02_gap_analysis.md) — capability gaps and differentiation wedges
- [03_skill_trigger_analysis.md](03_skill_trigger_analysis.md) — current trigger system analysis
- [04_skill_trigger_proposal.md](04_skill_trigger_proposal.md) — proposed metadata enhancement for model-name routing
- [05_action_items.md](05_action_items.md) — prioritized next steps (P0-P3)

### Track B: Media Services & Architecture
- [06_generative_ai_landscape.md](06_generative_ai_landscape.md) — CDP value analysis across 7 categories (video, image, music, voice, code, presentations, avatar)
- [07_media_automation_tools.md](07_media_automation_tools.md) — existing automation projects for Midjourney, Suno, Udio, Runway + emerging MCP pattern
- [08_runway_integration_decision.md](08_runway_integration_decision.md) — architecture decision: hybrid approach with separate command namespaces + GPT Pro TypeScript interface designs

### Track C: Competitor Deep-Dives
- [09_competitor_deep_dives.md](09_competitor_deep_dives.md) — detailed analysis of top threats: 10x-chat, Agentify Desktop, bolt.new

### Track D: Ecosystem & Expansion Opportunities
- [10_mcp_ecosystem_map.md](10_mcp_ecosystem_map.md) — MCP server landscape for AI providers; agbrowse-as-MCP-server opportunity
- [11_code_gen_ui_landscape.md](11_code_gen_ui_landscape.md) — code generation web UIs: v0.dev, Replit Agent, Lovable, bolt.new
- [12_media_service_details.md](12_media_service_details.md) — Pika Labs, ElevenLabs automation deep-dive
- [13_strategic_synthesis.md](13_strategic_synthesis.md) — final synthesis: three strategic moves, risk matrix, lessons learned

### Track E: Skill System Reinforcement
- [14_skill_trigger_reinforcement_plan.md](14_skill_trigger_reinforcement_plan.md) — full 30-skill audit, trigger failure taxonomy (14 failure modes, expanded from 8 per GPT Pro R5), per-skill proposed triggers, cross-skill disambiguation rules, Korean trigger dictionary, phased implementation plan
- [15_web_ai_activation_fix.md](15_web_ai_activation_fix.md) — **IMPLEMENTED**: web-ai activated from skills_ref→skills, trigger keywords added (3 files), browser disambiguation added, 10-case routing verification matrix. **P0 BLOCKER**: empty-shell runtime false positive promoted per GPT Pro R5.

### Track F: GPT Pro R5 Audit (2026-05-19)
- **VERDICT**: NEEDS_FIX (1 PASS, 4 NEEDS_FIX)
- Strategy: narrowed MCP/media claims, split Move 3 into P0 reliability + P1 expansion
- Architecture: PASS (added ToS compliance gate, provider tosStatus metadata)
- Skill Triggers: extended taxonomy to 14 failure modes, promoted empty-shell to P0
- Priorities: reconciled roadmap across docs, deduplicated MCP from P1+P2→P1
- Blind Spots: added first-party computer-use agents tier (OpenAI/Anthropic/Gemini), quarterly watchlist
