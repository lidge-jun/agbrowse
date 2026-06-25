# 105 — Systemic Parity Surfaces (cross-cutting)

Date: 2026-06-25 · Parent: [100](100_agbrowse_to_clijaw_overview.md) · **Convergence Pass 2**
Source: agbrowse `web-ai/*.mjs` + `web-ai/cli.mjs` · Target: cli-jaw `src/browser/web-ai/*.ts` + `bin/commands/browser-web-ai.ts`

Pass 2's completeness-critic lens found two **cross-cutting** parity surfaces the per-module analysis (101/102/104) structurally missed — they are not single modules but *vocabularies* spanning many modules. Both verified by direct count (correcting the agent's raw deltas).

## 105.1 — Error-code taxonomy (agbrowse → cli-jaw)

agbrowse emits a far richer typed `errorCode` vocabulary than cli-jaw. Verified by `grep -rhoE "(errorCode|code):\s*'…\.…'"` deduped per repo:

- **agbrowse: 33 dotted codes · cli-jaw: 15 · agbrowse-only: 21** (reverse: cli-jaw has 2 agbrowse lacks — see below).

**Genuine web-ai codes agbrowse has, cli-jaw lacks** (excluding the 8 eval/schema-validator codes `eval.*`/`schema.malformed`/`enum.mismatch`/`type.mismatch`/`value.missing`/`required.missing`, which are agbrowse-only infra → OOS):

| errorCode | maps to documented gap | cli-jaw status |
| --- | --- | --- |
| `provider.attachment-evidence-missing`, `provider.attachment-preflight` | [104.13](104_webai_shared_module_divergences.md) attachment filename-verify | absent |
| `provider.composer-not-visible`, `provider.commit-not-verified` | [104.12](104_webai_shared_module_divergences.md) composer resolved-targets | absent |
| `provider.image-output` | [102](102_webai_remaining_modules.md) generated-image capture | absent |
| `context.over-budget`, `context.symlink-rejected` | [104.15](104_webai_shared_module_divergences.md) `wrapError` / context-pack | plain `Error` |
| `tab.target-lost` | [102](102_webai_remaining_modules.md) tab-inspect / [101](101_webai_stability_patches.md) tab-recovery | absent |
| `cdp.headless`, `cdp.unreachable` | [102](102_webai_remaining_modules.md) navigation-ready driveability | absent |
| `watcher.already-running`, `watcher.session-missing`, `watcher.vendor-mismatch` | [104.3](104_webai_shared_module_divergences.md) watcher cross-process lock | absent |

**Takeaway:** most agbrowse-only codes are *symptoms* of module gaps already in 102/104 — but the **typed-code vocabulary itself is an untracked contract surface**. When cli-jaw ports those modules it must also adopt the codes (callers/`retryHint` switch on them). This is a checklist, not a new module.

**Reverse (200-dir, cli-jaw → agbrowse):** cli-jaw has `provider.interstitial` (feeds the [201](201_webai_capability_registry_and_tools.md) interstitial detector) and `screenshot.capture-failed` that agbrowse lacks — minor, already implied by 201.

## 105.2 — CLI flag-surface delta (agbrowse → cli-jaw)

agbrowse `web-ai/cli.mjs` exposes **73** distinct `--flags`; cli-jaw `bin/commands/browser-web-ai.ts` exposes **37** (all 37 ⊂ agbrowse). **36 agbrowse-only.** (The agent's "~37 non-infra" overcounted — ~15 of the 36 are eval/policy/trace/snapshot OOS.)

**Genuine in-scope flags cli-jaw's command lacks (~21):**

- **Prompt-channel (security-relevant):** `--system` (trusted instructions), `--context` (UNTRUSTED inline data), `--goal`, `--project`, `--constraints`, `--question`. cli-jaw takes context only from files (`--context-file`/`--context-from-files`), **not** agbrowse's trusted-vs-untrusted *inline* channel split — a real prompt-injection-safety surface gap.
- **Core behavior:** `--web-search`, `--output-image` (→ generated-image capture, [102](102_webai_remaining_modules.md)), `--poll-timeout`, `--context-refresh`, `--files-report` (→ [chatgpt-files](101_webai_stability_patches.md)), `--older-than`, `--output`, `--target`, `--chatgpt-url`.
- **Size limits:** `--max-file-size`, `--max-input`, `--max-upload-file-size`, `--max-context-file-size`.
- **Browser mode:** `--headed`, `--interactive`.

**OOS (~15, agbrowse-only infra — do NOT port):** `--snapshot`, `--fixtures`, `--update-golden`, `--variant`, `--concurrency`, `--limit`, `--config`, `--dry-run` (eval runner); `--policy`, `--plugin`, `--unsafe-allow` (policy engine); `--trace-dir` (trace); `--compact`, `--status`, `--interval` (status display).

**Takeaway:** the prompt-channel flags (`--system`/`--context`/`--goal`/`--project`/`--constraints`) are the headline — they encode agbrowse's trusted/untrusted prompt model. The core-behavior + size-limit flags map to already-documented module gaps. Per 00_plan Phase 4, CLI wiring follows the module ports (flags are the surface, modules are the substance).

## 105.3 — Test-coverage parity (informational, P3)

agbrowse has ~74 web-ai/chatgpt test files vs cli-jaw ~50. The agbrowse-only suites (`chatgpt-images.test`, `deep-research-resume.test`, `open-conversation-newtab.test`, `safe-conversation-url.test`) are the **test halves of the P0/P1 module ports already in 101/102** — they port *with* their modules, not separately. Tracked here only so the convergence audit accounts for the delta; not an independent gap.

## Notes
- Both 105.1 and 105.2 are **derivative aggregations** — they re-frame already-documented module gaps as contract surfaces, plus surface a few genuinely-new items (the inline prompt-channel flags `--system`/`--context`, `cdp.headless`/`cdp.unreachable` codes). They do not invalidate any prior doc.
- One file-coverage miss from the critic — `code-dev-context-template.ts` (cli-jaw split it out; agbrowse inlines the template in `code-dev-context.mjs`) — is noted in [201](201_webai_capability_registry_and_tools.md); near-trivial.
