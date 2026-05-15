---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, human-supervised]
supersedes: 260514_insane_search_adaptive_fetch
---

# Adaptive Fetch v2 — Human-Supervised Full-Surface Design

## What Changed

v1 drew the line wrong. It treated normal browser behaviors (browser-grade HTTP,
user's own session, human challenge resolution) as "bypass" and blocked them.

v2 reframes the boundary:

```
Automated bypass   → No  (CAPTCHA solvers, credential stuffing, stealth libs)
Human assistance   → Yes (browser-grade requests, user session, human resolves)
```

insane-search does everything autonomously. agbrowse v2 does more — but with the
human in the loop.

## Design Documents

| File | Purpose |
|---|---|
| `01_principles.md` | Human-supervised model, assistance vs bypass |
| `02_escalation_ladder.md` | 6-phase architecture |
| `03_session_identity.md` | Session modes + browser-grade HTTP |
| `04_challenge_system.md` | WAF profiles + detection + human-loop response |
| `05_content_scoring.md` | Multi-signal scoring + network API discovery |
| `06_cli_result_schema.md` | Commands, flags, result schema |
| `07_vs_insane_search.md` | Comparison: adopted / different / skipped |
| `08_safety_model.md` | Revised safety boundaries |
| `09_file_map.md` | Implementation file structure |

## Implementation Phases

| File | Phase | Main outcome |
|---|---|---|
| `10_phase_01_core_safety.md` | 01 | Result model, URL validation, trace, SSRF defense |
| `11_phase_02_http_endpoints.md` | 02 | Browser-grade fetch, public endpoints, metadata |
| `12_phase_03_reader_scorer.md` | 03 | Reader normalization, content scoring |
| `13_phase_04_challenge_waf.md` | 04 | WAF profiles, challenge detection |
| `14_phase_05_browser_isolated.md` | 05 | Isolated Chrome render, network API discovery |
| `15_phase_06_user_session_human.md` | 06 | User session, human-in-the-loop resolution |
| `16_phase_07_cli_docs_gates.md` | 07 | CLI wiring, docs, structure, release gates |

## Relationship To v1

v1 (`260514_insane_search_adaptive_fetch/`) is already implemented in the working
tree. 14 modules exist under `skills/browser/adaptive-fetch/`. This v2 plan is
an incremental extension — not a greenfield rewrite.

v1 files that already exist and will be MODIFIED by v2:

```
index.mjs, validators.mjs, safety.mjs, trace.mjs, endpoint-resolvers.mjs,
fetcher.mjs, metadata.mjs, transforms.mjs, reader-adapters.mjs,
content-scorer.mjs, third-party-readers.mjs, challenge-detector.mjs,
browser-escalation.mjs, browser-runtime.mjs
```

Genuinely NEW files in v2:

```
waf-profiles.mjs        extracted from challenge-detector.mjs
browser-session.mjs      user session management (none/isolated/existing/user/interactive)
human-loop.mjs           human-in-the-loop challenge resolution
```

v1 research docs (06 engine flow, 10 upstream inventory, 11 principles) remain
valid and are referenced, not duplicated.

## Implementation Divergences

The plan docs below are historical. During implementation, several names and
flags changed from the original plan:

| Plan name | Implemented as | Reason |
|-----------|---------------|--------|
| `--browser-session fresh` | `--browser-session none` | `none` is clearer; `fresh` implied a cookie jar |
| `--reader jina` | `--allow-third-party-reader` | Explicit opt-in semantics |
| `--archive` | `--allow-archive` | Explicit opt-in, currently deferred |
| `--metadata-only` | not implemented | Deferred; metadata is part of scoring |
| `fresh/isolated/user/interactive` | `none/isolated/existing/user/interactive` | Added `existing` for reuse, renamed `fresh` to `none` |
| `DEFAULT_MAX_BYTES = 2MB` | `DEFAULT_MAX_BYTES = 1MB` | 1MB is sufficient for text content |

Phase plan files retain original plan names for historical context.

## Follow-up Hardening Plan

Live hard-smoke testing after v2 implementation found one release-blocking output
contract issue and several live classification divergences from the older v1
observation table. The follow-up plan lives at:

```
devlog/_plan/260515_adaptive_fetch_v2_hardening/
```
