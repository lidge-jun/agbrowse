---
name: web-ai
description: >-
  Ask AI web UIs (ChatGPT, Gemini, Grok) via standalone agbrowse browser automation.
  Model selection, effort control, session resume, file/context upload, polling, copy-markdown fallback, and response extraction.
  NOT for: generic page navigation or screenshots (use browser skill).
  Triggers: web-ai, agbrowse, ChatGPT, GPT, GPT Pro, GPT Thinking, GPT Instant, GPT Heavy,
  Gemini, Gemini Pro, Gemini Thinking, Gemini DeepThink, deep think, deepthink,
  Grok, Grok Heavy, Grok Expert, Grok Fast, grok-4.3,
  챗지피티, 제미나이, 그록, 딥씽크, GPT한테, AI한테, AI 물어봐, AI한테 물어봐,
  heavy 모드, thinking 모드, pro 모드, expert 모드, extended effort, reasoning effort,
  ask chatgpt, ask gemini, ask grok, query AI, AI 리뷰, AI 검증, AI 조사,
  GPT한테 리뷰, GPT로 검증, 그록한테 물어봐, 제미나이로 분석,
  ~한테 물어봐, ~한테 질문, ~에게 요청, ~로 물어봐, ~로 검증, ~로 분석,
  web-ai query, web-ai send, web-ai poll, --vendor, --model, --effort
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
- If the user explicitly says to use `agbrowse` or standalone agbrowse, run
  `agbrowse --help` first, and run `agbrowse web-ai --help` before choosing
  web-ai flags. Treat the current help output as the command truth and adapt
  these instructions to that surface.
- For live provider smoke tests, pass `--url` so the runtime verifies the
  provider host before sending.

## Commands

```bash
agbrowse web-ai render
agbrowse web-ai status
agbrowse web-ai send
agbrowse web-ai poll
agbrowse web-ai query
agbrowse web-ai code
agbrowse web-ai code-extract
agbrowse web-ai stop
agbrowse web-ai watch
agbrowse web-ai snapshot
agbrowse web-ai sessions
agbrowse web-ai doctor
agbrowse web-ai project-sources
agbrowse web-ai context-dry-run
agbrowse web-ai context-render
agbrowse web-ai claim-audit
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

MCP clients should preserve the `sessionId` returned by `web_ai_submit_prompt`.
`web_ai_wait_response` and `web_ai_session_resume` use the stored-session
recovery path and may return a recoverable timeout with `retryHint:
poll-or-resume`. A host-level MCP request timeout, such as `-32001 Request
timed out`, is a client/runtime boundary; after it, retry with the same
`sessionId` or use CLI `web-ai poll --session <SID>` instead of sending a new
prompt immediately.

## Long-Running / Background Sessions

For responses that may take many minutes (ChatGPT Pro/Heavy, Gemini Deep
Think, Deep Research), do not block your agent turn on `query`. Split into
`send` + background `watch`:

```bash
SID=$(agbrowse web-ai send --vendor chatgpt --model pro --inline-only \
  --prompt "..." --json | jq -r .sessionId)
# separate/background process:
agbrowse web-ai watch --session "$SID" --json --navigate
```

Key facts (verified 2026-06-11, details in
`devlog/_fin/260611_background_runtime_hook/02_agbrowse_sufficiency.md`):

- Sessions persist in `~/.browser-agent/web-ai-sessions.json` and survive
  process/machine restarts. `sessions show <SID> --json` is safe from any
  process.
- ⚠️ `sessions show` is **read-only** — it never advances state. Only
  `watch`/`poll` drive the browser DOM and move a session to a terminal
  status (`complete`/`timeout`/`error`). A monitor that only re-reads the
  store will wait forever.
- `watch` emits line-delimited JSON events (`watch.start`, `watch.tick`
  every 15s by default, then `watch.complete`/`watch.timeout`/`watch.error`)
  and exits on terminal status. Parse the last terminal line, then fetch the
  full answer with `sessions show <SID> --json`.
- A per-session watcher lock makes concurrent/duplicate `watch` calls fail
  closed and auto-recovers stale locks from dead processes — re-running
  `watch` after a crash is safe.
- There is no `--on-complete` callback flag. Chain with the shell instead:
  `agbrowse web-ai watch --session "$SID" --json; <notify command>`.

Per-runtime pattern for the background `watch` process:

| Agent runtime | Recommended pattern |
| --- | --- |
| Claude Code | Run `watch` via `Bash run_in_background: true` — process exit injects a completion notification that re-activates the agent (no polling). |
| Cursor | Run `watch` as a background shell, then use the `Await` tool to wait for a `watch.complete` sentinel line. |
| Codex | Background terminal polling works (15s ticks avoid the 5-min empty-poll window), but for very long runs prefer a fully external watcher that calls `codex exec resume` on completion. |
| cli-jaw | Boss turns are disposable — do not background `watch` inside a turn. Register a server-owned task instead: `cli-jaw bgtask add --preset web-ai --session "$SID"` (native session probe), then end the turn — the jaw server re-invokes the boss with a `[bgtask:*]` prompt on completion (restart-durable). |

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

### Shared CDP Session Ambiguity

All provider commands may share one Chrome CDP port, such as `9222`. For
session-less `poll` or `stop`: `0` active sessions preserve legacy current-tab
behavior, `1` active provider session auto-binds with a warning, and `2+` fail
closed with `session.target-ambiguous` plus candidate `sessionId`/`targetId`
evidence. Rerun with `--session <id>`; for tab drift or missing target recovery,
add `--navigate`.

### Tab Pooling (Phase 9.2)

Completed session tabs are kept in a vendor-specific pool for reuse. The next
`send` for the same vendor will reuse a pooled tab instead of creating a new one,
reducing tab creation overhead in batch scenarios.

| Pool setting | Default | Env Var |
| --- | --- | --- |
| TTL per pooled tab | 30 min | `AGBROWSE_PROVIDER_POOL_TTL` |
| Max warm tabs per `(owner,vendor,sessionType,origin,profile)` | 3 | `AGBROWSE_PROVIDER_POOL_MAX_PER_KEY` |
| Global cap on warm provider tabs | 8 | `AGBROWSE_PROVIDER_POOL_GLOBAL_MAX` |

Use `--new-tab` (or its alias `--parallel`) on `send` / `query` to bypass pool
reuse for a single call — needed when you want a Pro query to run alongside
another in-flight Pro query without lease contention.

### Tab Lifecycle

| Setting | Default | Env Var |
| --- | --- | --- |
| Max tabs | 20 | `AGBROWSE_MAX_TABS` |
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

## Where instructions go — `--system` vs `--context` vs `--file`

Attaching instructions *and* a file already works today; pick the right channel:

- **Operating instructions / skill guidance** ("how to behave", "extract X from the
  attached file") → `--system "..."`. Rendered in the trusted `[SYSTEM]` section and
  honored. `--goal` / `--constraints` (USER fields) are also trusted.
- **Untrusted reference *data*** (scraped page text, provider output) → `--context "..."`.
  Rendered as `[UNTRUSTED_CONTEXT]`; **instructions placed here are ignored by design**
  (prompt-injection boundary). Never put operating instructions in `--context`.
- **A file for the model to read/analyze** → `--file <path>` (repeatable; native,
  dialog-free attachment). The model sees it directly — you do **not** need to also
  describe it in `--context`.

Common mistake: putting instructions in `--context` and finding they are "ignored" →
move them to `--system`. Example of the working combo:

```bash
agbrowse web-ai query --vendor chatgpt --model thinking \
  --system "Extract every breaking change from the attached PDF and group by module." \
  --file ./spec.pdf \
  --prompt "Summarize the breaking changes."
```

If you are unsure whether/how a file is attached, just **ask the user** rather than
relying on envelope guesswork.

## File Upload

```bash
agbrowse web-ai query \
  --vendor gemini \
  --url https://gemini.google.com/app \
  --model fast \
  --file /path/to/user-requested-file.pdf \
  --file /path/to/user-requested-image.png \
  --prompt "Summarize the attached file."
```

`--file` is repeatable and may mix file types such as images, archives, PDFs,
and text files in one prompt. Use it only when the user explicitly wants those
specific files uploaded. For source/project context, use context packaging
instead of creating temporary `.txt`/`.md` files.

Upload must verify visible attachment evidence and sent-turn evidence where the
provider exposes it. Input-only success is not enough.

Use `--max-upload-file-size <bytes>` for live `--file` uploads. Use
`--max-context-file-size <bytes>` for context package selection; legacy
`--max-file-size <bytes>` is the context-budget alias, not the live upload cap.

## ChatGPT Code Mode

Use ChatGPT only. `web-ai code` sends a strict code-generation contract, waits
for ChatGPT to create zip artifacts in its sandbox, retrieves the artifacts via
the provider download API, and validates the local zip before returning. The
contract tells ChatGPT to use its plan tool when available, create/update a
visible `turn_plan.update_turn_plan` todo checklist only when that tool is
actually available, keep that visible todo/checklist to 8 or fewer top-level
items, put extra detailed stage instructions in the plan file, create
`PLAN.md` or `00_plan.md` inside every generated code zip, then implement,
self-check, package, and return both human clickable
sandbox links and machine-readable plain artifact paths. `web-ai code`
automatically uploads `skills/web-ai/modules/gpt-dev-agent-context.zip` as the
first attachment; this saved skill module is a GPT/Linux-sandbox dev-agent guide
built from the dev skills and AGENTS rules.

The context zip is attached only on the FIRST turn of a conversation.
Continuation turns (`--url`, `--conversation`, or `--session` targeting an
existing conversation) skip it: the container `/mnt` persists across turns and
the contract already lives in the conversation history. Pass `--context-refresh`
to force a re-upload (e.g. after the context module changed, or when a long-idle
conversation may have recycled its sandbox).

Single zip:

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Create a Flask hello-world MVP." \
  --output-zip ./result.zip
```

If `--output-zip` is omitted, agbrowse saves under the current working directory
as `code-artifact-<conversation>.zip`.

Multiple named zips:

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --multi-zip \
  --output-dir ./artifacts \
  --prompt "Create backend.zip and frontend.zip as separate deliverables."
```

Do not combine `--multi-zip` with `--output-zip`; multi-zip mode saves each
archive under `--output-dir` or, when omitted, `code-artifacts-<conversation>/`
in the current working directory.

Later extraction from an existing ChatGPT conversation:

```bash
agbrowse web-ai code-extract \
  --vendor chatgpt \
  --url "https://chatgpt.com/c/<conversation-id>" \
  --output-zip ./result.zip
```

For multiple zips from the same old conversation:

```bash
agbrowse web-ai code-extract \
  --vendor chatgpt \
  --url "https://chatgpt.com/c/<conversation-id>" \
  --multi-zip \
  --output-dir ./artifacts
```

If the ChatGPT conversation tab is already open, `--url` can be omitted. If the
conversation was created by agbrowse and the session is still recorded, use
`--session <sessionId>` instead. A bare `--conversation <conversation-id>` also
works. The extractor does not send a new prompt; it scans the saved conversation
JSON for `/mnt/data/*.zip` paths and reuses the provider download API.

Stale-snapshot guard: when one conversation rebuilds the same sandbox path (e.g.
`/mnt/data/result.zip`) across several code runs, the provider download API
serves the snapshot tied to the message id used to mint the URL. The extractor
mints candidate message ids NEWEST-first, so the first successful mint is the
latest sandbox state; older snapshots are only used when newer mints fail. The
result reports `mintedMessageId` for auditing. Even so, ALWAYS verify retrieved
zip contents against drop-specific symbols (grep for a file or identifier unique
to the expected delivery) before applying — if the contents mismatch, retry with
`--multi-zip` to recover every archive and identify the right one.

Expected final ChatGPT answer shape for one zip:

```text
DOWNLOAD: [result.zip](sandbox:/mnt/data/result.zip)
MACHINE: /mnt/data/result.zip
```

For multi-zip mode, ChatGPT repeats the same two-line block for each zip. The
`DOWNLOAD:` line is for humans in the ChatGPT UI; the `MACHINE:` line is for
agbrowse and other automation.

Current ChatGPT web sessions may not expose `turn_plan.update_turn_plan` at all
(or may expose it only transiently while the response is streaming). Do not fail
a completed run only because the visible todo UI is absent after the answer
finishes; the durable plan file inside the zip is the required checklist. New
`web-ai code` retrieval fails closed when a code zip lacks `PLAN.md` or
`00_plan.md`; `code-extract` can still recover legacy artifacts from older
conversations. Keep the top-level visible/durable checklist to 8 items or fewer;
for complex work, add textual detailed stage instructions in the plan file.
Completed items in the zip-root plan file should be marked `[x]` before final
packaging.

After extraction, verify locally when correctness matters:

```bash
unzip -t ./result.zip
unzip -l ./result.zip
```

Validated live on 2026-06-11 with a completed ChatGPT code-mode conversation
where the visible assistant answer contained only `/mnt/data/result.zip`; the
runtime recovered `pro_hello.py` and `README.md` from the old conversation
without sending a follow-up prompt.

Code mode is beta and ChatGPT-only. The `DOWNLOAD:` sandbox link gives humans a
visible button in the ChatGPT UI, while the `MACHINE:` plain path gives agents a
stable text target. Plain sandbox paths in the assistant answer remain enough
for the runtime to retrieve the archives, including later `code-extract` runs.
Text copied away from ChatGPT is not enough by itself: the extractor still needs
the original conversation URL/session/current tab plus the logged-in ChatGPT
browser profile.
Do not claim cli-jaw parity for this command unless the equivalent cli-jaw
command surface, retrieval runtime, tests, and installed skill docs are
implemented there.

## ChatGPT Composer Tools and Plugins

ChatGPT's composer `+` menu can be selected before sending:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --tool web-search \
  --plugin github \
  --prompt "Review the current GitHub repo status."
```

Supported tool aliases:

- `--tool image` → `이미지 만들기` / Create image
- `--tool deep-research` or `--research deep` → `심층 리서치` / Deep Research
- `--tool web-search` or `--web-search` → `웹 검색` / Web search
- `--tool agent-mode` → `에이전트 모드`
- `--tool tasks` → `할 일 만들기`

Supported `--plugin` aliases under `더 보기`:

- `github`, `gmail`, `google-drive`, `google-calendar`, `google-contacts`
- `supabase`, `vercel`, `figma`, `canva`, `context7`, `openai-platform`

Composer menus are not opened on the default send/query path. They are touched only when `--tool`, `--plugin`, `--web-search`, `--auto-tools`, `--output-image`, or `--research deep` requests a composer selection.
For Deep Research, `--tool deep-research` / `--research deep` selects the Deep
Research mode and preserves ChatGPT's default source state (`Sites, search the
web, no sites saved`). Do not configure the Deep Research `Apps`, `Sites`,
`Specific sites`, `Manage sites`, or connector subflows unless a future explicit
CLI flag requests that exact internal setting.

Use `--auto-tools` when you want agbrowse to infer obvious tools from the prompt:

- current/latest/news/price/official/source-sensitive prompt → web search
- image/illustration/poster generation prompt → image
- deep research / 심층 리서치 prompt → deep research
- `--plugin <name>` remains explicit-only because connector/plugin choices may open account-linking or authorization UI.

Live-verified 2026-06-15 on Korean/English ChatGPT UI: `파일 추가 및 기타` / `Add files and more`, `이미지 만들기` / `Create image`, `심층 리서치` / `Deep research`, `웹 검색` / `Web search`, `더 보기` / `More`, the Deep research `Apps` and `Sites` submenus, the iframe-rendered post-submit Deep Research plan card with a ~60-second `Start` countdown, and connector entries including `GitHub`, `Gmail`, `Google 드라이브`, and `Google Calendar`. Connector/plugin entries are explicit-only.

## Generated Images

Use ChatGPT only:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --tool image \
  --output-image ./out.png \
  --prompt "Create an image of a small robot holding a banana."
```

If multiple images are generated, `./out.png` becomes the first file and
siblings are written as `out-2.png`, `out-3.png`. Treat explicit
`--output-image` as fail-closed: if the provider does not produce or expose an
image, the command should fail with `provider.image-output`.

Image input is normal upload:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --file ./input.png \
  --prompt "Describe this image."
```

## Batch Follow-Ups

`--follow-up <text>` is repeatable and sends explicit caller-provided prompts
sequentially in the same ChatGPT command run:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --prompt "Analyze this design." \
  --follow-up "Summarize risks."
```

Never invent follow-ups. For a later follow-up in the same saved conversation
window, use `query --session <id> --prompt <text>`:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --session "$SID" \
  --inline-only \
  --output-image ./next.png \
  --prompt "Create another image in this same conversation."
```

Do not combine `--follow-up` with `--research deep`.

## Deep Research

`--research deep` is ChatGPT-only experimental beta. Use longer timeouts and
expect account/security blocks to fail explicitly:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --research deep \
  --timeout 1800 \
  --prompt "Research the current official status and cite sources."
```

Deep Research saves a report artifact when available, skips auto archive, and
auto-confirms ChatGPT's iframe-rendered post-submit plan card when its
time-limited `Start` / `시작` button appears. It does not configure the internal
Apps/Sites/source settings beyond ChatGPT's default `Sites, search the web`
state. Do not claim cross-provider Deep Research support.

## ChatGPT Project Sources

Project Sources are append-only and always require an explicit project URL:

```bash
agbrowse web-ai project-sources list \
  --chatgpt-url https://chatgpt.com/g/project_123 --json

agbrowse web-ai project-sources add \
  --chatgpt-url https://chatgpt.com/g/project_123 \
  --file ./docs/context.md \
  --dry-run summary
```

Use `--dry-run` before mutation. It validates URL and files without opening or
mutating Chrome. Do not infer the project from the active tab. Delete, replace,
and clear are intentionally unsupported.

## Context Package Upload

Use ChatGPT or Gemini for context packaging. Do not pick `--vendor grok`
here; Grok should use inline prompts plus optional single `--file` uploads
only.

Upload transport creates one `.zip` archive named
`web-ai-context-package-<id>.zip`. The archive contains `CONTEXT_PACKAGE.md`
plus the selected source files. Do not create a temporary `.txt`/`.md` file
yourself for source context; use `--context-from-files` or `--context-file`.

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
- In the simplified Intelligence UI, Pro currently routes through `Pro Extended`
  because the plain `Pro` / `Pro Standard` row may be absent.

2026-06-11 ChatGPT Intelligence UI note:

- The visible picker may be the simplified `Intelligence` menu instead of the
  older model row plus separate effort submenu.
- `instant` and `thinking --effort light` select `Instant`.
- `thinking --effort standard` selects `Medium`.
- `thinking --effort extended` selects `High`.
- `thinking --effort heavy` selects `Extra High`.
- `pro --effort standard` selects `Pro Extended` when the simplified UI only exposes Pro Extended; if ChatGPT exposes a `Pro Standard` hover submenu, treat it as an optional refinement rather than a required selector.
- `pro --effort extended` selects `Pro Extended`.

2026-06-15 Korean ChatGPT Intelligence UI note:

- The composer model pill may show `중간` and open a `지능` menu.
- `instant` / `thinking --effort light` select `즉시`.
- `thinking --effort standard` selects `중간`.
- `thinking --effort extended` selects `높음`.
- `thinking --effort heavy` selects `매우 높음`.
- `pro --effort extended` selects `Pro 확장`.
- Pro effort trigger observed as `data-testid="composer-intelligence-pro-thinking-effort-trigger"`.

Gemini:

- `flash-lite`, `fast`, `gemini-fast`
- `flash`, `gemini-flash`
- `pro`, `gemini-pro`
- `thinking`, `think`, `gemini-thinking` are legacy compatibility aliases for `pro`

Versioned UI labels such as Gemini 3.n Pro are normalized internally; prefer the
stable aliases above.

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
the provider Copy button click. It does not read the OS clipboard. The flag is
the explicit policy opt-in for CLI use; do not add `--unsafe-allow` unless you
are testing legacy policy aliases.

## Error taxonomy

Set `AGBROWSE_JSON_ERRORS=1` for agent integrations. When set (or when the
command was invoked with `--json`), any failure is printed on stderr as a
parseable envelope: `{ "ok": false, "status": "error", "error": { ... } }`.

Poll-stage target drift is a command result with `ok: false`,
`status: "target-mismatch"`, `expectedTargetId`, `actualTargetId`, `port`,
`targetMismatch`, and a `recovery` command such as
`agbrowse web-ai poll --vendor chatgpt --session <id> --navigate --json`.

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
- `session.target-ambiguous`: rerun `poll`/`stop` with `--session <id>`; for
  target drift, retry `poll --session <id> --navigate`
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
