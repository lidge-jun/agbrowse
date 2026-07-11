# Upload reliability — verification evidence

Date: 2026-07-11
Node: v24.17.0 (/opt/homebrew/bin/node), vitest 2.x

## Success criteria → evidence

1. **Focused suites pass (0 failures).**
   `npx vitest run test/unit/chatgpt-upload-surface.test.mjs
   test/unit/chatgpt-attachments.test.mjs test/unit/web-ai-composer.test.mjs
   test/unit/chatgpt-sent-verify.test.mjs test/unit/web-ai-tool-schema.test.mjs
   test/unit/web-ai-tool-validation.test.mjs
   test/integration/web-ai-cli-contract.test.mjs
   test/integration/web-ai-mcp-server.test.mjs
   test/integration/web-ai-fake-chatgpt.test.mjs`
   → `Test Files 9 passed (9) / Tests 123 passed (123)` (18:45 KST).

2. **100MB budget scaling proven.**
   `computeAttachmentTimeouts([{sizeBytes: 100*MiB}])` asserted
   `acceptanceMs > 400_000` and `<= 900_000`
   (test/unit/chatgpt-upload-surface.test.mjs, "scales the acceptance budget
   past 45s for a 100MB file"). 512MiB clamps at 900_000.

3. **False-success fail-closed proven.**
   test/unit/chatgpt-sent-verify.test.mjs: missing sent-turn evidence throws
   `provider.sent-attachment-missing`; `AGBROWSE_SENT_ATTACHMENT_POLICY=warn`
   restores warn-only. Strict acceptance: bare chip without filename/remove
   evidence no longer accepted ("does not accept a bare chip...", diagnostic
   `matched 0/1`); upload-error indicator rejects ("errors 1").

4. **CDP large-file path proven.**
   100MiB `attachLocalFileLive` uses `DOM.setFileInputFiles` with zero
   `setInputFiles` calls and records `attachment-cdp-set-file-input`;
   >50MB Playwright transfer error falls back to CDP; small files keep
   plain `setInputFiles`.

5. **Full suite (`npm test`) run once.**
   → `Test Files 2 failed | 161 passed | 2 skipped (165); Tests 1455 passed |
   17 skipped (1472)` (18:47-18:49 KST). The 2 failing FILES are
   `test/integration/post-action-smoke.test.mjs` and
   `test/integration/self-heal-smoke.test.mjs`, both failing in `beforeAll` at
   `chromium.launch`: `Executable doesn't exist at
   ~/Library/Caches/ms-playwright/chromium_headless_shell-1208/...` —
   machine-local missing Playwright browser binary, independent of this
   change set (no test assertions failed anywhere). Binary download was
   started to close the gap; see addendum below if re-run.

6. **Static analysis.**
   `npm run typecheck:checkjs` reports zero errors for
   `chatgpt-upload-surface.mjs` / `chatgpt-attachments.mjs` (remaining
   checkjs errors are the pre-existing baseline in other modules, verified by
   stashing this change set and re-running).

## Red→green notes
- Acceptance-strictness and sent-turn-evidence tests were written against the
  new contract; they fail on the pre-change implementation by construction
  (old code returned ok on bare chips / generic img evidence — the exact
  false-success the community reported).
- The former fail-open behavior in chatgpt.mjs was source-asserted by
  test/unit/chatgpt-attachments.test.mjs (string check); the literal marker
  string remains in the warn-mode branch, so the assertion still holds while
  the default path is now fail-closed and covered by chatgpt-sent-verify.
