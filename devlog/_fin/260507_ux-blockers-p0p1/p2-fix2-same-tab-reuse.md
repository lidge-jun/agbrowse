# Fix 2 — Same-Tab Reuse: Session-Aware Default

**Priority: P2** | **Status: planned** | **Audit: Rounds 1-4 PASS**

## Files

| File | Action |
|------|--------|
| `web-ai/cli.mjs` | MODIFY |

## Problem

When resuming a session with `--session`, agbrowse opens a new tab by default instead of reusing the session's existing tab. This causes the session to lose its tab binding.

## Diff

### MODIFY `web-ai/cli.mjs`

```diff
-        newTab: values['new-tab'] === true || values.parallel === true || (['send', 'query'].includes(command) && values['reuse-tab'] !== true && process.env.AGBROWSE_REUSE_TAB !== '1'),
+        newTab: values['new-tab'] === true || values.parallel === true || (['send', 'query'].includes(command) && values['reuse-tab'] !== true && !values.session && process.env.AGBROWSE_REUSE_TAB !== '1'),
```

When `--session` is provided, `newTab` defaults to `false` so the session reuses its bound tab.
