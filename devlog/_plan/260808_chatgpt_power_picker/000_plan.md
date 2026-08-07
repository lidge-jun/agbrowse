# ChatGPT Power picker live-contract repair

## Loop spec

- Archetype: spec-satisfaction repair.
- Trigger: the 2026-08-08 Chat UI replaced the flat Intelligence menu used by the fixture with a composer Power picker shell.
- Goal: keep the public `--family`, `--model`, and `--effort` contract working against the observed shell and stop advertising retired family rows.
- Non-goals: add a new Chat `--power` flag, change Work picker semantics, change Gemini/Grok, or touch unrelated dirty files.
- Verifier: `npx vitest run test/unit/web-ai-chatgpt-model.test.mjs test/unit/web-ai-provider-dom-contract.test.mjs test/integration/web-ai-cli-contract.test.mjs test/unit/web-ai-tool-schema.test.mjs`; it directly imports the selector module and reads the changed fixture/help/schema targets. Baseline command exists; the pre-change suite is expected green because the fixture itself is stale, so the first WP1 action is a fixture-backed RED mutation.
- Full verifier: `npm run typecheck && npm test && npm run test:mcp && npm run test:release-gates && npm run gate:all && npm pack --dry-run`; all commands exist in `package.json` and the release workflow runs the same surfaces.
- Stop: DONE only after live selector activation, affected/full gates, independent audit, split commits, current-head CI, registry release, and installed-package smoke.
- Memory: this unit plus `.codexclaw/goalplans/agbrowse-chatgpt-model-picker-live-contract-repa/`.
- Terminal outcomes: DONE, NOOP, BLOCKED, UNSAFE, NEEDS_HUMAN, BUDGET_EXHAUSTED as defined in the bound goal.
- Escalation: reclaim locally after two failed delegated packets; delegate only read-only audits; stop for CAPTCHA/login/security prompts or an unrecoverable release conflict.
- HOTL bounds: local repo + Chrome + GitHub/npm; related files only; no paid API calls; three-hour wall clock; existing authenticated sessions only.

## Dependency-ordered work phases

1. `010_picker_contract.md`: fixture/test RED, selector-shell repair, public family contract correction.
2. `020_live_activation_and_qa.md`: symlinked CLI activation, live model/effort selection, complete gates, SoT sync, adversarial audit.
3. `030_release_and_deploy.md`: split closeout commit if needed, push `dev`, integrate through `main`, publish the next patch through Trusted Publishing, verify registry/install/runtime.

## Scope

IN:

- `web-ai/chatgpt-model.mjs`, `web-ai/cli.mjs`, `web-ai/tool-schema.mjs`.
- Chat fixture and exact model/CLI/schema tests.
- `skills/web-ai/SKILL.md`, bundled `skills/browser/browser.mjs` help copy, `README.md`, `structure/commands.md`, generated static docs only where the repo already tracks the same contract.
- package/release metadata required by the existing release flow.

OUT:

- `web-ai/chatgpt-work-picker.mjs` behavior and Work Power 1..6.
- other providers, uploads, response capture, session store, and unrelated QA probes.
- pre-existing `.codexclaw`, probe, and `260806_v0119-release-audit-fix` changes.

## Necessity gate

- Do nothing rejected: the live root no longer carries `composer-intelligence-picker-content`; current open detection cannot prove the shell is open.
- Delete rejected: legacy picker compatibility is still intentionally supported and has extensive regression coverage.
- Configure rejected: selectors and family enum/help are compiled source contracts.
- Reuse selected: extend existing `chatGptComposerMenuRoot`, submenu, exact-label, and checked-state owners; do not add a parallel selector module.

## Acceptance

- The fixture structurally reproduces the live portal shell: expanded composer pill, top `role=menu`, Power item + 0..4 slider, Advanced toggle, Model and Effort submenu triggers, separate family/effort radio menus.
- `instant`, `thinking` with medium/high/xhigh, and `pro` reach the Effort submenu and verify `aria-checked` plus `data-state` consistency.
- `gpt-5.6-sol`, `gpt-5.5`, and `o3` remain public family choices; retired `gpt-5.4` and `gpt-5.3` fail pre-mutation.
- Existing legacy picker fixtures/tests remain green.
- Live symlinked CLI selects at least two distinct states and restores Extra High.
- Release proof names pushed SHA, CI run, npm version/dist-tag, clean install binary version/path, smoke result, and rollback target.

## Pessimist check

The likely wrong direction is treating any open menu with a `Power` item as Chat. The surface guard and composer-controlled trigger must remain the authority; if a Work menu reaches the Chat path, the implementation is wrong even when unit tests pass.
