# 60 — Cycle (cli-jaw (.ts))

> Part of [00_plan.md](00_plan.md) · Goal `68727b6d-d01` · **Status: ⬜ PENDING (stub — diff-level detail filled at this cycle's P/B phase)**

## Target
- **Repo / lang:** cli-jaw (.ts)
- **Severity:** P1/P2
- **Gate command:** `npm test + npx tsc --noEmit`

## Gaps in scope
104.1-.18 session/active locks, model evidence + Korean i18n + legacy-pro reject, code-mode navigate-to-conversation, composer resolver-verified targets, attachment filename-verify (not count-only), gemini/grok runtime capability+model probes

> Note: 104.3 (watcher lock) + 104.19 (AX CDP fallback) were done in Cycle 5.

## Build log (cli-jaw branch `feat/webai-parity-100-260625`)

- **104.6 — Korean-locale model menu** — ✅ DONE — cli-jaw `21e115a0`
  - `normalizeModelPickerText` made Unicode-aware (`\p{L}\p{N}`) so Korean labels survive (they
    were stripped to '' and collided); Korean added to `CHATGPT_MODEL_OPTIONS`, `modelChoiceFromText`,
    the model-pill button pattern, the menu-open regex, `modelLabelPattern`. Tests BWAI-MODELI18N-001/002.
- **104.15 — `wrapError` field preservation** — ✅ DONE — cli-jaw `b0961de6`
  - A plain error-like object with a string `errorCode` keeps its fields instead of flattening to
    `internal.unhandled` (fallback still overrides). Tests BWAI-WRAPERR-001/002.
- **104.1 + 104.2 — session-store lock PID-liveness + deadline-aware active** — ✅ DONE — cli-jaw `0c47cdf5`
  - `isStaleLock` now reclaims a crashed holder's lock immediately (PID-liveness) vs acquiredAt-age only;
    `isSessionActive` extracted + deadline-aware (expired sessions inactive). Tests BWAI-SLOCK-001/002.
- **104.5 — model-selection evidence (P1)** — ✅ DONE — cli-jaw `efcce949`
  - `ChatGptModelSelectionEvidence` + `createModelSelectionEvidence`, returned from `selectChatGptModel`,
    + `modelSelection` on `WebAiSessionRecord`/`updateSessionResult`, persisted after send-path
    `createSession`. Test BWAI-MODELSEL-001.
- **104.7 — legacy-pro reject** — ⏸️ DEFERRED. cli-jaw's `isLegacyProModelLabel` rejects effort-pill
  labels (Standard/Extended Pro/Heavy); agbrowse's rejects legacy GPT-5.x-Pro *model rows* — different
  purposes. Matching agbrowse risks breaking cli-jaw's effort handling; needs deeper model-flow review.

- **104.20 — occurrenceIndex on interactive refs** — ✅ DONE — cli-jaw `768386d6`
  - per-(role,name) occurrence counts in both ref builders → 0-based `occurrenceIndex` on `ElementRef`.
    Test BWAI-OCCUR-001.
- **104.22 — observation-bundle element-ref filter + id/basis** — ✅ DONE — cli-jaw `4d285c80`
  - `isElementRef` (`@?e\d+`) accepts bare `e3`, rejects `@x`; emits `observationId`/`targetId`/`basis`.
    Test BWAI-OBSBUNDLE-001.

- **104.11 — zip scan chronological order** — ✅ DONE — cli-jaw `ce3ac51a`
  - `orderedConversationMessages` (create_time/update_time then mapping order) used by both zip scans →
    the resolved zip is the most-recent one deterministically. Test BWAI-ZIPORD-001.
- **104.16 — typed code-mode error + zip write-guard** — ✅ DONE — cli-jaw `afa61347`
  - `codeWebAi`/`extractCodeArtifacts` throw typed `code-mode.vendor-unsupported`; `downloadAndSaveZip`
    write wrapped → `code-artifact:write-failed`. Test BWAI-CODEMODE-001.

- **104.21 — contract-audit shared 7-feature contract + excludeNames** — ✅ DONE — cli-jaw `05112f52`
  - audit against `editorContractForVendor(vendor).semanticTargets` (catches responseFeed/streamingIndicator
    drift) + honours `excludeNames` (a "search" textbox no longer false-satisfies composer); forked
    `CONTRACTS` map removed. Existing test reworked + new excludeNames case.

- **104.13 — attachment filename-verify (P1)** — ✅ DONE — cli-jaw `7ab682b3`
  - `buildAttachmentReadyExpression` verifies the SPECIFIC uploaded files appear in chips
    (name/stem in text/attrs), not chip-count only; threaded from the single-file upload path.
    Test BWAI-ATTACH-001.

- **104.10 — code-extract navigates to the target conversation (P1)** — ✅ DONE — cli-jaw `437526cb`
  - `resolveConversationUrl` + `shouldNavigateForExtraction` (origin + convo-id compare); extract
    navigates to `chatgpt.com/c/<id>` first → `code-extract.navigation-failed` on error; untrusted ref
    rebuilt from id. Tests BWAI-CODENAV-001/002.

- **104.17 — copy scroll-jump suppression** — ✅ DONE — cli-jaw `41081655`
  - copy evaluate patches `scrollIntoView`→noop + `focus`→preventScroll around the copy, restored in
    finally. Browser-only behavior → verified by tsc + no-regression (no unit test); GPT-Pro live gate covers it.

**Gate so far:** full cli-jaw `npm test` → **4803 tests, 4785 pass, 0 fail**; tsc 0.

### Remaining Cycle-6 items (next continuations — browser-context-heavy)
104.8/.9 vendor capability+model probes · 104.12 composer resolved-targets · 104.14 composer CDP insertText ·
104.18 pollWebAi per-tick drift/crash. (104.7 deferred.)

## Verification
Per-item gates above; A-phase audit (Cycle 1) confirmed these as line-diff divergences.
