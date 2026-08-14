# 050 CLI Architecture Split (H-011)

## New modules extracted from browser.mjs:
- skills/browser/browser-lifecycle.mjs (start/stop/connect/status)
- skills/browser/command-router.mjs (command dispatch)
- browser.mjs becomes thin shell importing the above

## Constraint: backward compatible, same CLI interface
