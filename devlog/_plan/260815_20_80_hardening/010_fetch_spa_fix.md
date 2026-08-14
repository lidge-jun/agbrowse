# 010 - Fix adaptive-fetch SPA content extraction

## Problem

agbrowse fetch on SPA URLs (ChatGPT, etc.) returns backend API JSON
instead of rendered page content.

## File Change Map

### skills/browser/adaptive-fetch/browser-escalation.mjs
- Add isSpaInternalEndpoint() filter alongside isAuthEndpoint/isTrackingEndpoint
- Patterns: /backend-api/, /backend-anon/, /api/auth/, /_next/data/
- Increase post-navigation wait for SPA detection heuristic

### skills/browser/adaptive-fetch/content-scorer.mjs
- Add JSON-blob penalty: if text is valid JSON and source is network_api,
  apply score penalty (raw API response, not user content)

### test/unit/browser-adaptive-fetch-session.test.mjs (or new test file)
- Test: SPA internal endpoint URLs are filtered from network candidates
- Test: JSON blob network_api candidates score lower than browser-render
- Test: browser-escalation waits for SPA content after minimal innerText

## Accept Criteria

- New isSpaInternalEndpoint filters /backend-api/*, /backend-anon/*, /_next/data/*
- JSON network_api candidates get score penalty
- SPA pages get extended render wait (up to 3s polling if innerText < 200 chars)
- All existing tests pass
- New test file covers the three fix components

## Non-goals

- Full SPA rendering framework
- Playwright-style waitForSelector
- Changes to user-session or human-loop phases
