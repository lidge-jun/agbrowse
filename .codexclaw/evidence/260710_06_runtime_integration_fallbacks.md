# Evidence Receipt: 06 runtime integration fallbacks

- Recorded: 2026-07-10 KST
- Task artifact: `devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md`
- Artifact SHA-256: `d3573d88239cd906484e291c3f787d512e818803e93d7f2ee8cb486c582e3968`
- Scope: documentation-only diff plan; no runtime source was modified by this task.

## 1. Focused unit tests

Command:

```bash
npx vitest run test/unit/web-ai-capability.test.mjs test/unit/web-ai-sessions-command.test.mjs
```

Result: exit `0`.

```text
Test Files  2 passed (2)
Tests       32 passed (32)
Duration    721ms
```

Judgement: PASS. The current baseline capability and sessions command suites are green.
Because this task changed only a plan document, this proves the referenced baseline tests
remain runnable; the new GPT-5.6 cases described by the plan do not exist in source yet.

## 2. Document contract checks

Commands:

```bash
test -s devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
wc -l devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
git diff --no-index --check /dev/null devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
node --input-type=module <contract-check-script>
shasum -a 256 devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
```

Result: document checks exit `0`.

```text
400 devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
{
  "required": 17,
  "missing": [],
  "presentForbidden": []
}
d3573d88239cd906484e291c3f787d512e818803e93d7f2ee8cb486c582e3968
```

The contract script required the probe Before/After, observation preset, registry,
doctor, tab-inspect, vendor contract, sessions output, both requested tests, the four
evidence fields, retained `resolved` output, and legacy fallback. It rejected stale
`input.tier` and `normalizeChatGptSelectionRequest` wording.

Judgement: PASS. The requested plan artifact is non-empty, exactly 400 lines,
whitespace-clean, and contains every required diff-level section.

## 3. Repository-wide check-JS typecheck

Command:

```bash
npm run typecheck:checkjs-dom
```

Result: exit `2`, `124` TypeScript errors across `26` files.

Representative output:

```text
skills/browser/adaptive-fetch/browser-session.mjs(61,15): error TS7034
skills/browser/adaptive-fetch/candidate-discovery.mjs(122,99): error TS2345
skills/browser/adaptive-fetch/defuddle-extractor.mjs(111,30): error TS7006
web-ai/chatgpt-deep-research-report.mjs(58,20): error TS7006
web-ai/chatgpt-deep-research.mjs(376,84): error TS18047
web-ai/chatgpt-model.mjs(202,57): error TS2345
```

Judgement: NOT GREEN at repository scope. The failing paths are existing JS sources;
the only task artifact is Markdown and no reported error points to it. Source fixes are
outside the user's plan-only scope, so this receipt records the failure without modifying
those files or claiming the repository-wide gate passed.

## Overall judgement

The documentation deliverable is verified for its requested scope: focused baseline
tests pass and all plan-contract checks pass. The repository-wide check-JS gate remains
red for pre-existing source errors and must not be represented as successful.
