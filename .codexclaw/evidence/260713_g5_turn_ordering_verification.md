# G5 turn ordering verification

Scope: `web-ai/chatgpt.mjs`

## Commands and output

```text
$ node --check web-ai/chatgpt.mjs
(no output; exit 0)

$ grep -n "doesAssistantFollowUser" web-ai/chatgpt.mjs
365:async function doesAssistantFollowUser(page) {
469:            const ordered = await doesAssistantFollowUser(page).catch(() => true);

$ git diff --check -- web-ai/chatgpt.mjs
(no output; exit 0)
```

## Judgment

PASS. The module parses successfully, the helper and polling-loop usage are present, and the scoped diff has no whitespace errors. The G5 guard runs before the existing stability block and treats DOM evaluation failures as non-blocking.
