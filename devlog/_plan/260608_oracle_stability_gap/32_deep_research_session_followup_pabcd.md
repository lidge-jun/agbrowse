# 32 — Deep Research and Session Follow-up PABCD

Date: 2026-06-20
Status: PABCD plan
Parent: [30_oracle_0_15_delta_followup.md](30_oracle_0_15_delta_followup.md)

## Purpose

Oracle 0.14/0.15 hardened Deep Research, model selection, and session recovery.
agbrowse already has Deep Research, session reattach, watcher recovery,
same-command `--follow-up`, and a later-session send path via
`query --session <id> --prompt <text>`. It still lacks Oracle's newer
page-scoped OOPIF Deep Research report capture, and the existing later-session
path needs an Oracle-parity audit for discoverability, truth-table wording, and
saved-conversation fail-closed guards.

This plan splits the work so the P0 capture correctness lands before more
visible command-surface changes.

## Priority Map

| ID | Priority | Outcome |
| --- | --- | --- |
| 32.1 | P0 | Deep Research target-scoped OOPIF/frame report capture and incomplete-result rejection |
| 32.2 | P1 | ChatGPT model picker/current Intelligence pill audit |
| 32.3 | P1 | Existing `query --session` later-session follow-up parity hardening |
| 32.4 | P2 | Profile-copy login reuse decision record |

## P — Plan

### Part 1 — Easy Explanation

Deep Research should save the final report from the current run only. It should
not save a planning card, progress text, a normal answer that happened after a
failed tool selection, or a report from another tab. After that, agbrowse should
harden and document the existing `query --session` later-session path so it is
as clear and fail-closed as Oracle's `--followup <browser-session>` behavior.

### Part 2 — Diff-level Precision

## 32.1 — P0 Deep Research Capture

#### MODIFY `web-ai/chatgpt-deep-research.mjs`

Current shape:

- `extractResearchReport(page, deps)` reads latest assistant text first.
- If no text exists, it scans `page.frames()` for URLs containing
  `deep-research` or `research`.
- Timeout path may save whatever final frame/text exists.

Required change:

- Add a report-selection helper that prefers a completed page-scoped target
  read over legacy frame fallback.
- Reject incomplete report text before saving.
- Treat a normal assistant answer without observed research activity as
  `deep-research-not-started`.
- Scope frame/target reads to turns after the submitted prompt baseline.

Suggested exported helpers for tests:

```js
export function isIncompleteDeepResearchText(text) {}
export function chooseDeepResearchReportRead(targetRead, frameRead) {}
export function normalizeDeepResearchReportText(text) {}
```

Suggested internal result shape:

```js
{
  completed: true,
  inProgress: false,
  text: '...',
  sources: [],
  from: 'target' // 'target' | 'frame' | 'assistant'
}
```

Implementation notes:

- Keep `autoConfirmPlan(page, timeoutMs = 70_000)` unchanged unless tests prove
  it blocks the target-scoped capture.
- Preserve existing `trySaveReport()` and `appendArtifactRecord()` behavior.
- Do not introduce browser-wide target enumeration that can harvest another
  tab's report.
- If CDP target attach is not available in the Playwright-only dependency
  surface, implement the read-selection helpers first and leave target attach as
  an explicit follow-up inside this same file.

#### NEW `test/unit/web-ai-deep-research-report-selection.test.mjs`

Required tests:

- Completed target read wins over completed frame read.
- Completed frame read wins when target read is missing.
- Planning/status/progress text is not treated as completed.
- Normal non-research answer after a failed Deep Research activation fails with
  `deep-research-not-started`.
- Stale frame before baseline is ignored.
- Existing `autoConfirmPlan()` tests still pass.

#### MODIFY `test/unit/web-ai-chatgpt-deep-research.test.mjs`

Keep current iframe Start-card tests. Add only small assertions for the exported
helpers if the new helper file is not enough.

## 32.2 — P1 Model Picker Audit

#### AUDIT `web-ai/chatgpt-model.mjs`

Current agbrowse already has:

- simplified Intelligence menu support
- Pro/Thinking effort verification
- legacy Pro row rejection via `isLegacyProModelLabel(text)`
- split-pill guardrails for standalone Heavy effort labels

Audit against Oracle 0.14.1/0.15.0 before patching:

- current Intelligence pill wait before defaulting
- bounded retries for explicit model selection
- Instant row support in simplified picker layouts
- wrapper-row rejection in Intelligence dialog
- failure envelope when requested effort cannot be verified

Patch only if the audit finds a gap.

#### IF PATCH NEEDED: MODIFY `web-ai/chatgpt-model.mjs`

Expected patch direction:

- Add bounded retry around `readCheckedModelEvidence()` after clicking.
- Add helper to wait for current Intelligence pill text to settle.
- Keep model-selection failures fail-closed when explicit model/effort was
  requested.

#### TESTS

Target:

```bash
npx vitest run test/unit/web-ai-chatgpt-model.test.mjs
```

Add cases only for newly found gaps. Do not duplicate already-covered split-pill
and effort tests.

## 32.3 — P1 Existing Later-session Follow-up Parity

#### MODIFY `web-ai/cli.mjs`

Do not add a parallel command surface by default. The existing later-session
send path is:

```text
agbrowse web-ai query --session <sessionId> --prompt <text> [--navigate]
```

Existing implementation references:

- help text distinguishes same-command `--follow-up` from later-session
  `query --session`
- `runBoundSendOrQuery(command, deps, input)` binds `send`/`query` to a persisted
  session
- `withSessionPage()` resolves the saved page/target before mutation

Required changes:

- Add or tighten validation so `query --session` rejects provider root URLs,
  external URLs, and missing saved conversation URLs before prompt insertion.
- Improve errors so mismatch recovery points to the exact
  `query --session <id> --navigate --prompt <text>` shape when a follow-up prompt
  is being sent.
- Update help/docs/truth-table wording if this path should no longer be treated
  as deferred.
- Add a thin alias command only if user testing proves `query --session` remains
  too hard to discover.

#### MODIFY `web-ai/tab-recovery.mjs`

Reuse, do not replace:

- `resolveSessionPage(deps, sessionId, { allowNavigate })`
- `urlsCompatible(storedUrl, liveUrl)`
- `withSessionPage(deps, sessionId, fn)`

If needed, add:

```js
export function isSafeChatGptConversationUrl(url) {}
```

Rules:

- Must resolve a persisted session by exact `sessionId`.
- Must require `conversationUrl` or recoverable `originalUrl`.
- Must reject provider root URLs for follow-up sends.
- Must reject external URLs.
- Must fail closed on target mismatch unless `--navigate` is provided.
- Must not send into a different thread.

#### MODIFY `web-ai/chatgpt-multi-turn.mjs`

Reuse `sendMultiTurn(page, deps, { followUps, session })`.

Do not duplicate prompt insertion/polling logic in the CLI command. If
`query --session` already routes through the normal `queryWebAi()` path, only
add `sendMultiTurn()` reuse if the implementation chooses to model
later-session follow-up as an explicit single-turn follow-up rather than a
normal query in the existing conversation.

#### MODIFY `test/unit/web-ai-sessions-command.test.mjs`

Add parser/contract coverage:

- `query --session <id> --prompt <text>` remains documented.
- Missing `--prompt` fails before browser mutation for the later-session send
  path.
- `--navigate` is passed into session page resolution where recovery is
  authorized.
- Same-command `--follow-up` help remains clearly separate.

#### NEW or MODIFY `test/unit/web-ai-follow-up-session.test.mjs`

Add behavior coverage:

- Exact saved conversation succeeds.
- Root ChatGPT URL is rejected.
- Different conversation URL fails without `--navigate`.
- Closed target with saved conversation URL can recover only when navigation is
  authorized.

## 32.4 — P2 Profile-copy Decision

Oracle's `--copy-profile <dir>` copies an active signed-in Chrome profile into a
throwaway profile. agbrowse should not implement this automatically.

Decision record criteria:

- Implement only if shared `BROWSER_AGENT_HOME` or existing headed CDP reuse
  fails a real user workflow.
- Require platform-specific risk notes for Chrome Safe Storage/keychain/cookies.
- Reject remote/external CDP modes.
- Ensure cleanup on success, failure, and signal interruption.

If approved later, create a separate plan file because this touches Chrome
profile state and should be reviewed as a higher-risk browser lifecycle slice.

## A — Plan Audit Checklist

Audit must verify:

- Deep Research changes do not save stale reports from earlier turns.
- No browser-wide target scan is introduced without page-session scoping.
- Later-session follow-up reuses existing `query --session`, session recovery,
  and command-lock code.
- CLI command naming does not conflict with existing `--follow-up`.
- Model-picker patches are only added after audit evidence, not by assumption.
- Profile-copy remains a decision record unless explicitly approved.

## B — Build Slices

1. Implement Deep Research report-selection helpers and tests.
2. Wire helper into completion and timeout save paths.
3. Audit model picker and patch only proven gaps.
4. Harden/document existing `query --session` later-session follow-up around
   saved conversation guards and recovery guidance.
5. Add focused tests.
6. Update capability truth table only if public capability labels change.

## C — Check

Minimum verification:

```bash
npx vitest run test/unit/web-ai-chatgpt-deep-research.test.mjs test/unit/web-ai-deep-research-report-selection.test.mjs
npx vitest run test/unit/web-ai-chatgpt-model.test.mjs
npx vitest run test/unit/web-ai-sessions-command.test.mjs
npm run test:release-gates
git diff --check
```

If CLI help or public capability status changes, also run:

```bash
npm run gate:all
```

## D — Done Criteria

- Deep Research saves only completed current-run reports.
- Planning/progress/normal-answer fallbacks fail clearly instead of producing
  misleading report artifacts.
- Model picker changes, if any, are backed by tests.
- Existing `query --session` later-session follow-up sends only into exact saved
  conversations or fails with explicit recovery guidance.
- Profile-copy remains explicitly deferred or receives a separate approved plan.
- `structure/str_func.md` count snapshots are updated and
  `bash structure/verify-counts.sh` passes if implementation adds files or
  changes CLI/help/truth-table surfaces.
