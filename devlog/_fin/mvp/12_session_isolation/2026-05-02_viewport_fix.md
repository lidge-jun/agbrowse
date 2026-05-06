# Browser Launch Minimum Viewport Fix

## Problem
Playwright `locator.click()` fails with "element is not stable" when Chrome window is too small, causing responsive layout shifts in Grok UI.

## Root Cause
- Chrome defaults to a small window size on launch
- Grok's responsive layout shifts buttons when viewport < 1280px
- Playwright considers moving elements "not stable" and refuses to click

## Solution

### 1. skills/browser/browser.mjs — launchChrome()
Added minimum window size enforcement:
```javascript
const minWidth = Math.max(opts.width || 1440, 1280);
const minHeight = Math.max(opts.height || 900, 720);

// Chrome launch args:
`--window-size=${minWidth},${minHeight}`
```

### 2. web-ai/grok-live.mjs — clickGrokSubmit()
Added defensive click strategy:
```javascript
await button.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
await button.click({ timeout: 3_000, force: true });
```

- `scrollIntoViewIfNeeded()` — ensures button is in viewport
- `force: true` — bypasses Playwright's "element is not stable" check
- `catch(() => {})` — non-blocking; if scroll fails, click still proceeds

## Verification
- Launch Chrome with `--window-size=1280,720` minimum
- Grok submit button no longer gets "element is not stable"
- `force: true` ensures click succeeds even during minor layout shifts

## Impact
- Fixes Grok submit instability in agbrowse
- Prevents similar issues with other responsive UIs (ChatGPT, Gemini)
- No breaking changes — only enforces minimum window size

## Date: 2026-05-02
