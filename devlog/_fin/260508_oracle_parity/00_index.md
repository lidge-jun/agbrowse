# Oracle Parity — Plan Index

Repo: https://github.com/lidge-jun/agbrowse
Reference: https://github.com/steipete/oracle (0.11.0, May 2026)

Feature gaps identified by comparing oracle 0.11.0 CHANGELOG + source against agbrowse HEAD.

## Priority Batches

### P1 — Core Feature Parity
| Plan | Issue | Description |
|------|-------|-------------|
| [02_images](02_images.md) | #68 | ChatGPT generated image collection/download |
| [03_tab_harvest](03_tab_harvest.md) | #71 | Rich tab state model + harvest/reattach |

### P2 — Extended Capabilities
| Plan | Issue | Description |
|------|-------|-------------|
| [01_artifacts](01_artifacts.md) | #72 | Session artifacts (transcripts, reports, images) |
| [04_multi_turn](04_multi_turn.md) | #69 | Multi-turn follow-up prompts |
| [05_deep_research](05_deep_research.md) | #70 | ChatGPT Deep Research mode |

### P3 — Nice-to-Have
| Plan | Issue | Description |
|------|-------|-------------|
| [06_archive](06_archive.md) | #74 | Auto-archive one-shot runs |
| [07_project_sources](07_project_sources.md) | #73 | ChatGPT Project Sources management |
| [08_control_summary](08_control_summary.md) | #76 | Browser control summary output |

## Implementation Order

Corrected order (artifacts-first, per GPT Pro review):

1. [**#72 artifacts**](01_artifacts.md) — establish artifact paths and session artifact metadata first
2. [**#68 images**](02_images.md) — save images through artifact sink or explicit output path
3. [**#71 tab inspect/harvest**](03_tab_harvest.md) — useful infrastructure, can parallel with #68, must respect leases
4. [**#69 multi-turn**](04_multi_turn.md) — requires real turns/session model work + artifacts
5. [**#70 Deep Research**](05_deep_research.md) — requires artifacts; tab harvest useful but not mandatory
6. [**#74 archive**](06_archive.md) — must run after artifacts, must know session type (project/deep/multi-turn)
7. [**#73 Project Sources**](07_project_sources.md) — independent after rewrite, file-upload semantics
8. [**#76 control summary**](08_control_summary.md) — opt-in stderr summary, independent

Key dependency: artifacts (#72) must come before any feature that promises durable local outputs.

## Follow-Up Gap Closeout

These plans were added after the 2026-05-13 shallow-parity audit against Oracle
`origin/main` `1828e2b`. They track code that exists in agbrowse but still lacks
public contracts, tests, lifecycle closure, or source-of-truth documentation.

| Plan | Description |
| --- | --- |
| [10_gap_closeout_index](10_gap_closeout_index.md) | Index and recommended rollout order for the follow-up gap closeout. |
| [11_generated_images_public_contract](11_generated_images_public_contract.md) | Close the hidden `--output-image` generated-image contract. |
| [12_project_sources_hardening](12_project_sources_hardening.md) | Turn hidden Project Sources support into a verified command surface. |
| [13_multi_turn_lifecycle](13_multi_turn_lifecycle.md) | Finalize follow-up session lifecycle, transcript, and archive behavior. |
| [14_deep_research_contract](14_deep_research_contract.md) | Decide and document Deep Research support level with tests. |
| [15_artifacts_archive_contract](15_artifacts_archive_contract.md) | Enforce artifact-before-archive semantics and expose artifact metadata. |
| [16_attachment_chip_hardening](16_attachment_chip_hardening.md) | Port current ChatGPT attachment-chip hardening from Oracle #192. |
| [17_upload_size_cap](17_upload_size_cap.md) | Add a normal upload cap distinct from context-package budget. |
| [18_mcp_advanced_surface](18_mcp_advanced_surface.md) | Align strict MCP schemas with deliberate advanced web-ai support. |

## Review Status

- GPT Pro Extended R1: FAIL (6 HOLD, 2 FAIL, 0 PASS)
- R1 fixes applied: #73 rewritten (file-upload), #76 rewritten (browser control summary), all HOLDs addressed
- GPT Pro Extended R2: **PASS with minor HOLD fixes** (3 PASS, 5 HOLD — implementation-precision, not rewrites)
- R2 PASS: #71 tab-harvest, #70 deep-research, #76 control-summary
- R2 HOLD fixes applied: #68 redirect guard + baseline clarification, #69 no intermediate finalization, #72 explicit artifact descriptors, #74 finalizer branch order + always semantics, #73 isolated tab + file validation
- GPT Pro Extended R3: **PASS** — all 8 plans PASS on all 5 criteria (correctness, risks, dependency order, oracle divergence, over-engineering)
