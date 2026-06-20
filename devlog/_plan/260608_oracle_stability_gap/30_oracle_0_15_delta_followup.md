# 30 — Oracle 0.15 Delta Follow-up

Date: 2026-06-20
Status: plan

## Reference Pull

Oracle reference repo: `/tmp/agbrowse-oracle-reference`

Update command result:

```text
git fetch --prune origin
git pull --ff-only
Already up to date.
```

Current Oracle head:

```text
d5c5e954ecec856159d7eac62037ba19040c30e0
2026-06-20 02:48:00 +0200
build(deps): bump the dependencies group with 7 updates (#270)
```

Prior local Oracle review anchors:

| Anchor | Date | Meaning |
| --- | --- | --- |
| `a1dbb13328dc75ef46a8b869618b4d5a8985c722` | 2026-05-12 | `0.11.1`-era guardrail follow-up basis |
| `1828e2b34b51d0888565bebd9f1245083b66601f` | 2026-05-13 | attachment-chip parity follow-up basis |

Delta from `a1dbb133` to current Oracle head:

```text
181 files changed, 27201 insertions(+), 4190 deletions(-)
```

Recent Oracle tags now visible in the reference clone:

```text
v0.15.0
v0.14.1
v0.14.0
v0.13.0
v0.12.1
v0.12.0
v0.11.1
```

## High-value Oracle changes since 0.11.1

### 0.12.x

- `--perf-trace` startup timing and lazy loading.
- Multi-model partial success with classified provider failures.
- `--preflight`, `doctor --providers`, and redacted route diagnostics.
- Session lifecycle block with foreground/background/reattach metadata.
- `oracle docs check`.
- Opt-in ZIP browser bundle formatting.
- Timeout parsing and HTTP/stale timeout alignment.
- Model selection evidence and stricter Pro effort confirmation.

### 0.13.x

- Browser attachment timeout config.
- GPT-5.5 Instant picker row support.
- Project config defaults.
- Attachment readiness from the active ChatGPT composer.
- Scoped real picker-menu scanning.

### 0.14.x

- Later-session `--followup <browser-session>` that reopens the exact saved ChatGPT conversation before sending a new prompt.
- `session --harvest` / `--live` recovery after Chrome was closed, using the saved conversation URL and manual-login profile.
- Persist ChatGPT downloadable files such as CSV, PDF, ZIP, wheel, and source distributions beside the transcript.
- MCP `chatgpt_image` and typed image output support.
- Deep Research report capture from out-of-process iframes, scoped to the active page/session.
- Login/auth probe hardening, exact saved-account selection, visible provider warning surfacing.
- Line-numbered prompt/text bundle context.
- Byte-preserving ZIP upload bundles for raw/archive/office/media files.

### 0.15.x

- `--copy-profile <dir>` copies an active signed-in Chrome profile to a throwaway profile for login-free reuse, with cleanup and incompatible-mode rejection.
- Wait for the current ChatGPT Intelligence pill before selecting model/effort.
- Bounded retries for explicit model selection.
- Sequential generated-file downloads with browser-provided filenames and timeout attribution.
- Deep Research planning/status captures are rejected when ChatGPT returns a normal non-research answer.

## agbrowse current coverage

Already covered or partially covered:

- ChatGPT code-mode ZIP retrieval exists in `web-ai/code-artifact.mjs`, including assistant/user filtering and zip validation.
- Generated ChatGPT image output exists in `web-ai/chatgpt-images.mjs`.
- Session artifacts exist in `web-ai/session-artifacts.mjs`.
- Deep Research exists in `web-ai/chatgpt-deep-research.mjs`, including iframe scan and report artifacts.
- Session resume/reattach/watch recovery exists in `web-ai/tab-recovery.mjs` and `web-ai/watcher.mjs`.
- Same-command ChatGPT batch follow-ups exist via `--follow-up`.
- Later-session prompt send already exists through `agbrowse web-ai query --session <id> --prompt <text>` via `runBoundSendOrQuery()` and `withSessionPage()`.
- Capability truth table still treats later-session follow-up as deferred in the dedicated `--follow-up` capability row, so the remaining gap is parity labeling, discoverability, and stricter saved-conversation guards, not a greenfield feature.

Still missing or worth auditing:

- Generic ChatGPT downloadable file artifacts are not covered outside code ZIPs and generated images. Oracle now handles current-turn assistant files from known ChatGPT endpoints, including CSV/PDF/ZIP/wheel/source-dist.
- Deep Research extraction is still iframe-text oriented. It does not yet mirror Oracle's target-scoped OOPIF auto-attach/read-selection helper or incomplete-report rejection.
- Later-session follow-up needs an Oracle-parity audit: existing `query --session` can send a prompt into a saved session, but docs/truth-table wording and fail-closed conversation URL guards need to be reconciled.
- Profile-copy login reuse has no direct agbrowse equivalent. Existing `BROWSER_AGENT_HOME` and CDP reuse cover the normal flow but not "clone active user profile into throwaway profile".
- Sequential download attribution for generic generated files is not implemented because generic generated-file capture is not implemented.
- Byte-preserving ZIP upload should be audited against `web-ai/context-pack/` and `web-ai/chatgpt-attachments.mjs`; current context-pack zip behavior is not the same feature as Oracle's mixed raw/archive/office/media bundle writer.
- Oracle provider route diagnostics are mostly out of scope for agbrowse while agbrowse intentionally has no hosted API provider-routing layer.

## Recommended follow-up order

This delta is split into two PABCD-ready implementation plan documents:

| File | Scope | Priority |
| --- | --- | --- |
| [31_chatgpt_downloadable_artifacts_pabcd.md](31_chatgpt_downloadable_artifacts_pabcd.md) | Generic ChatGPT downloadable files, session artifact descriptor expansion, sequential download attribution, byte-preserving upload audit | P0/P2 |
| [32_deep_research_session_followup_pabcd.md](32_deep_research_session_followup_pabcd.md) | Deep Research target-scoped capture, model picker/current-pill audit, existing `query --session` follow-up parity, profile-copy decision | P0/P1/P2 |

### P0 — Generic ChatGPT downloadable file artifact capture

Implement a ChatGPT generated-file artifact collector that is separate from code-mode ZIP retrieval.

Required behavior:

- Scope to the current assistant turn/run, not the whole visible conversation.
- Allow only known ChatGPT file endpoints and same-origin downloadable URLs.
- Reject path traversal and unsafe sandbox paths.
- Deduplicate aliases that point to the same file.
- Download sequentially and preserve browser-provided filenames when available.
- Stop attributing downloads after timeout so late downloads cannot be attached to the next file.
- Record descriptors through the existing session artifact mechanism.

Test focus:

- URL allowlist: `/backend-api/sandbox/download`, `/backend-api/files/<id>/download`, `/backend-api/files/<id>/content`, `/backend-api/estuary/content?id=file_...`.
- Non-ChatGPT host rejection.
- `/mnt/data/../` and encoded traversal rejection.
- Assistant-current-turn scoping, user text ignored.
- Duplicate alias dedupe.
- Timeout attribution.

### P0/P1 — Deep Research target-scoped capture

Upgrade `web-ai/chatgpt-deep-research.mjs` from "latest assistant or any research iframe text" to a scoped report-selection model.

Required behavior:

- Bind any iframe/OOPIF read to the active page session.
- Prefer completed Deep Research report targets over legacy frame fallback.
- Reject planning cards, progress/status pages, and normal non-research answers as final reports.
- Preserve the current artifact save contract through `session-artifacts.mjs`.

Test focus:

- Completed OOPIF report wins over incomplete frame text.
- Planning/status text fails clearly.
- Unrelated tab/iframe cannot be harvested.
- Legacy same-page iframe fallback still works.

### P1 — Model picker/current-pill audit

Compare agbrowse `web-ai/chatgpt-model.mjs` against Oracle 0.14.1/0.15.0 behavior:

- current Intelligence pill wait
- explicit Thinking/Pro effort evidence
- bounded retries for model selection
- Instant row support and wrapper-row rejection

This should be an audit before a patch, because agbrowse already has several model-selection guardrails from earlier parity work.

### P1 — Later-session follow-up parity

Audit and harden the existing later-session path:

```text
agbrowse web-ai query --session <sessionId> --prompt <text>
```

Required behavior:

- Resolve the exact saved session and conversation URL.
- Fail closed on target mismatch unless navigation/recovery is explicitly authorized.
- Reuse existing `tab-recovery.mjs` and conversation URL checks.
- Do not send to provider root, a different thread, or an external URL.
- Update help/truth-table wording so users can distinguish same-command `--follow-up` from later-session `query --session`.

### P2 — Profile-copy login reuse

Treat this as optional unless users repeatedly hit "need active Chrome login but do not want to reuse the shared profile" flows.

Questions before implementation:

- Does `BROWSER_AGENT_HOME` plus headed CDP reuse already satisfy the agbrowse workflow?
- Is copying a real user Chrome profile acceptable for this project, including local keychain/cookie handling?
- Would a throwaway profile improve isolation enough to justify the added operational risk?

### P2 — Byte-preserving ZIP bundle audit

Audit context-package and attachment upload behavior for raw/archive/office/media file preservation. Do not assume this is solved by code-mode artifact ZIP verification; this is an upload-side bundle integrity issue.

### Out of scope for now

- Oracle API provider route diagnostics and `--allow-partial` provider failures remain out of scope unless agbrowse intentionally grows a hosted API provider-routing layer.
- MCP `chatgpt_image` parity is not urgent while generated-image output remains CLI-only in agbrowse's truth table.

## Verification matrix for future patches

| Area | Required verification |
| --- | --- |
| Generic generated files | unit tests for URL/path allowlist, current-turn scoping, dedupe, timeout attribution; fake ChatGPT download endpoint fixture |
| Deep Research | unit/fixture tests for completed report vs planning/status/normal answer; unrelated iframe rejection |
| Model picker | fixture tests for current Intelligence dialog, Instant row, wrapper rows, Pro effort evidence |
| Later-session follow-up | session resolver tests for exact URL, mismatch fail-closed behavior, `--navigate` recovery |
| Profile copy | platform-gated unit tests, temp-profile cleanup tests, incompatible-mode rejection |
| ZIP upload integrity | byte-level fixture comparing original raw/archive/office/media buffers after bundle write |

After any implementation slice, run at minimum:

```bash
npm run test:release-gates
git diff --check
```

Run `npm run gate:all` only when capability truth-table or release-claim surface changes.
