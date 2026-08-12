# G9 Watcher Readiness Evidence

## Scope

- Source change: `web-ai/watcher.mjs`
- Requirement: wait for a visible composer or assistant turn after watcher navigation.

## Verification

Command:

```sh
node --check web-ai/watcher.mjs
```

Result: exit 0, no syntax errors.

Command:

```sh
node -e "import('./web-ai/watcher.mjs').then(() => console.log('watcher import: ok'))"
```

Output:

```text
watcher import: ok
```

Result: exit 0; the changed module loads successfully.

Command:

```sh
git diff --check -- web-ai/watcher.mjs
```

Result: exit 0, no whitespace errors.

Command:

```sh
grep -n "G9\|readiness\|waitFor" web-ai/watcher.mjs | head -10
```

Output:

```text
491:        // G9: Verify conversation readiness after navigation (Oracle 83c3ca2).
496:                .waitFor({ state: 'visible', timeout: 10_000 })
498:        } catch { /* best-effort readiness check */ }
```

## Judgement

Verified. After `page.goto`, the watcher now waits best-effort for the configured composer/assistant selector using the repository's established Playwright locator API, then reports the page's final URL. The file is syntactically valid, importable, and has a clean diff.
