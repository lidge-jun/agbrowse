# GPT Pro Phase 4+ Expansion Research (2026-05-01)

Verbatim GPT-5.5 Pro research output from the query:
"Phase 4부터 확장 방향을 조사하고 제안해줘. Vercel의 agent-browser,
Stagehand, Playwright MCP 등 최신 agent browser 프로젝트에서
agbrowse에 가져올 패턴을 분석해줘."

## Sources cited

- Vercel Labs agent-browser (GitHub)
- Stagehand / Browserbase (docs + GitHub issues)
- Playwright MCP (docs + GitHub)
- AI SDK Core / AI SDK 6 (Vercel docs)
- Browser-Use CLI (GitHub)
- AgentQL (docs)
- WebVoyager (arXiv paper)
- MolmoWeb (arXiv paper)
- Chrome DevTools MCP (Chrome for Developers + GitHub)

## Key proposals

### Phase 4 expansion
- AX hash alongside DOM hash (`ax-snapshot.mjs`)
- DoctorReportV2 schema with `snapshot`, `copyFallback`, `debug` sections
- `--annotate-screenshot` opt-in for DOM churn when accessible name gone
- `--include-console`, `--include-network` optional diagnostics

### Phase 5 expansion
- Action policy / domain allowlist (`action-policy.mjs`)
- Churn-log schema extended with healing.cacheHit, healing.resolution
- Profile lock heartbeat field

### Phase 6 concrete design
- Watcher state machine: poll → snapshot hash compare → streaming probe
- Session JSON fields: `lastDomHash`, `lastAxHash`, `lastStreamingState`

### New phases proposed
- Phase 7: Agent snapshot substrate (`ax-snapshot.mjs`, `ref-registry.mjs`, `observe-targets.mjs`)
- Phase 8: Self-healing selectors + local action cache (`self-heal.mjs`, `action-cache.mjs`, `action-trace.mjs`)
- Phase 9: Visual fallback / annotated screenshot (`annotated-screenshot.mjs`)
- Phase 10: MCP / AI SDK bridge (`tool-schema.mjs`, `mcp-server.mjs`)
- Phase 11: DOM churn eval harness (`eval-runner.mjs`, `fixtures/`)

Full verbatim output saved at:
`~/.claude/projects/-Users-jun--cli-jaw-3460/24c7e952-0368-46dd-a5c1-edf4fadf7f73/tool-results/bej7t1ezg.txt`

## Grok expert audit summary (same session)

Grok (expert mode) scored the Phase 0-3 process:
- Architecture: 9/10
- Code quality: 8.5/10
- Testing: 8/10
- Process: 9.5/10
- CLI UX: 8/10
- Dual-repo strategy: 7/10 (suggested collapsing eventually)
- Documentation: 9/10

Key Grok suggestions incorporated:
- Align with Vercel agent-browser's @eN ref system
- Consider Stagehand's self-healing selector cache
- Accessibility snapshot as primary agent interface (not screenshots)
