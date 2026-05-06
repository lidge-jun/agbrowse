---
name: web-ai
description: "Standalone agbrowse web-ai workflow for ChatGPT, Gemini, and Grok with structured prompt envelopes, file/context uploads, model selection, polling, and opt-in copy-markdown fallback."
---

# Web AI

Use this skill when an agent needs to drive AI provider websites through the
standalone `agbrowse` Chrome/CDP runtime.

## Preconditions

- Use the existing headed Chrome profile when provider login is required.
- Provider commands auto-start headed Chrome when CDP is not running. Set
  `AGBROWSE_WEB_AI_AUTO_START=0` to fail closed instead.
- Do not start a separate Chrome/profile unless the user explicitly asks for an
  isolated run.
- Prefer `agbrowse status` before mutation.
- For live provider smoke tests, pass `--url` so the runtime verifies the
  provider host before sending.

## Commands

```bash
agbrowse web-ai render
agbrowse web-ai status
agbrowse web-ai send
agbrowse web-ai poll
agbrowse web-ai query
agbrowse web-ai stop
agbrowse web-ai context-dry-run
agbrowse web-ai context-render
```

Direct script form is equivalent:

```bash
node skills/browser/browser.mjs web-ai query ...
```

## Runtime Capabilities

Use `agbrowse web-ai status --vendor <v> --json` before any mutation.
The JSON response contains `capabilities[]` rows with `capabilityId`,
`state` (`ok`/`warn`/`fail`/`unknown`), `evidence`, and `next` (retry
hint). Scope a single probe with `--probe <capabilityId>`.

Capability IDs per vendor (hyphenated, aligned with cli-jaw registry shape
but implementation details may differ per vendor):

| Capability | ChatGPT | Gemini | Grok |
| --- | :---: | :---: | :---: |
| `*-active-tab-verification` | ✓ | ✓ | ✓ |
| `*-composer-visible` | ✓ | ✓ | ✓ |
| `*-model-alias-selectable` | ✓ | ✓ | ✓ |
| `*-upload-surface-visible` | ✓ | ✓ | ✓ |
| `*-copy-button-present` | ✓ | ✓ | ✓ |
| `*-response-streaming` | ✓ | ✓ | ✓ |

Unsupported vendors or unsupported model aliases must fail before browser
mutation.

### Grok: do not use context packaging

Do not package files for Grok. The runtime still allows it for parity, but
agents must prefer inline prompts and per-call `--file <path>` uploads instead
of `--context-from-files` / `--context-file` / `--context-transport upload`
when `--vendor grok`.

Why: Grok's web composer attachment surface is less predictable than ChatGPT
and Gemini, the package upload path frequently degrades response quality, and
Grok already accepts long inline prompts well. Use ChatGPT or Gemini when the
prompt genuinely needs a packaged context bundle.

Grok context packages fail closed by default. If `web-ai send/query --vendor grok`
is invoked with `--context-from-files` / `--context-file` /
`--context-transport upload` and `--allow-grok-context-pack` is not passed,
the runtime throws with `stage: 'grok-context-pack-not-allowed'`. Pass
`--allow-grok-context-pack` to override deliberately; the runtime still
emits the `grok-context-pack-not-recommended` warning when the override is
used.

## Polling Timeouts

`web-ai poll` and `web-ai query` accept `--timeout <seconds>`. When omitted,
the runtime uses these defaults so heavy reasoning models (ChatGPT Pro/Heavy,
Gemini Deep Think, Grok Expert/Heavy) have room to finish:

| Vendor | Default `--timeout` | Roughly |
| --- | ---: | --- |
| ChatGPT | 1200 | 20 minutes |
| Gemini | 1200 | 20 minutes |
| Grok | 600 | 10 minutes |

Pass `--timeout 1800` (30 min) or higher for unusually long Pro/Deep Think
runs. The provider tab and the agbrowse Chrome process stay open across a
poll timeout — only the polling loop gives up.

## Multi-Tab Behavior (Phase 9.1+)

By default, `send` and `query` create a **new browser tab** for each session.
This isolates conversations and prevents context contamination.

### Tab Reuse

Reuse the existing active tab (legacy single-tab behavior):

```bash
agbrowse web-ai send --vendor chatgpt --reuse-tab --inline-only --prompt "hello"
# or globally:
export AGBROWSE_REUSE_TAB=1
```

### Session-to-Tab Binding

Each session record stores `targetId`, `tabId`, and `tabState`. When `poll` or
`stop` is invoked with `--session <id>`, the runtime switches to that session's
bound tab automatically. If the tab was closed, it auto-recovers by creating a
new tab and navigating to the saved `conversationUrl`.

### Tab Pooling (Phase 9.2)

Completed session tabs are kept in a vendor-specific pool for reuse. The next
`send` for the same vendor will reuse a pooled tab instead of creating a new one,
reducing tab creation overhead in batch scenarios.

### Tab Lifecycle

| Setting | Default | Env Var |
| --- | --- | --- |
| Max tabs | 10 | `AGBROWSE_MAX_TABS` |
| Idle timeout | 30 min | `AGBROWSE_TAB_IDLE` |

Idle tabs (inactive longer than the timeout) are auto-closed unless pinned or
bound to an active session.

Before creating a new web-ai tab, agbrowse runs lifecycle cleanup so long-lived
agent sessions do not keep growing Chrome tab count. For explicit cleanup:

```bash
agbrowse tabs --json
agbrowse tab-cleanup --json
agbrowse tab-cleanup --include-untracked --idle-after 10m
```

Use `--include-untracked` only when you intentionally want to close older tabs
that predate the activity metadata file.

## Render First

Use render to inspect the exact structured prompt shape:

```bash
agbrowse web-ai render \
  --vendor chatgpt \
  --project "project name" \
  --goal "what the provider should do" \
  --prompt "question"
```

Envelope shape:

```text
[SYSTEM]
...

[USER]
## Project
...

## Goal
...

## Question
...
```

## Live Query Examples

ChatGPT Pro:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --model pro \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Reply exactly CHATGPT_OK"
```

Gemini:

```bash
agbrowse web-ai query \
  --vendor gemini \
  --url https://gemini.google.com/app \
  --model fast \
  --inline-only \
  --prompt "Reply exactly GEMINI_OK"
```

Grok:

```bash
agbrowse web-ai query \
  --vendor grok \
  --url https://grok.com/ \
  --model expert \
  --inline-only \
  --prompt "Reply exactly GROK_OK"
```

## File Upload

```bash
agbrowse web-ai query \
  --vendor gemini \
  --url https://gemini.google.com/app \
  --model fast \
  --file /tmp/context.txt \
  --prompt "Read the attached file and reply with its sentinel."
```

Upload must verify visible attachment evidence and sent-turn evidence where the
provider exposes it. Input-only success is not enough.

## Context Package Upload

Use ChatGPT or Gemini for context packaging. Do not pick `--vendor grok`
here; Grok should use inline prompts plus optional single `--file` uploads
only.

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --context-from-files "web-ai/*.mjs" \
  --context-transport upload \
  --prompt "Reply exactly CONTEXT_OK if the package contains question.mjs."
```

Use `context-dry-run --json` before live mutation when the file set is large:

```bash
agbrowse web-ai context-dry-run \
  --vendor chatgpt \
  --prompt "Review this context" \
  --context-from-files "web-ai/*.mjs" \
  --json
```

## Model Aliases

ChatGPT:

- `instant`, `fast`, `gpt-5.3`
- `thinking`, `think`, `gpt-5.5-thinking`
- `pro`, `gpt-5.5-pro`
- `--effort` / `--reasoning-effort` for ChatGPT:
  - Pro: `standard`, `extended`
  - Thinking: `light`, `standard`, `extended`, `heavy`

2026-05-03 ChatGPT UI note:

- The visible model opener can be a bottom composer pill such as `Pro`
  without the older top `model-switcher-dropdown-button`.
- Pro effort trigger: `[data-testid="model-switcher-gpt-5-5-pro-thinking-effort"]`
  with `Standard` and `Extended`.
- Thinking effort trigger:
  `[data-testid="model-switcher-gpt-5-5-thinking-thinking-effort"]`
  with `Light`, `Standard`, `Extended`, and `Heavy`.
- Use regular Pro by selecting `--model pro --effort standard`.

Gemini:

- `fast`, `flash`, `gemini-fast`
- `thinking`, `think`, `gemini-thinking` selects the Gemini 3 Flash Thinking model
- `pro`, `gemini-pro`, `3.1-pro`

Gemini Deep Think tool aliases:

- `deepthink`, `deep-think`, `deep_think`, `deep think`

Gemini `deepthink` activates the visible `Deep think` tool before submitting
the prompt. It is intentionally separate from the `thinking` model alias.

Grok:

- `auto`, `automatic`
- `fast`, `quick`
- `expert`, `thinking`, `think`
- `grok-4.3`, `grok43`, `grok-43`, `beta`
- `heavy`

## Copy Markdown Fallback

Use only when explicitly needed:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Return a markdown table."
```

The runtime intercepts the page's `navigator.clipboard.writeText/write` during
the provider Copy button click. It does not read the OS clipboard.

## Error taxonomy

Set `AGBROWSE_JSON_ERRORS=1` for agent integrations. When set (or when the
command was invoked with `--json`), any failure is printed on stderr as a
parseable JSON envelope:

```json
{
  "ok": false,
  "status": "error",
  "error": {
    "name": "WebAiError",
    "errorCode": "cdp.target-mismatch",
    "stage": "connect",
    "message": "active tab is not ChatGPT: https://example.com/",
    "retryHint": "tab-switch",
    "vendor": "chatgpt",
    "mutationAllowed": false,
    "selectorsTried": [],
    "evidence": { "url": "https://example.com/" }
  }
}
```

Otherwise human mode prints `[web-ai error] <code>: <message>` on the first
line and `[hint] retryHint: <hint>` on the second line. Exit code is `1`
in both modes.

Initial code catalog (full list and PR2 call-site coverage live in
`devlog/_fin/mvp/01_foundation/03_phase2_errors.md`):

- `cdp.unreachable`, `cdp.target-mismatch`
- `provider.composer-not-visible`, `provider.model-mismatch`,
  `provider.attachment-preflight`, `provider.attachment-evidence-missing`,
  `provider.commit-not-verified`, `provider.poll-timeout`,
  `provider.runtime-disabled`
- `capability.unsupported`
- `context.over-budget`, `context.symlink-rejected`
- `grok.context-pack-not-allowed`
- `internal.unhandled`

PR1 ships the class shape and the CLI/JSON wrapper. PR2 converts every
provider/context-pack `throw new Error(` to `WebAiError`.

## Safety

- Never claim live web-ai success from render/dry-run alone.
- Headed Chrome is the valid path for provider smoke tests.
- Human verification and login screens must be completed by the user.
- agbrowse does not bypass anti-bot, captcha, or Cloudflare checks.
- Do not share one Chrome `--user-data-dir` across multiple CDP-controlled instances.
- For agent integrations, prefer `AGBROWSE_JSON_ERRORS=1`.
- If the active tab is ambiguous, run `agbrowse tabs` and
  `agbrowse tab-switch <targetId>` before mutation.
