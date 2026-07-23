# 050 — Source Verification (Oracle Chase Round 3)

Date: 2026-07-24
Method: every Covered/Gap/Not-applicable claim in [040_gap_matrix.md](040_gap_matrix.md) was grounded by a Sol lane reading the CURRENT agbrowse tree (not memory, per prior-run lesson), and every implementation decade doc re-verified its anchors a second time before writing diffs.

## Verification lanes

| Lane | Docs | Anchor status |
| --- | --- | --- |
| Godel (T1+T9) | 001, then Hypatia for 010/020 | 001 anchors confirmed current; observer recovery range refined `122-145` → `88-145,170-180,182-189`; fake-ChatGPT fixture anchors added |
| Dalton (T2+T4) | 002, then Zeno for 060 | corrections: signals at `interstitial.mjs:78-80` (not 75-81), CF branch `:49-52`; **production-consumer check: none — only `test/unit/web-ai-interstitial.test.mjs:2` imports the module** |
| Popper (T3+T11) | 003, then Curie for 080 | corrections: `selectChatGptModel` call site is `chatgpt.mjs:309`; CLI opts `cli.mjs:609-612`, input fields `:722-724`; family import already at `cli.mjs:26` |
| James (T5+T6+T7) | 004, then McClintock for 030/070 | corrections: session create write `session.mjs:201-202`, central update `:219-226`; extra conversationUrl writers enumerated (`chatgpt-deep-research.mjs:311,335-339,432`, `chatgpt-multi-turn.mjs:209-216`, `chatgpt-work-picker.mjs:871-885`); watcher insertion `watchSessionOnce :123` |
| Descartes (T8+T10) | 005, then Curie for 090 | env reads `tab-lease-store.mjs:69-73`; pool `0`-disable semantics confirmed `:327-347,:561-566`; active `0` must fall back (`:499-523`); `AGBROWSE_PROVIDER_POOL_TTL` excluded (duration-valued) |

## Commit coverage check (WP1 accept criterion 1)

54 non-merge commits in `1146107..6009d4ad`. Behavioral commits assigned: T1 (11) + T2 (3) + T3 (4 incl. one N/A split) + T4 (3) + T5 (3) + T6 (3, `7936b6e5` test listed in both T6 and T12-tests intentionally as test-of-T6) + T7 (1) + T8 (1) + T9 (1) + T10 (3 incl. test) + T11 (1). Non-behavioral T12: 18 explicit SHAs. Audit round 1 (Sol reviewer Dirac) independently confirmed: "No behavioral commit was otherwise unassigned or duplicated among T1–T11."

## Test-runner correction

Repo gate is Vitest (`npm run test:unit`, `npx vitest run <file>`), not `node --test`. All decade-doc test plans were written/corrected against the Vitest convention.
