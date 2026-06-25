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

**Gate so far:** full cli-jaw `npm test` → **4792 tests, 4774 pass, 0 fail**; tsc 0.

### Remaining Cycle-6 items (P1/P2, next continuations)
104.1 command-lock TTL/heartbeat/PID · 104.2 isSessionActive deadline-aware · 104.5 modelSelection
evidence · 104.7 legacy-pro reject · 104.8/.9 vendor capability+model probes · 104.10 code-extract nav ·
104.11 zip chronological order · 104.12 composer resolved-targets · 104.13 attachment filename-verify ·
104.14 composer CDP insertText · 104.16 typed code-mode error · 104.17 copy scroll-suppression ·
104.18 pollWebAi per-tick drift/crash · 104.20 occurrenceIndex · 104.21 contract-audit 7-feature ·
104.22 observation-bundle shape.

## Verification
Per-item gates above; A-phase audit (Cycle 1) confirmed these as line-diff divergences.
