# Plan: Browser Control Summary

**Issue: #76** | **Priority: P3** | **Status: planned**

## Problem

agbrowse launches browser runs without surfacing browser control state. Oracle's `controlPlan.ts` prints browser control mode info: attach-running, remote Chrome, headless, visible window, manual login, etc.

## Reference Implementation

Oracle `src/browser/controlPlan.ts`:
- Describes browser control mode, not prompt/model preview
- Reports: attach vs launch, headless vs visible, remote vs local, manual login needed
- Printed on stderr for human guidance, never on stdout

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/control-summary.mjs` | NEW | Browser control state summary |
| `web-ai/cli.mjs` | MODIFY | `--control-summary` opt-in flag |

## Diff Plan

### NEW `web-ai/control-summary.mjs`

```javascript
export function formatControlSummary({ cdpPort, tabSource, sessionReuse, recoveryUrl, chromeVisible })
// Return formatted stderr summary:
// [browser] cdp=localhost:9222 (attached to running Chrome)
// [browser] tab=pooled (reusing warm session tab)
// [browser] session=new | session=recovered from <url>
// [browser] chrome=visible (may focus window)
// Never include prompt text, file contents, or model name
// Never output on stdout — stderr only
```

### MODIFY `web-ai/cli.mjs`

```javascript
// --control-summary: opt-in flag, prints browser control state to stderr before execution
// Disabled by default — no breaking change to stdout/JSON contracts
// Does NOT conflict with existing --dry-run (used by context commands)
// Skipped entirely when --json is set
```

## Guardrails

- Opt-in only (`--control-summary`), never printed by default
- Output goes to stderr, never stdout — preserves agent-piped contracts
- No prompt text, file contents, or model info in output
- Describes agbrowse-specific state: CDP port, tab pooling, session recovery, Chrome visibility
- Does not conflict with existing `--dry-run` flag

## Test Plan

1. `--control-summary` → verify summary on stderr, no stdout change
2. Without flag → verify no summary printed
3. `--json --control-summary` → verify summary suppressed
4. Pooled tab reuse → verify "tab=pooled" in summary
5. New session → verify "session=new" in summary
