# C-gate canonical repair evidence: 07 / 09

- Date: 2026-07-10 (Asia/Seoul)
- Scope: `devlog/_plan/260710_gpt56_update/07_tests_fixtures.md`, `devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md`
- Evidence receipt: this file was added only because the completion hook explicitly required a receipt under `.codexclaw/evidence/`.
- Canon: `.codexclaw/evidence/260710_cgate_r1_synthesis.md`
- Contract owner: `devlog/_plan/260710_gpt56_update/02_core_contract_decisions.md`

## Repair judgement

PASS. The two plan files now agree with the C-gate canon:

1. 07 uses the three-state `chat|work|ambiguous` discriminator contract, with no-toggle as the legacy path. Work and ambiguous failures use stage `provider-surface-preflight` and retry `switch-to-chat`; stale names `provider-select-mode` and `switch-to-chat-surface` are absent.
2. 07's Chat fixture family submenu is exactly `gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3`; Terra/Luna are absent from the Chat fixture block and present in the Work fixture block.
3. 09 uses the same five family aliases and points effort canonical/legacy normalization ownership to 02.
4. 09's semantic gate scans `skills/browser/browser.mjs`, rejects the old split help strings and Pro `--timeout 1800`, and positively requires current surface/family/effort/timeout markers.
5. Before citations match repository `HEAD` verbatim: 4 checked blocks in 07 and 10 checked blocks in 09.

## Fresh verification

Command: a read-only Node contract checker over the two plan files plus `git show HEAD:<source>` for Before citation comparison.

```text
PASS canonical surface stage/retry and chat|work|ambiguous + legacy matrix
PASS Chat family exact set: gpt-5.6-sol|gpt-5.5|gpt-5.4|gpt-5.3|o3
PASS Terra/Luna absent from Chat fixture and present only in Work fixture block
PASS 09 root-help stale-token and required-current-token semantic coverage
PASS 09 semantic-gate After JavaScript syntax
PASS Before verbatim matches: 07=4, 09=10
PASS Markdown fences, trailing whitespace, and final newlines
```

Exit code: `0`.

## Repair locations

### 07_tests_fixtures.md

- Surface discriminator and canonical error contract: lines 66-69.
- Chat family exact-set and Terra/Luna absence assertions: lines 376-381.
- Work-only model submenu assertion: lines 569-572.
- Verbatim Before blocks: lines 636-675 and 767-801.
- Work/ambiguous guard and regression matrix: lines 692-698, 915-929, 990.

### 09_structure_sot_gates.md

- Five family aliases and 02-owned effort normalization: lines 60-69, 180-182.
- Root CLI help inclusion and synchronization ownership: lines 78-80, 292, 305-307.
- Root-help stale and required-current semantic checks: lines 320-322, 354, 379-397, 446-455.
- Acceptance/static audit/closeout coverage: lines 472, 592, 649, 671-672.

