# G11 + G13 session artifact verification

## Scope

- Source under verification: `web-ai/session-artifacts.mjs`
- Requirements: SHA-256 of exact persisted bytes and validation metadata at all five artifact save sites.

## Checks

### Syntax

Command:

```sh
node --check web-ai/session-artifacts.mjs
```

Result: exit 0, no output.

### Patch whitespace

Command:

```sh
git diff --check -- web-ai/session-artifacts.mjs
```

Result: exit 0, no output.

### Runtime contract

The check imported `web-ai/session-artifacts.mjs` with a temporary `BROWSER_AGENT_HOME`, invoked transcript, report, image, generic file, empty file, and diagnostics saves, read each persisted file, independently computed SHA-256 with `node:crypto`, and asserted descriptor validation values.

Output:

```text
PASS: all five artifact save sites hash the exact persisted bytes
PASS: text, image, generic-file, empty-file, and diagnostics validation metadata match G13
```

Result: exit 0.

## Judgment

Verified. G11 hashes match the exact bytes persisted by all five save sites. G13 emits the required text, image, generic-file, and empty-file validation metadata. Syntax and diff whitespace checks are clean.
