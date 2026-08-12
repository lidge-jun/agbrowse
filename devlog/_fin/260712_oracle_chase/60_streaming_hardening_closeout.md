# 60 — Streaming Hardening Close-out (G6 + G3 + G4)

Date: 2026-07-13
Status: implemented
Oracle commits: `114610762975ca96136e92387c31fd875c6b03a2` (G3/G4), `83c3ca25a894dfd667c6e3d80db98f76d655a42f` (G6)

## G6 — "ChatGPT said: Answer now" Placeholder

Added `/^chatgpt said:\s*answer now\s*$/i` to `PLACEHOLDER_PATTERNS` in `web-ai/chatgpt.mjs`.
Anchored with `$` to prevent matching legitimate text like "ChatGPT said: Answer nowhere".
Existing patterns already covered `^answer now$` (exact) and `^pro thinking` (prefix).

## G3 — Progress Bar Activity Detection

Extended `isStreaming()` in `web-ai/chatgpt.mjs` to check for `progress` (HTML element) and `[role="progressbar"]` (ARIA role) via locator visibility.

Removed from initial patch after sol reviewer FAIL:
- `[aria-valuenow]` — matches Power slider and other non-streaming controls (false positive)
- `[data-testid*="progress"]` — too broad, matches upload and page-load indicators

Deep Research already had `[role="progressbar"]` in its own path (`chatgpt-deep-research.mjs:24`); this extends coverage to the general ChatGPT path.

## G4 — Sidecar Panel Activity Detection

Added `page.evaluate()` check in `isStreaming()` for right-side thinking/reasoning panels:

- Selectors: `aside`, `[role="complementary"]`, `[role="dialog"]`, `[data-testid*="thinking"]`, `[data-testid*="reasoning"]`, `[class*="sidecar"]`, `[class*="sidebar"]`
- Position check: `left >= 35%` viewport width, `>= 180x120` pixels
- Text match: contains "thinking", "reasoning", or "pro thinking"
- Past-tense exclusion: `label.includes('thought for')` returns false (catches both "Thought for 12s" and "Reasoning — Thought for 12s")
- Error-safe: both `querySelectorAll` and the entire `page.evaluate()` are try/caught

## Audit Trail

- Sol reviewer (Pascal): FAIL round 1, blocker on `[aria-valuenow]` false positive
- Fixes applied: removed `[aria-valuenow]`/`[data-testid*="progress"]`, anchored G6 regex, fixed past-tense `startsWith` → `includes`
- Stop-button behavior preserved (23/23 existing tests pass)

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
