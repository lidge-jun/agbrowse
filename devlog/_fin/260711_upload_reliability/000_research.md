# Upload reliability — research (community reports 260711)

Date: 2026-07-11
Class: C3 (cross-module; MCP/CLI contract edges treated with C4 care)
Reports: DC gallery comments (거북쓰) — 40-100MB uploads fail on timeout,
agent sometimes splits files itself, and agbrowse reports "sent" when the
file was never transferred. PR #82 (merged, v0.1.18) made the handoff
timeout configurable but explicitly deferred the >50MB strategy.

## Root causes (file:line, evidence from 2 parallel explorer passes)

### RC1 — Playwright connectOverCDP 50MB hard limit (primary)
- agbrowse attaches via `chromium.connectOverCDP` (`skills/browser/browser.mjs:975`,
  `skills/browser/tab-manager.mjs:112`). Playwright treats CDP-attached browsers
  as remote: `setInputFiles` streams file bytes over the driver websocket and
  rejects files >50MB (upstream microsoft/playwright#34192, open as of 2026-07).
- Consequence: >50MB fails outright regardless of timeout; 40-50MB streams
  slowly and used to blow the old 10-15s handoff timeout (PR #82 symptom).
- Key fact: Chrome is ALWAYS local (127.0.0.1), so raw CDP
  `DOM.setFileInputFiles` with a local absolute path transfers zero bytes,
  has no size limit, and completes instantly. `newCDPSession` plumbing already
  exists (`web-ai/cli.mjs:1035`, `web-ai/ax-snapshot.mjs:263`).

### RC2 — no timeout scales with file size
- `sendButtonTimeoutMs()` is binary 20s/45s (`web-ai/chatgpt-attachments.mjs:206`).
- Acceptance wait fixed 45s single / 60s batch
  (`web-ai/chatgpt-attachments.mjs:243`, `:307`); at 10Mbps a 100MB upload
  needs ~80s transfer alone, so acceptance fires first.
- PR #82's `attachmentUploadTimeoutMs` covers only the setInputFiles handoff.

### RC3 — false success is fail-open by design
- Post-send `verifySentTurnAttachmentLive` failure is downgraded to a warning
  and the call still returns `ok:true, status:'sent'`
  (`web-ai/chatgpt.mjs:282-295`); a unit test locks the fail-open in
  (`test/unit/chatgpt-attachments.test.mjs` source-content assertion).
- Acceptance fallback passes on ANY attachment-like chip + no progress
  indicator, without filename/count evidence
  (`web-ai/chatgpt-attachments.mjs:123-148`, `:340`).
- Sent-turn fallback accepts any `img`/`[role="img"]` in the last user turn
  (`web-ai/chatgpt-attachments.mjs:361-373`).
- `submitPromptFromComposer` blind-presses Enter when no enabled send button
  is found (`web-ai/chatgpt-composer.mjs:172` area), bypassing the
  upload-in-progress disabled state.

### Non-cause
- agbrowse never splits files; the observed "splitting" is the calling agent
  reacting to 50MB failures (`web-ai/context-pack/builder.mjs:79` packs, never
  shards).

## Provenance (cxc-search)
- Tier 2: PR #82 body + diff (github.com/lidge-jun/agbrowse/pull/82, opened).
- Tier 2: playwright#34192 "Cannot transfer files larger than 50Mb to a
  browser not connected locally" (opened, confirmed open upstream).
- Tier 1→2: repo issue list checked via GitHub API — no other open upload issue.
