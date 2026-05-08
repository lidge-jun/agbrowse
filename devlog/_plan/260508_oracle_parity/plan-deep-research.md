# Plan: ChatGPT Deep Research Mode

**Issue: #70** | **Priority: P2** | **Status: planned** | **Depends: #72**

## Problem

ChatGPT Deep Research takes minutes to complete and may render results in iframes or dedicated targets. agbrowse has no Deep Research support — the feature gap is not merely timeout length but mode activation, progress monitoring, and report extraction.

## Reference Implementation

Oracle 0.11.0 `--browser-research deep` (commit `dff95f2`):
- Activates Deep Research mode via slash-command path + fallback UI path
- Handles plan/auto-confirm flow
- Detects account blocks (fast failure, not full timeout wait)
- Monitors progress indicators during research phase
- Extracts final report from assistant content or Deep Research iframe/target
- Uses Runtime, Input, Page, and sometimes target/frame attachment
- Stores report as artifact with dedicated path/name

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/chatgpt-deep-research.mjs` | NEW | Deep Research mode orchestration |
| `web-ai/chatgpt.mjs` | MODIFY | Route to deep research when mode specified |
| `web-ai/cli.mjs` | MODIFY | `--research deep` flag |

## Diff Plan

### NEW `web-ai/chatgpt-deep-research.mjs`

```javascript
export async function sendDeepResearch(page, deps, { prompt, session, opts })
// 1. Activate Deep Research mode:
//    - Primary: slash-command path (/research or equivalent)
//    - Fallback: UI mode selector if slash-command fails
// 2. Handle plan/auto-confirm flow (ChatGPT may show research plan before starting)
// 3. Submit prompt
// 4. Detect account blocks → fast failure (not waiting full timeout)
// 5. Monitor progress indicators (research phase, sources found, etc.)
//    - Uses Runtime.evaluate for progress DOM inspection
// 6. Poll for completion with configurable --timeout (no hard cap)
//    - agbrowse already supports configurable timeouts via CLI
// 7. Extract report:
//    - Check assistant content first
//    - If report is in iframe/target: use Page/Target attachment to extract
//    - Convert to markdown
// 8. Save as artifact: report.md via #72 artifact sink
// 9. Record in session: researchMode="deep", progress state, report artifact

export async function extractResearchReport(page, deps)
// Find research report in assistant content or iframe
// Use Runtime.evaluate + Page.getFrameTree if needed
// Extract content, convert to markdown
// Return { text, sources, fromIframe }
```

### MODIFY `web-ai/chatgpt.mjs`

```javascript
// When opts.research === 'deep':
//   Route to sendDeepResearch instead of normal send flow
//   Session records researchMode: "deep"
```

### MODIFY `web-ai/cli.mjs`

```javascript
// --research deep — activates Deep Research mode
// Uses existing --timeout for poll duration (no hardcoded cap)
// Suggested: --timeout 1800 for Deep Research (documented in help)
```

## Guardrails

- No hardcoded timeout cap — uses existing `--timeout` CLI flag
- Account block detection for fast failure (don't wait 30min to discover block)
- Session records `researchMode: "deep"` — used by archive policy (#74)
- Report saved as artifact via #72 (prerequisite)
- #71 tab harvest useful for reattach/diagnostics but not strictly required
  (existing session recovery via saved conversationUrl works)

## Dependencies

- #72 (artifacts): report.md saved as artifact
- #71 (tab harvest): useful but not mandatory — session recovery already exists

## Test Plan

1. Deep Research prompt → verify mode activated, report captured as markdown
2. Account block during research → verify fast failure (not full timeout)
3. Report in iframe → verify iframe content extracted
4. Connection drop mid-research → verify reattach via session recovery works
5. `--timeout 900` → verify custom timeout honored, no hard cap override
