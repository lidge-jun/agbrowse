# 040 — Gap Matrix (Oracle Chase Round 3)

Date: 2026-07-24
Oracle anchor: `6009d4ad` (0.16.2-open). Prior anchor: `1146107` (2026-07-11).
Sources: [001](001_terminal_gate_round3.md), [002](002_cloudflare_work_sessions.md), [003](003_gpt56_sol_effort.md), [004](004_reattach_recovery.md), [005](005_tab_lifecycle_concurrency.md) — all rows source-verified against the current tree by Sol lanes with path:line anchors.

Numbering note: `040`/`050` stay reserved for this matrix and source verification (prior-unit convention, audit round 1 approved). Implementation decade docs therefore use `010, 020, 030, 060, 070, 080, 090`.

## Rows

| G | Theme | Mechanism (upstream commit) | Class | Prio | agbrowse evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | T9 | Composer-scoped stop aria fallback (`99b30cfa`) | Gap | P1 | Document-wide `button[aria-label*="Stop" i]` at `chatgpt.mjs:909-917`, `chatgpt-response-dom.mjs:9-12`, inherited by observer | **Implement — [010](010_streaming_scope_hardening.md)** |
| G2 | T1 | Live-progress veto scoped to current turn (`0071c547`) | Gap | P1 | Page-global progress locators `chatgpt.mjs:918-927` | **Implement — [010](010_streaming_scope_hardening.md)** |
| G3 | T1 | Genuine/live progress predicate — determinate `value==max` not live (`9f6703bf`) | Gap | P2 | `chatgpt.mjs:918-927` treats any visible bar as streaming | **Implement — [010](010_streaming_scope_hardening.md)** (same code site as G2) |
| G4 | T1 | Verified thinking chrome scope (`93ccb79d`) | Gap | P1 | Any right-side panel is a veto, no metadata check `chatgpt.mjs:918-963` | **Implement — [010](010_streaming_scope_hardening.md)** |
| G5 | T1 | Scoped terminal evidence only — no completion on stable text with `finished=false` (`67da293a`) | Gap | P1 | `chatgpt.mjs:624-634`, observer recovery `chatgpt-response-observer.mjs:122-145` | **Implement — [020](020_terminal_evidence_binding.md)** |
| G6 | T1 | Completion controls bound to sampled response identity (`9454ef4d`) | Gap | P1 | `isResponseFinished` has no identity binding `chatgpt.mjs:970-993` | **Implement — [020](020_terminal_evidence_binding.md)** |
| G7 | T1 | Heading-prefixed completed-reasoning grammar (`1e2f71a0`) | Gap | P2 | Over-broad `includes('thought for')` `chatgpt.mjs:939-958` | Defer — grammar refinement, revisit if false-veto observed; partially mitigated by G4 scoping |
| G8 | T1 | Strong vs weak activity strata (`ded58d44`) | Gap | P2 | Single boolean `isStreaming` `chatgpt.mjs:909-965` | Defer — G1/G2/G4 scoping removes the dominant false-veto sources first |
| G9 | T1 | Scoped busy + anchored summary grammar (`86d1fb2b`) | Gap | P2 | No busy signals used; over-broad summary exclusion | Defer — with G7 |
| G10 | T1 | Weak-evidence aging (`a84f52e3`) | Gap | P3 | Superseded upstream by `67da293a` | Defer — do not port independently (superseded) |
| G11 | T1 | Wrapperless completion correlation (`7b107769`) | Gap | P2 | Wrapper-only DOM readers `chatgpt-response-dom.mjs:3-12` | Defer — fail-open ordering is mitigated by G5/G6; monitor DOM drift |
| G12 | T1 | Completed reasoning action w/ Edit (`57d4a7af`) | Gap | P2 | No anchored grammar `chatgpt.mjs:71-88,1344-1355` | Defer — with G7 |
| G13 | T2 | App-shell veto + structured Cloudflare signals (`4bfe3c04`) | Gap | P1 | `interstitial.mjs:46-52` body-copy match before shell signals | **Implement — [060](060_interstitial_hardening.md)** |
| G14 | T2 | Weak-evidence hydration grace window (`66588753`) | Gap | P1 | Single snapshot `interstitial.mjs:75-84` | **Implement — [060](060_interstitial_hardening.md)** |
| G15 | T2 | Generic challenge copy gated by shell-less short page (`46512488`) | Gap | P1 | `interstitial.mjs:14-19,46-52` unconditional | **Implement — [060](060_interstitial_hardening.md)** |
| G16 | T4 | Work→Chat normalization on ordinary Chat path (`80ebcf86`) | Gap | P2 | Fails `switch-to-chat` instead of normalizing `chatgpt-model.mjs:490-525` | Defer — current fail-closed behavior is safe; normalization is UX, not correctness |
| G17 | T4 | Title-safe `/c/<id>` Work detection (`eb22ee25`) | Gap | P2 | No sidebar/URL probe `product-surfaces.mjs:107-158` | Defer — with G16 |
| G18 | T4 | Fail-closed ambiguous Work session (`77c0b197`) | Gap | P2 | Legacy label on absent controls `product-surfaces.mjs:112-114` | Defer — with G16; revisit as one Work-surface unit |
| G19 | T4 | Preserve intentional Work operation | Covered | P3 | `chatgpt-work-picker.mjs:234-289,1007-1045` | No action |
| G20 | T3 | Sol family reachable from CLI/send (`f2f4a6c3`) | Gap | P1 | Core support exists `chatgpt-model.mjs:109-125` but no CLI `--family` path `cli.mjs:590-654`; `chatgpt.mjs:298-310` drops family | **Implement — [080](080_sol_cli_effort.md)** |
| G21 | T3 | Sol≠Pro separation | Covered | P2 | `chatgpt-model.mjs:60-116,717-866,885-903` | No action |
| G22 | T3 | Sol/Pro final-state guard (`52649bad`) | Gap | P2 | Final verification doesn't reject Pro-conflicting state `chatgpt-model.mjs:389-415` | **Implement — [080](080_sol_cli_effort.md)** (same module as G20) |
| G23 | T3 | Oracle API Sol limits (`89c344c4`, `a6138173`) | Not-applicable | P3 | No API-model routing in agbrowse | No action (rationale: browser-only architecture) |
| G24 | T3 | Unified flat picker + effort mapping (`220fbd18`) | Covered | P2 | `chatgpt-model.mjs:92-107,165-172,643-713` | No action |
| G25 | T3 | Multilingual (zh) labels + stale-trigger refresh | Gap | P3 | en/ko only `chatgpt-model.mjs:60-107` | Defer — zh locale out of supported runtime scope |
| G26 | T11 | No implicit effort mutation on current model | Covered | P1 | `chatgpt-model.mjs:266-283`, `cli.mjs:1619-1629` | No action |
| G27 | T11 | Effort-only override with current model (`e827942f`) | Gap | P1 | CLI rejects effort without `--model` `cli.mjs:1654-1665` | **Implement — [080](080_sol_cli_effort.md)** |
| G28 | T5 | DR tool-call wrapper placeholder recognition (`e7526efa`+) | Gap | P2 | No wrapper recognition in report selection `chatgpt-deep-research.mjs:166-206,392-444` | Defer — constrained-value; revisit if wrapper captures observed in practice |
| G29 | T6 | Durable conversation-URL persistence/reattach gating (`2157ab73`,`aa4e0f75`,`7936b6e5`) | Gap | P1 | Ungated `conversationUrl` update sites `tab-recovery.mjs:67-82`, `session.mjs:184-216`, `chatgpt.mjs:419-443` | **Implement — [030](030_durable_conversation_url.md)** |
| G30 | T7 | Recoverable CDP disconnect classification + bounded answer recovery (`28c584db`) | Gap | P1 | No liveness probe / disconnect classification `tab-recovery.mjs:210-219,570-590`, `watcher.mjs:188-204` | **Implement — [070](070_cdp_disconnect_recovery.md)** |
| G31 | T8 | Serve-owned tab immediate close (`653c621b`) | Not-applicable | P3 | No per-request service-owned target policy `mcp-server.mjs:233-238,361-371` | No action (rationale: shared-page architecture; leases already bounded) |
| G32 | T8 | Completed-tab accumulation prevention | Covered | P1 | Warm pool + TTL/overflow CDP close `tab-lease-store.mjs:316-359,590-616` | No action |
| G33 | T10 | Tab-concurrency env override | Covered | P2 | `AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY`/`GLOBAL_MAX` `tab-lease-store.mjs:72-73,493-523` | No action |
| G34 | T10 | Strict positive-integer env parsing (`a1aa4328`) | Gap | P2 | Module-level `parseInt` `tab-lease-store.mjs:70-73` | **Implement — [090](090_env_parse_hardening.md)** (small) |

## Implementation phase map (locks goalplan at WP1 D)

| Decade doc | Work-phase | Gaps | Files |
| --- | --- | --- | --- |
| 010_streaming_scope_hardening.md | WP2 | G1, G2, G3, G4 | `web-ai/chatgpt.mjs` (isStreaming area), `chatgpt-response-dom.mjs`, `chatgpt-response-observer.mjs` |
| 020_terminal_evidence_binding.md | WP3 | G5, G6 | `web-ai/chatgpt.mjs` (finalize path, isResponseFinished), `chatgpt-response-observer.mjs` |
| 030_durable_conversation_url.md | WP4 | G29 | `web-ai/tab-recovery.mjs`, `session.mjs`, `chatgpt.mjs`, `session-store.mjs` |
| 060_interstitial_hardening.md | WP5 | G13, G14, G15 | `web-ai/interstitial.mjs` (+ consumer wiring check) |
| 070_cdp_disconnect_recovery.md | WP6 | G30 | `web-ai/tab-recovery.mjs`, `watcher.mjs` |
| 080_sol_cli_effort.md | WP7 | G20, G22, G27 | `web-ai/cli.mjs`, `chatgpt.mjs`, `chatgpt-model.mjs` |
| 090_env_parse_hardening.md | WP8 | G34 | `web-ai/tab-lease-store.mjs` |

Deferred: G7-G12 (terminal-gate P2 grammar/strata — dominant risk closed by WP2/WP3), G16-G18 (Work-surface unit, fail-closed today), G25 (zh locale), G28 (DR wrapper), G10 (superseded upstream). Not-applicable: G23, G31. Covered: G19, G21, G24, G26, G32, G33.

## C-phase verification notes (2026-07-24)

- Decade-doc lanes re-verified every research anchor against the current tree; corrections are recorded inside each decade doc (010/020: observer recovery range refined to `88-145,170-180,182-189`; 030: session writes enumerated incl. `chatgpt-deep-research.mjs:311,335-339,432`, `chatgpt-multi-turn.mjs:209-216`, `chatgpt-work-picker.mjs:871-885`; 070: `watchSessionOnce :123` insertion region; 080/090: CLI anchors `cli.mjs:609-612,722-724`, env reads `tab-lease-store.mjs:69-73`).
- **Material finding (G13-G15)**: `web-ai/interstitial.mjs` currently has NO production consumer — only `test/unit/web-ai-interstitial.test.mjs:2` imports it. WP5 (060) therefore hardens the detector but production wiring is explicitly OUT of that phase's scope (recorded in 060). The G13-G15 classification stays Gap because the detector is the designated future integration point.
- Test runner is **Vitest** (`npx vitest run`, `npm run test:unit`), not `node --test` — 010/020 corrected this; all decade docs' test plans use Vitest entry points.
