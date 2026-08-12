# 000 — Oracle Chase Round 3: Delta Triage Plan

Date: 2026-07-24
Status: P (plan)
Parent: devlog/00_index.md
Prior anchor unit: devlog/_fin/260712_oracle_chase/ (anchor `1146107`, 2026-07-11)
Upstream clone: /tmp/oracle-chase-260724 (steipete/oracle)
Session: 019f8ff2-0c09-7f41-8fe2-b80a6f731521
Goalplan: .codexclaw/goalplans/agbrowse-oracle-chase-round-3-track-and-close-th/

## Anchor Update

| Field | Previous (2026-07-12) | Current (2026-07-24) |
| --- | --- | --- |
| Oracle head SHA | `114610762975ca96136e92387c31fd875c6b03a2` | `6009d4ad` (chore(changelog): open 0.16.2) |
| Releases in delta | none (0.15.1 unreleased cycle) | v0.15.1, v0.15.2, v0.16.0, v0.16.1 all cut |
| Commit count | — | 63 (54 non-merge) |
| src churn | — | 29 files, +1420/−274 |

## Theme Groups (delta `1146107..6009d4ad`)

| # | Theme | Upstream commits/PRs | Oracle files | Likely agbrowse surface |
| --- | --- | --- | --- | --- |
| T1 | Terminal completion gate round-3 (scoped terminal evidence, weak-evidence aging, completion-control binding, live-progress veto scoping, completed-reasoning recognition) | PR #301 series: `9f6703bf`,`1e2f71a0`,`0071c547`,`ded58d44`,`93ccb79d`,`86d1fb2b`,`9454ef4d`,`a84f52e3`,`67da293a`,`7b107769`,`57d4a7af` | `assistantResponse.ts`, `thinkingStatus.ts`, `thinkingTime.ts` | `web-ai/chatgpt.mjs` (isStreaming/isFinalAnswer), `chatgpt-response-observer.mjs`, `chatgpt-response-dom.mjs` |
| T2 | Cloudflare false-positive gating (hydration grace window, generic challenge copy gating, Work-UI false flag) | PR #308: `4bfe3c04`,`66588753`,`46512488` | `navigation.ts`, `constants.ts` | `web-ai/interstitial.mjs` |
| T3 | GPT-5.6 Sol browser-side support (aliases, Sol≠Pro separation, safe Sol limits) + unified effort picker | PR #314 browser side: `f2f4a6c3`,`52649bad`,`89c344c4`; PR #304: `220fbd18` (touches `thinkingTime.ts` too). API-routing commit `a6138173` (`oracle/config.ts`, `geminiModels.ts`, CLI routes) is **Not-applicable** — agbrowse has no API-model routing (audit blocker #3) | `modelSelection.ts`, `thinkingTime.ts` | `web-ai/chatgpt-model.mjs` (already has gpt-5.6-sol family — verify parity) |
| T4 | ChatGPT Work session normalization (Work→Chat normalize, title-safe detection, fail-closed ambiguous) | PR #316: `80ebcf86`,`eb22ee25`,`77c0b197` | `navigation.ts`, `index.ts` | `web-ai/chatgpt-work-picker.mjs`, `product-surfaces.mjs` |
| T5 | Deep Research tool-call wrapper reattach recovery | PR #300: `e7526efa`,`9851d608`,`ccd582bc` | `src/cli/sessionDisplay.ts` (corrected per audit blocker #4 — not `sessionRunner.ts`) | `web-ai/chatgpt-deep-research.mjs`, `watcher.mjs` |
| T6 | Durable conversation-URL reattach gating (ignore transient URLs, reject non-path hints) | `2157ab73`,`aa4e0f75`,`7936b6e5` | `conversationUrl.ts`, `conversationUrlMonitor.ts`, `reattachHelpers.ts` | `web-ai/tab-recovery.mjs`, `session-store.mjs` (isSafeChatGptConversationUrl lineage) |
| T7 | Recoverable CDP disconnect answer recovery | PR #327: `28c584db` (`cdpLiveness.ts` NEW) | `cdpLiveness.ts`, `index.ts`, `chromeLifecycle.ts` | `web-ai/watcher.mjs`, `tab-recovery.mjs`, `browser-primitives.mjs` |
| T8 | Serve-owned tab lifecycle (close completed serve-owned tabs) | PR #328: `653c621b` | `tabLeaseRegistry.ts`, `liveTabs.ts` | `web-ai/tab-pool.mjs`, `tab-lease-store.mjs` |
| T9 | Stop-control composer scoping (aria-label stop fallback scoped to composer form) | PR #309: `99b30cfa` | `assistantResponse.ts` | `web-ai/chatgpt.mjs` stop/streaming detection |
| T10 | Tab-concurrency env override (`ORACLE_BROWSER_MAX_CONCURRENT_TABS` + malformed-value rejection) | PR #299: `3fbf0b51`,`e0c42f16`,`a1aa4328` | `config.ts`, `browserConfig.ts` | `web-ai/tab-pool.mjs`, config surface |
| T11 | CLI browser-effort preservation (`current` model ignores inherited effort) | PR #323: `e827942f` | `options.ts`, `runOptions.ts`, `browserDefaults.ts` | `web-ai/chatgpt-model.mjs` effort handling, `cli.mjs` |
| T12 | Non-behavioral (explicit list, audit blocker #1): docs/changelog/credit `ca03f2cb`,`3e772498`,`b832f08c`,`294f562a`,`881b03f3`,`55b52f98`,`739d0be2`,`858f8054`,`73745769`; release chores `54acb79d`,`ec2e99bf`,`2cb93e2d`,`6009d4ad`; test-only `b0295091`,`48ce0780`,`7936b6e5`(covered under T6 tests),`e0c42f16`(covered under T10 tests); CI dep `f1334797`; dependency-only security patches `ffb058a2`(protobufjs DoS),`5daa6ce8`(Hono) — Oracle-runtime deps, no agbrowse equivalent | — | Not applicable |

## Method

1. WP1 (this unit, docs-only): per-theme research docs `001`–`00x` (grouped, not one per commit), gap matrix `040_gap_matrix.md`, source verification `050_source_verification.md` with `path:line` anchors read from the CURRENT agbrowse tree (prior-run lesson: never mark a gap without re-reading local source). Decade docs `010+` only for gaps selected for implementation, written to diff-level (DIFFLEVEL-ROADMAP-01).
2. Sol subagents: A-gate reviewer + source-verification lanes.
3. WP2+: one PABCD cycle per decade doc; atomic commits on local `dev`; no push without approval.

## IN / OUT

- IN: web-ai/*.mjs behavioral parity where architecture matches; devlog + structure doc sync.
- OUT: remote push; Oracle-side changes; features tied to Oracle-only architecture (bridge mode, API-model routing) → Not-applicable with rationale; unrelated dirty files (PR #86 goalplan artifacts).

## Accept criteria (WP1)

## Document index (WP1 B)

| Doc | Content | Status |
| --- | --- | --- |
| [000_plan.md](000_plan.md) | Triage plan + audit round 1 | done |
| [001_terminal_gate_round3.md](001_terminal_gate_round3.md) | T1+T9 terminal gate / stop scoping research | done |
| [002_cloudflare_work_sessions.md](002_cloudflare_work_sessions.md) | T2+T4 Cloudflare gating / Work sessions research | done |
| [003_gpt56_sol_effort.md](003_gpt56_sol_effort.md) | T3+T11 Sol model / effort research | done |
| [004_reattach_recovery.md](004_reattach_recovery.md) | T5+T6+T7 reattach / durable URL / CDP recovery research | done |
| [005_tab_lifecycle_concurrency.md](005_tab_lifecycle_concurrency.md) | T8+T10 tab lifecycle / concurrency research | done |
| [040_gap_matrix.md](040_gap_matrix.md) | G1-G34 matrix + implementation phase map | done |
| 010/020/030/060/070/080/090 | Diff-level implementation decade docs (WP2-WP8) | in progress |

## Audit round 1 (2026-07-24, Sol reviewer "Dirac")

VERDICT: GO-WITH-FIXES (blockers=4) — all folded back above:

1. High — T12 "rest" violated explicit-list gate → explicit commit list written into T12 row.
2. Medium — `220fbd18` touches `thinkingTime.ts` (T3, not T1) → T3 oracle-files column corrected.
3. Medium — `a6138173` is API-routing (out of scope) mixed into T3 → split out as Not-applicable inside T3 row.
4. Low — T5 upstream files are `sessionDisplay.ts`, not `sessionRunner.ts` → corrected.

Reviewer spot-checks passed: T1→`chatgpt.mjs:909-951`, T2→`interstitial.mjs:4-64`, T6→`tab-recovery.mjs:334-377`, T8 agbrowse-relevant via `tab-pool.mjs:51-54`/`tab-lease-store.mjs:316-359`.

- Every non-merge behavioral commit in the delta appears in exactly one theme (T1–T11) or is explicitly listed as non-behavioral (T12).
- Every T1–T11 row in `040_gap_matrix.md` carries a Covered/Gap/Not-applicable classification with a fresh `path:line` anchor from the current tree.
- Each Gap selected for implementation has a diff-level decade doc.
- Goalplan `workPhases[]` refined 1:1 onto decade docs at D.
