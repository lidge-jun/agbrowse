# Evidence Receipt: 03 Chat Picker Selector Patch Plan

- Date: 2026-07-10 KST
- Deliverable: `devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md`
- Scope: documentation-only diff-level patch plan; production source and tests were not modified.

## Checks Run

### Target existence and size

```text
command: test -f devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md && wc -l devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
exit: 0
output: 942 devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
```

### Before/After coverage

```text
command: awk '/^#### Before/{before++} /^#### After/{after++} END{print "before=" before, "after=" after; exit(before != 10 || after != 10)}' devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
exit: 0
output: before=10 after=10
```

Judgement: all ten source-diff subsections have paired Before and After blocks.

### Markdown code fences

```text
command: awk '/^```/{count++} END{print "code_fences=" count; exit(count % 2)}' devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
exit: 0
output: code_fences=44
```

Judgement: all fenced blocks are balanced.

### Trailing whitespace

```text
command: awk '/[ \t]+$/ {print NR ": trailing whitespace"; bad=1} END{if (!bad) print "trailing_whitespace=0"; exit bad}' devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
exit: 0
output: trailing_whitespace=0
```

### Required source symbols and policy sections

```text
command: rg -n '^### 3\.[1-9]|^### 3\.10|CHATGPT_MODEL_TEXT_BUTTON_PATTERN|CHATGPT_OBSERVED_PRO_PILL_LABELS|CHATGPT_MODEL_OPTIONS|CHATGPT_MODEL_EFFORT_OPTIONS|CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS|openSimplifiedIntelligenceSubmenu|requiredEffortMenuLabels|isModelMenuOpen|한국어 UI는|추가/교체 테스트 목록' devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
exit: 0
key output:
  64: section 3.1 trigger/pill patterns
  105: section 3.2 CHATGPT_MODEL_OPTIONS
  142: section 3.3 CHATGPT_MODEL_EFFORT_OPTIONS
  195: section 3.4 simplified mapping
  363: section 3.6 openSimplifiedIntelligenceSubmenu
  509: section 3.8 requiredEffortMenuLabels
  565: section 3.9 isModelMenuOpen
  659: section 3.10 label normalization/regex
  803: Korean UI unmeasured policy
  843: GPT-5.6 test case list
```

### Referenced source files

```text
command: test -f for each required reference path
exit: 0
output:
  exists: devlog/_plan/260710_gpt56_update/00_index.md
  exists: devlog/_plan/260710_gpt56_update/01_ui_contract_evidence.md
  exists: devlog/_plan/260710_gpt56_update/02_core_contract_decisions.md
  exists: web-ai/chatgpt-model.mjs
  exists: test/unit/web-ai-chatgpt-model.test.mjs
```

### Git scope

```text
command: git status --short -- devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
exit: 0
output: ?? devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
```

## Final Judgement

PASS. The requested patch-plan document exists and contains paired diff-level coverage for all named selector/label breakpoints, the GPT-5.6 family/tier contract, legacy Korean preservation policy, and the unit-test case matrix. Structural documentation checks all exited 0. Build and runtime tests were not run because this task modifies no executable source or test file; their future implementation commands and acceptance criteria are recorded in the deliverable's verification section.
