# Oracle Parity — Plan Index

Repo: https://github.com/lidge-jun/agbrowse
Reference: https://github.com/steipete/oracle (0.11.0, May 2026)

Feature gaps identified by comparing oracle 0.11.0 CHANGELOG + source against agbrowse HEAD.

## Priority Batches

### P1 — Core Feature Parity
| Plan | Issue | Description |
|------|-------|-------------|
| [plan-images](plan-images.md) | #68 | ChatGPT generated image collection/download |
| [plan-tab-harvest](plan-tab-harvest.md) | #71 | Rich tab state model + harvest/reattach |

### P2 — Extended Capabilities
| Plan | Issue | Description |
|------|-------|-------------|
| [plan-multi-turn](plan-multi-turn.md) | #69 | Multi-turn follow-up prompts |
| [plan-deep-research](plan-deep-research.md) | #70 | ChatGPT Deep Research mode |
| [plan-artifacts](plan-artifacts.md) | #72 | Session artifacts (transcripts, reports, images) |

### P3 — Nice-to-Have
| Plan | Issue | Description |
|------|-------|-------------|
| [plan-project-sources](plan-project-sources.md) | #73 | ChatGPT Project Sources management |
| [plan-archive](plan-archive.md) | #74 | Auto-archive one-shot runs |
| [plan-control-plan](plan-control-plan.md) | #76 | Browser control summary output |

## Implementation Order

Corrected order (artifacts-first, per GPT Pro review):

1. **#72 artifacts** — establish artifact paths and session artifact metadata first
2. **#68 images** — save images through artifact sink or explicit output path
3. **#71 tab inspect/harvest** — useful infrastructure, can parallel with #68, must respect leases
4. **#69 multi-turn** — requires real turns/session model work + artifacts
5. **#70 Deep Research** — requires artifacts; tab harvest useful but not mandatory
6. **#74 archive** — must run after artifacts, must know session type (project/deep/multi-turn)
7. **#73 Project Sources** — independent after rewrite, file-upload semantics
8. **#76 control summary** — opt-in stderr summary, independent

Key dependency: artifacts (#72) must come before any feature that promises durable local outputs.

## Review Status

- GPT Pro Extended R1: FAIL (6 HOLD, 2 FAIL, 0 PASS)
- R1 fixes applied: #73 rewritten (file-upload), #76 rewritten (browser control summary), all HOLDs addressed
- GPT Pro Extended R2: **PASS with minor HOLD fixes** (3 PASS, 5 HOLD — implementation-precision, not rewrites)
- R2 PASS: #71 tab-harvest, #70 deep-research, #76 control-summary
- R2 HOLD fixes applied: #68 redirect guard + baseline clarification, #69 no intermediate finalization, #72 explicit artifact descriptors, #74 finalizer branch order + always semantics, #73 isolated tab + file validation
- GPT Pro Extended R3: **PASS** — all 8 plans PASS on all 5 criteria (correctness, risks, dependency order, oracle divergence, over-engineering)
