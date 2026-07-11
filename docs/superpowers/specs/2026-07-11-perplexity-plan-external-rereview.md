# Perplexity Web-AI Plan External Re-review Disposition

## Input

- Date reviewed: 2026-07-11
- Input: attached `Perplexity Web-AI TDD 작업지시서 재검토`
- Verdict received: `REJECT`
- Reviewed checkout baseline: `a4ef4f5`

## Applied Findings

1. Status now separates fixture-backed `supportsThinking` from selected-row
   live `thinkingControlPresent`; unselected models return `null` live state.
2. Perplexity conversation URLs use a raw canonical regex before WHATWG URL
   normalization, rejecting explicit `:443` and encoded UUID separators.
   Conversation-ID mismatch is handled by provider-aware URL compatibility.
3. Authenticated live captures and deterministic adversarial derivations are
   separate scripts and provenance kinds.
4. Model/switch clicks invalidate prior Locators; the plan reacquires fresh
   picker rows before Thinking inspection and final verification.
5. Bare and `www` hosts share one provider-URL identity across reusable-tab
   acquisition, driveability, readiness, recovery, and cleanup. The live
   canonical URL is persisted after redirects.
6. MCP `effort`/`reasoningEffort` aliases are resolved before target/page/tab
   mutex access, with canonical-equal aliases accepted and conflicts rejected.
7. Authenticated Thinking smoke allows 3,720 seconds around the 3,600-second
   provider deadline and records both deadline and watchdog evidence.

## Finding Not Applied

The review reported that
`2026-07-11-chatgpt-5.6-high-plan-rereview.md` was absent. It exists in the
current checkout and was created by commit `a4ef4f5`; the reviewed attachment
was stale on this point. The preflight now explicitly verifies both that record
and this disposition file so future archives fail immediately if provenance is
missing.

## Scope Note

`perplexity.ai` and `www.perplexity.ai` are not modeled as separate sites. The
bare hostname is an accepted redirect alias for provider identity, while the
browser's post-navigation `www` conversation URL is canonical session state.
