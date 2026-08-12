# 09 Structure SoT + Semantic Gate Evidence

Worker H, 2026-07-10. Unit 09 of GPT-5.6 update.

## Files Changed (9)

| File | Change |
| --- | --- |
| `structure/CAPABILITY_TRUTH_TABLE.md` | ChatGPT resolver row: added product-surfaces.mjs, GPT-5.6 Chat family/tier, Work CLI+MCP, fixture owners, cli-jaw parity note |
| `structure/phase_status.md` | Phase 17: added GPT-5.6 Chat/Work fixtures, consuming test files, Work isolation requirement |
| `structure/commands.md` | Provider Alias table: families, canonical effort, legacy remaps, Work CLI+MCP, 3-tier timeout; MCP strict schema: Chat/Work surface separation |
| `structure/runtime_contracts.md` | ChatGPT Provider Runtime row expanded; modelSelection fields; legacy selector baseline rename; GPT-5.6 devlog anchor |
| `structure/INDEX.md` | Sync checklist item for ChatGPT surface/family/tier/effort/timeout changes |
| `structure/check-doc-drift.sh` | +112 lines: semantic doc-contract gate (3-tier token judgment) |
| `structure/release_gates.md` | Release checklist semantic gate line; test:release-gates Script Coverage updated |
| `docs/dev/reference/release-gates.html` | EN: stale-token bullet added |
| `docs/dev/ko/reference/release-gates.html` | KO: matching stale-token bullet added |

## Gate Commands & Results

### 1. `bash structure/check-doc-drift.sh`
PASS structure/AGENTS.md exists
PASS structure/INDEX.md exists
PASS structure/str_func.md exists
PASS structure/commands.md exists
PASS structure/runtime_contracts.md exists
PASS structure/release_gates.md exists
PASS structure/phase_status.md exists
PASS structure/verify-counts.sh exists
PASS structure/_legacy/.gitkeep exists
PASS docs/production-readiness.md exists
PASS docs/comparison.md exists
PASS docs/benchmarks.md exists
PASS benchmarks/agbrowse/trajectory.mjs exists
PASS benchmarks/agbrowse/run-task.mjs exists
PASS structure/CAPABILITY_TRUTH_TABLE.md has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS structure/phase_status.md has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS structure/commands.md has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS structure/runtime_contracts.md has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS structure/release_gates.md has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
FAIL skills/browser/browser.mjs has ChatGPT semantic doc-contract violations: missing required current token "chatgpt-pro=5400", missing required current token "grok-heavy=3600", missing required current token "deep-research=3600"
PASS skills/web-ai/SKILL.md has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
FAIL README.md has ChatGPT semantic doc-contract violations: "Pro Extended" at line 719
PASS docs/dev/index.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/quickstart.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/guides/web-ai.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/guides/code-mode.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/reference/cli.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/reference/release-gates.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/ko/index.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/ko/quickstart.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/ko/guides/web-ai.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/ko/guides/code-mode.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/ko/reference/cli.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS docs/dev/ko/reference/release-gates.html has current required tokens and no unallowlisted stale ChatGPT doc-contract tokens
PASS commands.md lists root command start
PASS commands.md lists root command stop
PASS commands.md lists root command status
PASS commands.md lists root command reset
PASS commands.md lists root command snapshot
PASS commands.md lists root command screenshot
PASS commands.md lists root command text
PASS commands.md lists root command get-dom
PASS commands.md lists root command click
PASS commands.md lists root command type
PASS commands.md lists root command press
PASS commands.md lists root command hover
PASS commands.md lists root command select
PASS commands.md lists root command check
PASS commands.md lists root command uncheck
PASS commands.md lists root command drag
PASS commands.md lists root command mouse-click
PASS commands.md lists root command move-mouse
PASS commands.md lists root command mouse-down
PASS commands.md lists root command mouse-up
PASS commands.md lists root command navigate
PASS commands.md lists root command reload
PASS commands.md lists root command resize
PASS commands.md lists root command tabs
PASS commands.md lists root command tab-switch
PASS commands.md lists root command select-tab
PASS commands.md lists root command tab-cleanup
PASS commands.md lists root command scroll
PASS commands.md lists root command wait
PASS commands.md lists root command wait-for-selector
PASS commands.md lists root command wait-for-text
PASS commands.md lists root command wait-for
PASS commands.md lists root command console
PASS commands.md lists root command network
PASS commands.md lists root command evaluate
PASS commands.md lists root command web-ai
PASS commands.md lists root command runway
PASS commands.md lists root command skills
PASS commands.md lists root command install-skills
PASS commands.md lists web-ai command render
PASS commands.md lists web-ai command status
PASS commands.md lists web-ai command send
PASS commands.md lists web-ai command poll
PASS commands.md lists web-ai command query
PASS commands.md lists web-ai command code
PASS commands.md lists web-ai command code-extract
PASS commands.md lists web-ai command stop
PASS commands.md lists web-ai command watch
PASS commands.md lists web-ai command snapshot
PASS commands.md lists web-ai command project-sources list/add
PASS commands.md lists web-ai command sessions list
PASS commands.md lists web-ai command sessions show
PASS commands.md lists web-ai command sessions resume
PASS commands.md lists web-ai command sessions reattach
PASS commands.md lists web-ai command sessions prune
PASS commands.md lists web-ai command context-dry-run
PASS commands.md lists web-ai command context-render
PASS commands.md lists web-ai command mcp-server
PASS commands.md lists web-ai command eval
PASS commands.md lists web-ai command doctor
PASS commands.md lists web-ai command claim-audit
PASS commands.md lists runway command selectors
PASS commands.md lists runway command status
PASS commands.md lists runway command open
PASS commands.md lists runway command preflight
PASS commands.md lists runway command poll
PASS commands.md lists MCP tool browser_snapshot
PASS commands.md lists MCP tool browser_click_ref
PASS commands.md lists MCP tool web_ai_snapshot
PASS commands.md lists MCP tool web_ai_click_ref
PASS commands.md lists MCP tool web_ai_submit_prompt
PASS commands.md lists MCP tool web_ai_wait_response
PASS commands.md lists MCP tool web_ai_copy_markdown
PASS commands.md lists MCP tool web_ai_doctor
PASS commands.md lists MCP tool web_ai_session_resume
PASS package.json has test
PASS release_gates.md mentions test
PASS package.json has test:unit
PASS release_gates.md mentions test:unit
PASS package.json has test:integration
PASS release_gates.md mentions test:integration
PASS package.json has test:eval
PASS release_gates.md mentions test:eval
PASS package.json has test:contract-drift
PASS release_gates.md mentions test:contract-drift
PASS package.json has test:trace-policy
PASS release_gates.md mentions test:trace-policy
PASS package.json has test:mcp
PASS release_gates.md mentions test:mcp
PASS package.json has test:source-audit
PASS release_gates.md mentions test:source-audit
PASS package.json has test:release-gates
PASS release_gates.md mentions test:release-gates
PASS package.json has benchmark:trajectory
PASS release_gates.md mentions benchmark:trajectory
PASS package.json has release
PASS release_gates.md mentions release
PASS package.json has release:preview
PASS release_gates.md mentions release:preview
PASS package files include structure/
PASS package files include docs/
PASS package files include benchmarks/
PASS README links structure/INDEX.md
PASS README includes Ready surfaces
PASS README includes Beta surfaces
PASS README includes Experimental or deferred surfaces
PASS production-readiness.md labels ready surfaces
PASS production-readiness.md labels beta surfaces
PASS comparison.md has comparison rules
PASS benchmarks.md has claim boundary
PASS INDEX links str_func.md
PASS INDEX links commands.md
PASS INDEX links runtime_contracts.md
PASS INDEX links release_gates.md
PASS INDEX links phase_status.md
PASS INDEX links check-doc-drift.sh
PASS INDEX links verify-counts.sh
PASS phase_status.md tracks 18 MCP/AI SDK
PASS phase_status.md tracks 19 remote CDP adapters
PASS phase_status.md tracks 20 benchmark trajectory
PASS phase_status.md tracks 21 release gates
PASS phase_status.md blocks No stealth
PASS phase_status.md blocks No leaderboard score
PASS phase_status.md blocks No production MCP claim beyond
PASS runtime_contracts.md links 13_phase12_trace_replay.md
PASS runtime_contracts.md links 14_phase13_safety_policy.md
PASS runtime_contracts.md links 15_phase14_active_command_ownership.md
PASS runtime_contracts.md links 18_phase17_provider_contracts_source_audit.md
PASS runtime_contracts.md links 19_phase18_mcp_ai_sdk_hardening.md
PASS runtime_contracts.md links 22_phase21_release_gates.md

2 drift check(s) failed; 162 passed.

**Result: 162 passed, 2 failed (both Worker G scope)**
- `skills/browser/browser.mjs`: missing positive tokens `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600` (Worker G must add tier timeouts to help text)
- `README.md:719`: stale `Pro Extended` (Worker G must update)

### 2. `git diff --check`
**Result: PASS (clean, no whitespace issues)**

### 3. EN/KO release-gates mirror
PASS release-gates EN/KO semantic contract mirror
**Result: PASS**

### 4. `npm run gate:truth-table-fresh`

> agbrowse@0.1.16 gate:truth-table-fresh
> node scripts/release-gates.mjs truth-table-fresh

[PASS] gate:truth-table-fresh — CAPABILITY_TRUTH_TABLE.md edited within 7 days OR matches code refs
        truth table 0.01d old

All 1 gate(s) passed.
**Result: PASS (0.01d old)**

### 5. Static rg — canonical tokens in structure files
structure/INDEX.md:1
structure/check-doc-drift.sh:4
structure/phase_status.md:1
structure/commands.md:7
structure/runtime_contracts.md:2
structure/release_gates.md:2
structure/CAPABILITY_TRUTH_TABLE.md:1
**Result: All 7 structure files contain canonical tokens**

### 6. 3-Tier Token Judgment Demonstration
=== TIER 1: DENY (stale tokens in current docs) ===
  DENY: "Pro Extended" at line 1 — would FAIL in current docs
  DENY: "Pro Standard" at line 2 — would FAIL in current docs
  DENY: "model-switcher-gpt-5-5" at line 3 — would FAIL in current docs
  DENY: "--effort standard" at line 4 — would FAIL in current docs
  DENY: "--effort light" at line 5 — would FAIL in current docs
  DENY: "--effort extended" at line 6 — would FAIL in current docs
  DENY: "--effort heavy" at line 7 — would FAIL in current docs
  DENY: "--timeout 1800" at line 8 — would FAIL in current docs
  DENY: "composer-intelligence-pro-thinking-effort-trigger" at line 9 — would FAIL in current docs
  Structure files owned by 09: CLEAN (0 denials)

=== TIER 2: ALLOW-WITH-CONTEXT (stale tokens in legacy/DR context) ===
  SKILL.md --timeout 1800: ALLOWED (--research deep within 240 chars)
  SKILL.md Legacy UI section exists: old labels ALLOWED in context

=== TIER 3: REQUIRE (canonical tokens must be present) ===
  browser.mjs surface flag: PRESENT
  browser.mjs family flag: PRESENT
  browser.mjs first canonical family: PRESENT
  browser.mjs canonical effort: PRESENT
  browser.mjs Pro tier timeout: MISSING (Worker G must add)
  browser.mjs Grok Heavy tier timeout: MISSING (Worker G must add)
  browser.mjs Deep Research tier timeout: MISSING (Worker G must add)

=== SUMMARY ===
Tier 1 DENY: 9 known-stale tokens blocked in 20 scanned doc files
Tier 2 ALLOW: Legacy UI section, legacy/compatibility lines, --research deep context
Tier 3 REQUIRE: 7 positive tokens enforced in skills/browser/browser.mjs
My structure files: all clean (0 stale tokens, all canonical tokens present)
Worker G files: 2 expected failures (browser.mjs missing tier timeouts, README.md Pro Extended)

## 3-Tier Token Judgment Implementation

| Tier | Action | Tokens | Allowlist |
| --- | --- | --- | --- |
| 1 DENY | Block stale tokens in 20 scanned doc files | `Pro Extended`, `Pro Standard`, `Pro 확장`, `model-switcher-gpt-5-5`, `model-switcher-dropdown-button`, `composer-intelligence-pro-thinking-effort-trigger`, `Pro: standard/extended`, `Thinking: light/standard/extended/heavy`, `--effort light/standard/extended/heavy`, `--timeout 1800` | None unless Tier 2 applies |
| 2 ALLOW | Context-scoped exceptions | `--effort *` on legacy/compatibility lines; `--timeout 1800` within 240 chars of `--research deep` in SKILL.md/README; old labels inside `### Legacy UI (before 2026-07-10)` sections | `isAllowedStaleOccurrence()` + `isLegacyUiOccurrence()` |
| 3 REQUIRE | Positive canonical tokens must exist | `--surface <chat>`, `--family <alias>`, `gpt-5.6-sol`, `Thinking canonical: medium/high/xhigh`, `chatgpt-pro=5400`, `grok-heavy=3600`, `deep-research=3600` | Only checked in `skills/browser/browser.mjs` via `requiredSemanticTokensByFile` Map |

## Deviations from Plan 09

1. `docs/index.html` excluded from `semanticContractFiles` — file was deleted by another worker. Added `.filter(f => fs.existsSync(f))` so missing files don't crash the gate.
2. `commands.md` reference to `--timeout 1800` as negative example rephrased to "옛 1800/2400초 timeout 상수" to avoid triggering the gate (plan rule 6 only allows the literal in SKILL/README near `--research deep`).

## Judgment

All 9 files modified per plan. No new package scripts created (gate runs inside existing `check-doc-drift.sh` pipeline per plan §4.1 rule 1). The 2 remaining gate failures are in Worker G's files and will resolve when Worker G completes their docs updates. The semantic gate correctly judges old tokens (Pro Extended, extended-as-public-effort, pro=3600) as stale and new tokens (chatgpt-pro=5400, work send, power 1..6) as canonical.
