# WP5 Shared-File Patches (Worker B -> Worker A handoff)

These patches implement the remaining 05_pro_timeout_budget.md changes in files
owned by Worker A. Anchored on function/variable names rather than line numbers
to survive concurrent Worker A edits.

## 1. `web-ai/chatgpt.mjs` — initial submit deadline resolver is already tier-aware

**Status: NO PATCH NEEDED.**

`resolveDeadlineAt(input, 'chatgpt')` at the `createSession()` call inside
`sendWebAi()` now automatically derives the tier from `input.model` and
`input.research` because Worker B updated `resolveDeadlineAt()` in session.mjs
to call `resolveTimeoutDefaultSec()` instead of the hardcoded vendor default.

The anchor:
```js
// inside sendWebAi(), around the createSession call:
    const session = createSession(envelope, {
        ...
        deadlineAt: resolveDeadlineAt(input, 'chatgpt'),
```

No source change required. The behavioral change flows from session.mjs.

## 2. `web-ai/chatgpt.mjs` — single-poll fallback (~327-329)

### Context anchor
```js
export async function pollWebAi(deps, input = {}) {
    const vendor = input.vendor || 'chatgpt';
    const timeout = Math.max(1, Number(input.timeout || 1200));
```

### Required change
The `input.timeout || 1200` fallback ignores stored deadline remainder and tier.
Replace with `resolveTimeoutBudgetSec`:

```js
// BEFORE:
    const timeout = Math.max(1, Number(input.timeout || 1200));

// AFTER:
    const timeout = Math.max(1, Number(input.timeout) > 0
        ? Number(input.timeout)
        : (() => {
            const session = input.session ? getSession(input.session) : null;
            return resolveTimeoutBudgetSec(input, session, vendor);
        })(),
    );
```

Add `resolveTimeoutBudgetSec` to the session.mjs import:
```js
import {
    ...existing imports...,
    resolveTimeoutBudgetSec,
} from './session.mjs';
```

**Simpler alternative** (if the call site already has a session variable available
by the time Worker A restructures): just pass it directly without the IIFE.

### Regression test (lives in a Worker A test file or new file)
```js
it('pollWebAi uses stored deadline remainder when timeout is omitted', () => {
    // Source contract: pollWebAi's timeout line references resolveTimeoutBudgetSec
    // or no longer contains the literal `|| 1200` fallback.
    const src = readFileSync(new URL('../../web-ai/chatgpt.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/const timeout\s*=\s*Math\.max\(1,\s*Number\(input\.timeout\s*\|\|\s*1200\)\)/);
});
```

## 3. `web-ai/cli.mjs` — CLI default injection (~651-657)

### Context anchor
```js
    const input = {
        ...
        // When --timeout is omitted, default scales by model tier (instant 120s,
        // thinking 600s, pro/deep-research 3600s) so a long pro run is not capped
        // at the legacy 1200s. An explicit --timeout still wins.
        timeout: values.timeout != null
            ? values.timeout
            : resolveTimeoutDefaultSec({ model: values.model, research: values.research }, values.vendor || 'chatgpt'),
```

### Required change
For `send`/`query` (initial submit), the tier default injection is correct and
needed. But for `poll`/`watch`/`sessions resume`, omitting timeout is the right
behavior so that `resolveTimeoutBudgetSec` in the poll path can inherit stored
deadline remainder.

```js
// BEFORE:
        timeout: values.timeout != null
            ? values.timeout
            : resolveTimeoutDefaultSec({ model: values.model, research: values.research }, values.vendor || 'chatgpt'),

// AFTER:
        timeout: values.timeout != null
            ? values.timeout
            : (command === 'send' || command === 'query')
                ? resolveTimeoutDefaultSec({ model: values.model, research: values.research }, values.vendor || 'chatgpt')
                : undefined,
```

Update the comment to reflect the new 3-split tiers:
```js
        // When --timeout is omitted on send/query, default scales by model tier
        // (instant 120s, thinking 600s, chatgpt-pro 5400s, grok-heavy 3600s,
        // deep-research 3600s). For poll/watch/resume, timeout stays undefined
        // so the budget resolver inherits stored session deadline remainder.
```

### Regression test (for test/unit/web-ai-timeout-default.test.mjs — WP5-PENDING-SHARED)
```js
it.todo('WP5-PENDING-SHARED: CLI poll/watch/resume preserve undefined timeout', () => {
    // Verify cli.mjs source: for poll/watch/sessions commands, values.timeout=undefined
    // produces input.timeout=undefined (not tier default).
    const src = readFileSync(new URL('../../web-ai/cli.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/command\s*===\s*'send'\s*\|\|\s*command\s*===\s*'query'/);
});
```

## 4. `web-ai/mcp-server.mjs` — MCP wait/resume resolver (~259-264)

### Context anchor
```js
async function runMcpSessionPoll(name, args, deps) {
    ...
            return withMcpActiveCommand(name, provider, sessionDeps, sessionArgs, () =>
                pollByProvider(provider, sessionDeps, {
                    ...args,
                    vendor: session.vendor || provider,
                    session: session.sessionId,
                    timeout: args.timeout,
                }),
```

### Required change
Replace `args.timeout` with `resolveTimeoutBudgetSec` so that MCP wait/resume
inherits stored deadline remainder when timeout is omitted:

```js
// BEFORE:
                    timeout: args.timeout,

// AFTER:
                    timeout: resolveTimeoutBudgetSec(
                        args,
                        session,
                        session.vendor || provider,
                    ),
```

Add `resolveTimeoutBudgetSec` to the session.mjs import in mcp-server.mjs:
```js
import { ..., resolveTimeoutBudgetSec } from './session.mjs';
```

### Regression test (lives in test/integration/web-ai-mcp-server.test.mjs or equivalent)
```js
it('MCP wait/resume uses stored deadline remainder, not raw args.timeout passthrough', () => {
    const src = readFileSync(new URL('../../web-ai/mcp-server.mjs', import.meta.url), 'utf8');
    // The runMcpSessionPoll function should reference resolveTimeoutBudgetSec
    expect(src).toMatch(/runMcpSessionPoll[\s\S]*?resolveTimeoutBudgetSec/);
    // And should NOT pass raw args.timeout to pollByProvider
    const pollBlock = src.match(/pollByProvider\([\s\S]*?\)\s*\)/)?.[0] || '';
    expect(pollBlock).not.toMatch(/timeout:\s*args\.timeout\s*[,)]/);
});
```

## 5. `web-ai/tool-schema.mjs` — timeout descriptions

### Context anchor
```js
    web_ai_submit_prompt: {
        ...
            timeout: { type: 'number' },
    ...
    web_ai_wait_response: {
        ...
            timeout: { type: 'number' },
    ...
    web_ai_session_resume: {
        ...
            timeout: { type: 'number' },
```

### Required change
Add descriptions and minimum to timeout fields. Do NOT embed specific tier
values (5400, 3600) in schema text.

```js
// For web_ai_submit_prompt:
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit submit timeout in seconds; overrides the selected tier default.',
            },

// For web_ai_wait_response:
        description: 'Wait for a stored provider session response. When timeout is omitted, inherit the remaining stored session deadline before tier/vendor fallback; preserve sessionId after a recoverable timeout.',
        ...
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit wait timeout in seconds; overrides the remaining stored session deadline.',
            },

// For web_ai_session_resume:
        description: 'Resume a stored provider session through session-bound recovery. When timeout is omitted, inherit the remaining stored session deadline before tier/vendor fallback.',
        ...
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit resume timeout in seconds; overrides the remaining stored session deadline.',
            },
```

### Regression test (for test/unit/web-ai-timeout-default.test.mjs — WP5-PENDING-SHARED)
```js
it.todo('WP5-PENDING-SHARED: tool schema timeout fields have minimum:1 and descriptions', async () => {
    const { toolSchemaForMcp } = await import('../../web-ai/tool-schema.mjs');
    const schemas = toolSchemaForMcp();
    for (const name of ['web_ai_submit_prompt', 'web_ai_wait_response', 'web_ai_session_resume']) {
        const props = schemas[name].inputSchema.properties;
        expect(props.timeout.minimum).toBe(1);
        expect(props.timeout.description).toBeDefined();
        expect(props.timeout.description).not.toMatch(/40\s*min|2400/);
    }
});
```

## Summary

| File | Patch needed? | Depends on |
| --- | --- | --- |
| `web-ai/chatgpt.mjs` createSession | No (flows from session.mjs) | session.mjs already applied |
| `web-ai/chatgpt.mjs` pollWebAi | Yes - import + timeout line | session.mjs resolveTimeoutBudgetSec |
| `web-ai/cli.mjs` | Yes - conditional default | session.mjs resolveTimeoutDefaultSec (already imported) |
| `web-ai/mcp-server.mjs` | Yes - import + timeout line | session.mjs resolveTimeoutBudgetSec |
| `web-ai/tool-schema.mjs` | Yes - descriptions + minimum | None |
