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

## 105.4 — Model-tier → timeout numeric table (agbrowse → cli-jaw) · **Pass 3**

agbrowse derives the session deadline from a **model-tier table**; cli-jaw has **no tier scaling** — flat per-vendor literals. So a ChatGPT **pro / deep-research** run gets cli-jaw's default **1200s** instead of agbrowse's **3600s** → it times out at 20 min where agbrowse waits 60.

- agbrowse `session.mjs`: `TIER_DEFAULT_TIMEOUT_SEC = {instant, thinking:600, pro:3600, 'deep-research':3600}` (:394) + `VENDOR_DEFAULT_TIMEOUT_SEC` + `tierDefaultTimeoutSec()` (:411) + `resolveTimeoutDefaultSec()` / `deriveTimeoutTier()`.
- cli-jaw: those symbols **absent** (`grep`=0); deadline = inline `Number(input.timeout||1200)` (chatgpt.ts:478/662/671/715), `||600` (grok-live.ts:207), `||1200` (gemini-live.ts:517).
- **Pri: P1** — a real early-timeout bug for long ChatGPT runs, not a missing nicety. Verified by grep.

## 105.5 — Persisted session streaming-progress fields (agbrowse → cli-jaw) · **Pass 3**

Beyond `modelSelection` ([104.5](104_webai_shared_module_divergences.md)), agbrowse seeds + `updateSession()`-persists 5 progress fields cli-jaw's `StoredSession` never carries: `envelopeSummary`, `lastDomHash`, `lastAxHash`, `lastStreamingState`, `lastResponseCharCount`.

- agbrowse: seeded `session.mjs:204-212`, persisted live `watcher.mjs:257-266`.
- cli-jaw: `StoredSession` (session-store.ts:15) lacks all 5 (`grep`=0 under web-ai).
- **Pri: P2** — enables cross-process resume / progress display; ties to the watcher-lock gap ([104.3](104_webai_shared_module_divergences.md)) + streaming-recovery ([101 #9](101_webai_stability_patches.md)).

## 105.6 — retryHint vocabulary (agbrowse → cli-jaw, + small reverse) · **Pass 3**

Distinct from [105.1](#1051--error-code-taxonomy-agbrowse--cli-jaw)'s *error-code* taxonomy: the `retryHint` recovery-instruction set is also unsynchronized. agbrowse emits **34** distinct values, cli-jaw **22** (verified by grep).

- **agbrowse-only (~20)** e.g. `pass-session-or-navigate`, `watch-or-poll`, `reduce-files`, `re-upload`, `reuse-existing-watcher-or-remove-stale-lock`, `policy` — most map to module gaps in 102/104.
- **cli-jaw-only (~8)** e.g. `feature-fallback`, `reset-cache`, `wait-and-retry`, `retry-or-skip-visual` (200-dir, minor).
- **Pri: P3** — adopt hints alongside their owning module ports; like 105.1, a checklist not a module.

## Notes
- 105.1 and 105.2 are **derivative aggregations** — they re-frame already-documented module gaps as contract surfaces, plus surface a few genuinely-new items (inline prompt-channel `--system`/`--context`, `cdp.headless`/`cdp.unreachable` codes). They do not invalidate any prior doc.
- **Pass 3 (105.4–105.6):** 105.4 (tier-timeout) is **NOT** derivative — a genuine early-timeout bug for long ChatGPT runs (**P1**). 105.5/105.6 are schema/vocabulary surfaces that partly map to module gaps.
- One file-coverage miss from the critic — `code-dev-context-template.ts` (cli-jaw split it out; agbrowse inlines the template in `code-dev-context.mjs`) — is noted in [201](201_webai_capability_registry_and_tools.md); near-trivial.
