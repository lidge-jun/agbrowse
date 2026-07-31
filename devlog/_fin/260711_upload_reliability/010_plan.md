# Upload reliability — plan (loop spec)

Date: 2026-07-11
Class: C3, MCP/CLI contract edges at C4 care
Base: local `dev` (bd8f8f1) + cherry-picked #82 (cbb4aa2)

## Loop spec
- Archetype: spec-satisfaction repair loop (verifier = vitest suites).
- Goal: 40-100MB single-file uploads succeed on local-CDP Chrome; upload
  verdicts are fail-closed (no "sent" without sent-turn evidence); timeouts
  scale with bytes.
- Non-goals: Grok/Gemini upload rework (keep #82 plumbing intact), file
  auto-splitting, npm release, README marketing, committing .codexclaw state.
- Verifier: `npm test -- --run` focused suites + full suite once; red→green
  for flipped fail-open test.
- Terminal outcomes: DONE / BLOCKED / NEEDS_HUMAN / BUDGET_EXHAUSTED.
- Preflight note: `cxc` CLI absent in this environment — codexclaw goalplan
  binding impossible; this devlog unit is the evidence ledger. Host goal is
  ACTIVE (HOTL armed via host goal store).

## Work phases and ownership (disjoint write sets)

### WP1+WP2 — Worker A: injection + budgets (sol)
Files: `web-ai/chatgpt-upload-surface.mjs`, `web-ai/chatgpt-attachments.mjs`,
`test/unit/chatgpt-attachments.test.mjs`, new `test/unit/chatgpt-upload-surface.test.mjs`.
- `setInputFilesViaCdp(page, inputSel, filePaths)`: `page.context().newCDPSession(page)`
  → `DOM.getDocument`/`DOM.querySelector` → `DOM.setFileInputFiles` (local paths,
  zero transfer). CDP-first when totalBytes >= 45MB; also fallback when
  setInputFiles throws /50 ?mb|larger than/i. Degrade gracefully when
  `newCDPSession` is unavailable (unit-test fake pages).
- `computeAttachmentTimeouts(files, options)` in upload-surface:
  handoff = explicit/env (#82) else clamp(60s + bytes/5MiBps, 60s, 300s);
  acceptance = clamp(base 45s/60s + bytes/250KiBps, base, 900s) with
  `AGBROWSE_ATTACHMENT_ACCEPT_TIMEOUT_MS` floor override;
  sendReady = no files 20s, else clamp(45s + bytes/1MiBps, 45s, 300s).
- `sendButtonTimeoutMs(fileNames, totalSizeBytes = 0)` — size-aware,
  backward-compatible signature.
- Acceptance evidence: require filename match (or remove-control count AND
  chip count >= expected); generic any-chip fallback demoted to inconclusive.
- Sent-turn evidence: filename in last user turn attachment nodes; generic
  `img`/`[role="img"]` acceptance only for image attachments.

### WP3 — Worker B: fail-closed send path (sol)
Files: `web-ai/chatgpt.mjs`, `web-ai/chatgpt-composer.mjs`, their unit tests
(NOT `test/unit/chatgpt-attachments.test.mjs`).
- Post-send verify failure → throw `WebAiError` errorCode
  `provider.sent-attachment-missing`, stage `attachment-verify`,
  retryHint `re-upload`. Escape hatch env
  `AGBROWSE_SENT_ATTACHMENT_POLICY=warn` restores warn-only.
- `submitTimeoutMs` computed with total upload bytes.
- No blind Enter when uploads exist: `requireEnabledSendButton` option; on
  disabled-timeout return a typed failure that chatgpt.mjs converts to
  `WebAiError` stage `send-click`.

### WP4 — Main session: integration
Files: `test/unit/chatgpt-attachments.test.mjs` cross-file lock-in flip,
CLI/MCP touch-ups if contracts drift, devlog 020/030, full verification, commit.

## Success criteria
1. Focused suites + full `npm test` pass with 0 failures.
2. 100MB input yields acceptance budget > 45s (unit-proven).
3. Fail-open lock-in test flipped: missing sent-turn evidence now throws.
4. CDP injection path unit-covered incl. fallback ordering.
5. Devlog 000/010/020/030 complete with Change/Impact/Verification per file.
