# agbrowse Open Issues Tracker — 2026-06-03

19 open issues across two categories: competitive gap closeout (9) and feature requests (10).

## P0 — Competitive Gap (Critical)

| # | Gap | Title | Category | vs |
|---|-----|-------|----------|----|
| 64 | G01 | First-party autonomous planner loop | planner | Stagehand, browser-use |
| 59 | G02 | observe()-style action candidate API | observation | Stagehand, AgentQL |
| 61 | G03 | Generic action breadth | actions | Vercel agent-browser, Playwright MCP |

## P1 — Competitive Gap (Important)

| # | Gap | Title | Category | vs |
|---|-----|-------|----------|----|
| 65 | G05 | Schema-bound page extraction | observation | Stagehand, AgentQL |
| 60 | G06 | Unified multimodal observation bundle | observation | Playwright MCP, VisualWebArena |
| 63 | G07 | Persistent action memory / repeatable action cache | reliability | Stagehand, AgentQL |
| 67 | G08 | Reference benchmark adapters without score claims | bench | WebVoyager/WebArena/VWA/Mind2Web |
| 66 | G09 | Model-adapter surface for planner/extractor | provider-coverage | Stagehand, browser-use |
| 62 | G11 | Local replay/observability timeline | dx | Browserbase, Stagehand |

## Feature Requests (web-ai / browser)

| # | Title | Summary |
|---|-------|---------|
| 68 | collect ChatGPT generated images | Detect DALL-E images in ChatGPT responses and save as artifacts |
| 69 | multi-turn follow-up prompts | Support --browser-follow-up for multiple prompts in one conversation |
| 70 | ChatGPT Deep Research browser mode | Progress monitoring, reattach recovery, iframe report capture |
| 71 | rich tab state model + harvest/reattach | Detailed ChatGPT tab inspection: model label, button states, auth, fingerprint |
| 72 | session artifacts (transcripts, reports, images) | Durable artifact storage beyond session metadata |
| 73 | ChatGPT Project Sources management | Non-destructive Project Sources CRUD for Developer Mode |
| 74 | auto-archive one-shot browser runs | Archive successful one-shot ChatGPT runs after artifacts saved |
| 76 | browser control plan output before runs | Pre-run plan preview explaining what browser will do |
| 77 | session reattach target rebinding edge cases | Investigate binding preservation across closed/crashed/recreated tabs |

## Priority Matrix

```
           P0 (ship-blocking)          P1 (important)
Gap     │ G01 planner, G02 observe,  │ G05 extraction, G06 multimodal,
        │ G03 action breadth          │ G07 memory, G08 bench, G09 model,
        │                             │ G11 replay
────────┼─────────────────────────────┼──────────────────────────────────
Feature │ #77 reattach edge cases     │ #68 images, #69 multi-turn,
        │ (reliability)               │ #70 deep research, #71 tab state,
        │                             │ #72 artifacts, #73 sources,
        │                             │ #74 auto-archive, #76 plan output
```

## Dependency Graph

- G01 (planner) → depends on G02 (observe) and G03 (actions)
- G06 (multimodal obs) → builds on G05 (extraction)
- G09 (model-adapter) → enables G01 (planner)
- #70 (deep research) → requires #71 (tab state) and #72 (artifacts)
- #69 (multi-turn) → requires #71 (tab state)
- #68 (images) → feeds into #72 (artifacts)

## Suggested Execution Order

1. **Foundation**: G02 observe + G03 actions (unblock planner)
2. **Planner**: G01 autonomous planner + G09 model-adapter
3. **Observation**: G05 extraction → G06 multimodal bundle
4. **DX**: G11 replay, G07 memory, G08 benchmarks
5. **Web-AI Features**: #71 tab state → #69 multi-turn → #70 deep research → #72 artifacts → #68 images → #74 auto-archive
6. **Polish**: #76 plan output, #73 sources, #77 reattach hardening
