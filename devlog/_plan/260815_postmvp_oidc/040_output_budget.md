# 040 Output Budget (H-010)

## Modify: web-ai/ax-snapshot.mjs + browser-core.mjs
- AGBROWSE_MAX_OBSERVATION_CHARS env (default 100000)
- Truncation with [truncated] notice
- Per-command --max-output flag

## Test: test/unit/output-budget.test.mjs
