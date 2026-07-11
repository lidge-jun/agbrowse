# Upload reliability — implementation record

Date: 2026-07-11
Base: `dev` bd8f8f1 + cherry-picked #82 (cbb4aa2, `fix(web-ai): make attachment upload timeout configurable`)
Execution: WP3 by parallel sol worker (Russell); WP1+WP2 by main session after
the first WP1 worker dispatch produced no output in 15 minutes and was retired
(DISPATCH-RETIRE-01); WP4 by main session.

### web-ai/chatgpt-upload-surface.mjs — CDP injection + size-aware budgets
- **Changes**: added `setInputFilesViaCdp()` (raw CDP `DOM.getDocument` →
  `DOM.querySelector` → `DOM.setFileInputFiles` with resolved local paths,
  session detached in finally; degrades to `{ok:false}` without a CDP session);
  `setInputFilesResilient()` (CDP-first at `CDP_INJECTION_THRESHOLD_BYTES` =
  45MiB, retry-via-CDP when Playwright throws the /50 ?mb|larger than/i
  transfer error, otherwise plain `setInputFiles`); `computeAttachmentTimeouts()`
  (handoff: explicit #82 option/env wins, else 60s + bytes/5MiBps capped 300s;
  acceptance: 45s/60s base + bytes/250KiBps capped 900s with
  `AGBROWSE_ATTACHMENT_ACCEPT_TIMEOUT_MS` floor; sendReady: 20s no files, else
  45s + bytes/1MiBps capped 300s). `setFilesOnDiscoveredInput` and the
  upload-menu path now route through `setInputFilesResilient` and carry
  `totalBytes`/`usedFallbacks`.
- **Impact**: `web-ai/chatgpt-attachments.mjs` (importer), Grok/Gemini surface
  callers unchanged (options object is additive).
- **Verification**: `npx vitest run test/unit/chatgpt-upload-surface.test.mjs`
  (20 tests) + focused 9-suite run, 123 passed; `typecheck:checkjs` clean for
  this file.

### web-ai/chatgpt-attachments.mjs — budgets wired + evidence hardening
- **Changes**: `attachLocalFileLive`/`attachLocalFilesLive` use
  `computeAttachmentTimeouts` for handoff + acceptance and inject via
  `setInputFilesResilient`; `sendButtonTimeoutMs(fileNames, totalSizeBytes=0)`
  is size-aware (legacy single-arg shape preserved: 45s floor);
  `buildAttachmentReadyExpression` gained upload-error detection
  (`errorCount`) and requires zero errors; `waitForAttachmentAcceptedLive` no
  longer accepts a bare chip when script evaluation is available — filename or
  remove-control evidence is required, timeout errors carry a diagnostic
  (matched/chips/remove/progress/errors); `verifySentTurnAttachmentLive`
  counts generic `img`/`[role="img"]` nodes only for image attachments.
- **Impact**: `web-ai/chatgpt.mjs` (caller, sizes passed by WP3), unit-test
  doubles without `evaluate` keep the legacy generic-chip path.
- **Verification**: `test/unit/chatgpt-attachments.test.mjs` (14) +
  `test/unit/chatgpt-upload-surface.test.mjs` strict-evidence cases.

### web-ai/chatgpt.mjs — fail-closed sent verification (WP3, sol worker)
- **Changes**: post-submit verification extracted to `verifySentAttachments()`;
  missing sent-turn evidence now throws `WebAiError`
  `provider.sent-attachment-missing` (stage `attachment-verify`, retryHint
  `re-upload`); `AGBROWSE_SENT_ATTACHMENT_POLICY=warn` restores warn-only
  (keeps `sent-attachment-evidence-unavailable` fallback marker);
  `submitTimeoutMs` fed with total upload bytes; submit result checked for
  `send-button-disabled` → `provider.send-click`.
- **Impact**: CLI/MCP verdicts — false `status:'sent'` for unverified
  attachments is no longer possible by default.
- **Verification**: `test/unit/chatgpt-sent-verify.test.mjs` (fail-closed +
  warn-mode), `test/integration/web-ai-fake-chatgpt.test.mjs`.

### web-ai/chatgpt-composer.mjs — no blind Enter with attachments (WP3)
- **Changes**: `ComposerOptions.requireEnabledSendButton`; when set and no
  enabled send button appears, returns `{ method:'none',
  failure:'send-button-disabled' }` instead of pressing Enter. Legacy Enter
  fallback intact without the option.
- **Impact**: `chatgpt.mjs` submit path; other vendors unaffected.
- **Verification**: `test/unit/web-ai-composer.test.mjs` (11 tests).

### skills/web-ai/SKILL.md — File Upload doc
- **Changes**: documented CDP large-file injection, size-scaled budgets, env
  overrides, and the fail-closed sent-evidence policy.
- **Impact**: agent-facing usage doc only.
- **Verification**: n/a (docs).

## Pre-write search evidence (DEV §1.5)
- `rg "setFileInputFiles|newCDPSession"` — reused the existing CDP-session
  pattern (`web-ai/ax-snapshot.mjs:254-263`); no duplicate helper existed.
- `rg "computeAttachmentTimeouts|clamp"` in web-ai/ — no prior timeout-budget
  owner; placed next to `resolveAttachmentUploadTimeoutMs` (#82's owner file).
- `rg "requireEnabledSendButton"` — new option, no collision.
