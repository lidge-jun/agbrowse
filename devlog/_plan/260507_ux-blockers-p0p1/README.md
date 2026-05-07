# agbrowse UX Blocker Fixes — Plan Index

Repo: https://github.com/lidge-jun/agbrowse

Eight UX blockers from real-world agbrowse usage. Fixes 1-6 went through 7 rounds of GPT Pro audit (final: 6/6 PASS). Fixes 7-8 added post-audit (R8-R10 PASS).

## Priority Batches

### P0 — Stale State (implemented, commit `ccb7051`)
| Fix | File | Description |
|-----|------|-------------|
| [Fix 4](p0-fix4-stale-target-ownership.md) | `active-command-store.mjs` | Auto-expire stale running commands on register |
| [Fix 5](p0-fix5-stale-answer-pickup.md) | `chatgpt.mjs` | Session-scoped baseline + poll guards |

### P1 — Resilience + Defaults
| Fix | File(s) | Description |
|-----|---------|-------------|
| [Fix 1](p1-fix1-file-upload-policy.md) | `default-policy.mjs`, `schema.mjs`, `enforce.mjs`, `mcp-server.mjs`, `cli.mjs` | Provider-aware `allowFileAccess` default |
| [Fix 3](p1-fix3-crash-recovery.md) | `tab-recovery.mjs`, `chatgpt.mjs`, `grok-live.mjs`, `gemini-live.mjs` | Crash recovery in poll loops |
| [Fix 7](p1-fix7-thinking-placeholder.md) | `chatgpt.mjs` | Prevent thinking indicators as answers |

### P2 — UX Polish
| Fix | File(s) | Description |
|-----|---------|-------------|
| [Fix 2](p2-fix2-same-tab-reuse.md) | `cli.mjs` | Session-aware `--new-tab` default |
| [Fix 6](p2-fix6-session-url-reuse.md) | `navigation-ready.mjs` (NEW), `chatgpt.mjs`, `tab-recovery.mjs` | Selector wait + redirect URL persist |
| [Fix 8](p2-fix8-zip-default.md) | `file-selector.mjs`, `builder.mjs`, `package.json` | Auto-zip for all upload transport |

## Files Changed Summary

| File | Fixes |
|------|-------|
| `web-ai/policy/default-policy.mjs` | #1 |
| `web-ai/policy/schema.mjs` | #1 |
| `web-ai/policy/enforce.mjs` | #1 |
| `web-ai/mcp-server.mjs` | #1 |
| `web-ai/cli.mjs` | #1, #2 |
| `web-ai/chatgpt.mjs` | #3, #5, #6, #7 |
| `web-ai/gemini-live.mjs` | #3 |
| `web-ai/grok-live.mjs` | #3 |
| `web-ai/active-command-store.mjs` | #4 |
| `web-ai/tab-recovery.mjs` | #3, #6 |
| `web-ai/context-pack/builder.mjs` | #8 |
| `web-ai/context-pack/file-selector.mjs` | #8 |
| `package.json` | #8 |

## Audit History

- Rounds 1-7: Fixes 1-6 audited by GPT Pro (6/6 PASS at R7)
- R8-R10: Fixes 7-8 audited (2/2 PASS at R10)
- P0 A-phase: Fix 4 PASS, Fix 5 re-audited after null-null guard + return shape fix (PASS)
