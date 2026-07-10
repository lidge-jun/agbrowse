# Evidence Receipt — 09 structure SoT/semantic gate diff plan

- Recorded: 2026-07-10 12:21:50 KST
- Deliverable: `devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md`
- Scope: verify the diff-level plan, its embedded semantic gate, and the requested closeout procedure.

## 1. Write-scope status

Command:

```bash
git status --short -- \
  devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md \
  structure/CAPABILITY_TRUTH_TABLE.md \
  structure/phase_status.md \
  structure/commands.md \
  structure/runtime_contracts.md \
  structure/INDEX.md \
  structure/check-doc-drift.sh \
  structure/release_gates.md \
  docs/dev/reference/release-gates.html \
  docs/dev/ko/reference/release-gates.html
```

Output (exit 0):

```text
 M structure/CAPABILITY_TRUTH_TABLE.md
 M structure/commands.md
?? devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md
```

Judgement: PASS with pre-existing-worktree note. The deliverable is present as a new
file. `structure/CAPABILITY_TRUTH_TABLE.md` and `structure/commands.md` were already
modified in the task-start status snapshot and were not written during this task. The
other seven planned source targets remain clean. This evidence receipt is the only
additional file required by the stop hook.

## 2. Plan shape and section coverage

Commands:

```bash
wc -l devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md
rg -c '^#### Before' devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md
rg -c '^#### After' devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md
rg -n '^## (2\. 변경 파일 지도|3\. structure SoT Before/After|4\. semantic doc-contract gate|5\. release gate와 EN/KO 레퍼런스|6\. 검증 명령|7\. 01~09 유닛 closeout)' \
  devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md
```

Output (all exit 0):

```text
654 devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md
12
12
87:## 2. 변경 파일 지도
104:## 3. structure SoT Before/After
291:## 4. semantic doc-contract gate
448:## 5. release gate와 EN/KO 레퍼런스
518:## 6. 검증 명령
579:## 7. 01~09 유닛 closeout과 `_fin` 이동 조건
```

Judgement: PASS. All requested top-level sections are present. Every Before block has
a matching After block, including the five structure SoTs, drift script, release gate,
and EN/KO HTML mirror changes.

## 3. Markdown whitespace and fence integrity

Command:

```bash
awk '/[ \t]+$/{print "FAIL trailing whitespace line " NR; bad=1} /^```/{fences++} END{if(fences%2){print "FAIL odd code fences: " fences; bad=1} if(!bad) print "PASS no trailing whitespace; balanced code fences=" fences; exit bad}' \
  devlog/_plan/260710_gpt56_update/09_structure_sot_gates.md
```

Output (exit 0):

```text
PASS no trailing whitespace; balanced code fences=64
```

Judgement: PASS. The plan has no trailing whitespace and all fenced examples close.

## 4. Embedded semantic-gate syntax

Command: extract the JavaScript block under `### 4.3 structure/check-doc-drift.sh
After` and parse it with `new Function(...)`.

Output (exit 0):

```text
PASS embedded check-doc-drift JS diff parses
```

Judgement: PASS. The proposed CommonJS-heredoc insertion is syntactically valid
JavaScript.

## 5. Semantic allow/deny behavior

Command: execute the extracted gate block with an in-memory `read/pass/fail` harness.
The allowed fixture contains the exact legacy UI marker, a compatibility effort row,
and a `--research deep` timeout. The denied fixture places `--effort standard` in a
current developer-doc example and `--timeout 1800` in a Pro recommendation.

Output (exit 0):

```text
PASS semantic allowlist cases=2 documents
PASS semantic denylist violations=2 with line evidence
```

Judgement: PASS. Explicit legacy/Deep Research contexts are accepted; current stale
effort/Pro timeout contexts fail and report line evidence.

## 6. False-green baseline reproduction

Commands:

```bash
bash structure/check-doc-drift.sh
npm run gate:truth-table-fresh
rg -n --glob '!devlog/**' --glob '!test/**' -- \
  'Pro Extended|Pro Standard|Pro 확장|model-switcher-gpt-5-5|model-switcher-dropdown-button|composer-intelligence-pro-thinking-effort-trigger|--effort (light|standard|extended|heavy)|--timeout 1800' \
  structure skills/web-ai/SKILL.md README.md docs | wc -l
```

Output (all exit 0):

```text
All structure drift checks passed (144).

[PASS] gate:truth-table-fresh — CAPABILITY_TRUTH_TABLE.md edited within 7 days OR matches code refs
truth table 4.03d old
All 1 gate(s) passed.

38
```

Judgement: PASS as problem reproduction. Existing gates are green while 38 known-stale
token matches remain outside devlog/tests. This directly supports placing the scoped
semantic check inside `structure/check-doc-drift.sh` and documenting its legacy and Deep
Research exceptions.

## Final Judgement

PASS. The 09 deliverable is a complete diff-level plan with exact Before(path:line)
evidence, concrete After content, a syntactically valid and behavior-checked stale-token
gate, release-gate EN/KO updates, a final `rg` audit, and explicit `_fin` movement gates.
No source-of-truth original was written by this task.
