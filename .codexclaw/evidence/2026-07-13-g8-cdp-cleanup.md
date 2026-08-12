# G8 CDP cleanup evidence

## Scope

- Source: `web-ai/tab-recovery.mjs`
- Change: close fresh CDP targets when `recoverSessionTab` fails after `createTab`, and when `openConversationInNewTab` cannot acquire the new page.

## Focused tests

Command:

```sh
npx vitest run test/unit/web-ai-tab-recovery.test.mjs test/unit/web-ai-open-conversation-newtab.test.mjs --reporter=verbose
```

Result: exit code 0.

```text
RUN  v3.2.6 /Users/jun/Developer/new/700_projects/agbrowse

Test Files  2 passed (2)
Tests       28 passed (28)
Duration    327ms
```

## Syntax check

Command:

```sh
node --check web-ai/tab-recovery.mjs
```

Result: exit code 0, no output.

## Diff check

Command:

```sh
git diff --check -- web-ai/tab-recovery.mjs
```

Result: exit code 0, no output.

## Requested proof

Command:

```sh
grep -n "G8\|closeTab.*catch" web-ai/tab-recovery.mjs
```

Output:

```text
128:        // G8: Clean up the newly created target on failure (Oracle 83c3ca2)
129:        await closeTab(port, newTab.targetId).catch(() => undefined);
369:            await closeTab(port, targetId).catch(() => undefined); // G8: close orphaned target
374:            await closeTab(port, targetId).catch(() => undefined);
379:        if (targetId) await closeTab(port, targetId).catch(() => undefined);
```

## Judgment

Verified. The newly created target is cleaned up before rethrowing any failure in the fresh-target section of `recoverSessionTab`. The `page-unavailable` branch in `openConversationInNewTab` also closes its orphaned target. Existing focused tests pass, and the edited module is syntactically valid with no whitespace errors.
