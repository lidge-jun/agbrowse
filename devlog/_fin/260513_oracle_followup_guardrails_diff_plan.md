# Plan — Oracle follow-up guardrails

Status: plan only. Do not implement from this document without a fresh approval.

Date: 2026-05-13

Target repo: `/Users/jun/Developer/new/700_projects/agbrowse`

Reference repo: `/tmp/agbrowse-oracle-reference`

Reference point:

- Oracle main: `a1dbb13328dc75ef46a8b869618b4d5a8985c722`
- Oracle package version observed after pull: `0.11.1`
- Comparison basis: Oracle `v0.11.0..main` against agbrowse `5004d8b`

This plan covers the local agbrowse guardrail slice from the latest Oracle
follow-up review:

1. Current ChatGPT Pro row disambiguation while rejecting legacy Pro model rows.
2. Temporary Chat archive skip.
3. Strict but compatibility-aware `web_ai_*` MCP input validation.

Out of scope for this first slice:

- First-login private-profile diagnostics.
- Direct `--file` browser max-size cap.
- Nested current-UI attachment-chip hardening from Oracle PR #192.
- Oracle ZIP proposal. That is tracked separately in
  `devlog/_plan/260513_oracle_zip_bundle_proposal/00_proposal.md`.

## Part 1 — Easy Explanation

Oracle changed its browser automation guardrails again after the last agbrowse
sync. The important parts are not large features; they are correctness guards
around fragile web UI and MCP input boundaries.

This agbrowse slice should make three small but high-value behaviors explicit:

1. When the user asks for ChatGPT Pro, agbrowse should choose the current Pro
   picker row, not an older legacy model row whose label happens to contain
   "Pro", such as `GPT-5.4 Pro`.
2. Temporary Chat sessions should not be archived. They are intentionally
   non-durable, and trying to archive them creates misleading state.
3. MCP calls to `web_ai_*` should not accept arbitrary misspelled or unknown
   fields. The current validator is too relaxed because it disables
   `additionalProperties: false` at runtime. We still need to allow the known
   compatibility fields agbrowse already uses, such as `vendor`, `policy`,
   `filePath`, and `reasoningEffort`.

The goal is to preserve current user-facing behavior while removing ambiguity:
the right model row is clicked, temporary conversations are skipped by archive
policy, and MCP clients get immediate feedback when they send a wrong field.

## Part 2 — Diff-Level Precision

### Repository shape checked

Important files already present in agbrowse:

```text
web-ai/
  browser-tool-schema.mjs
  chatgpt-archive.mjs
  chatgpt-model.mjs
  mcp-server.mjs
  tool-schema.mjs
test/
  integration/
  unit/
devlog/
  _plan/
structure/
```

The local `structure/AGENTS.md` only governs `structure/`, not `devlog/`.

### Existing behavior facts

- `chatgpt-model.mjs` maps any text containing `Pro` or `Heavy` to `pro`, so a
  legacy row such as `GPT-5.4 Pro` can be confused with current Pro.
- `CHATGPT_OBSERVED_PRO_PILL_LABELS` is an array and current code uses
  `.includes(text)`. Do not plan `.has(...)` or `normalizeLabel(...)` without
  adding those symbols deliberately.
- `chatgpt-archive.mjs` has archive gates for disabled, missing URL,
  follow-up, deep research, project sessions, and incomplete sessions, but not
  Temporary Chat.
- `tool-schema.mjs` declares `additionalProperties: false` in schemas but
  runtime validation currently overrides it to `additionalProperties: true`.
- Tightening must keep documented compatibility fields: `provider`, `vendor`,
  `policy`, `filePath`, and `reasoningEffort`.
- Existing web-ai tools are `web_ai_snapshot`, `web_ai_click_ref`,
  `web_ai_submit_prompt`, `web_ai_wait_response`, `web_ai_copy_markdown`,
  `web_ai_doctor`, and `web_ai_session_resume`.
- Existing provider enum is `['chatgpt', 'gemini', 'grok']`.

## Slice A — ChatGPT Pro row disambiguation

### MODIFY `web-ai/chatgpt-model.mjs`

Add a label-normalization helper that can distinguish:

- Current Pro row labels: bare `Pro`, `ChatGPT Pro`, current UI variants.
- Legacy model rows: labels containing explicit older model names such as
  `GPT-5 Pro`, `GPT-5.1 Pro`, `GPT-5.2 Pro`, `GPT-5.3 Pro`, `GPT-5.4 Pro`.

Suggested helper shape:

```js
function normalizeModelPickerText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLegacyProModelLabel(text) {
  const normalized = normalizeModelPickerText(text);
  return [
    'gpt 5 pro',
    'gpt 5 0 pro',
    'gpt 5 1 pro',
    'gpt 5 2 pro',
    'gpt 5 3 pro',
    'gpt 5 4 pro',
  ].some((label) => normalized.includes(label));
}
```

Do not use a broad regex that accidentally rejects current `GPT-5.5 Pro`
labels. If current ChatGPT begins displaying `GPT-5.5 Pro`, that should remain
eligible.

Change `modelChoiceFromText` against the current function body so legacy Pro
labels return `null` before the generic Pro match:

```diff
 function modelChoiceFromText(text) {
   if (/\b(Instant|Fast)\b/i.test(text)) return 'instant';
+  if (isLegacyProModelLabel(text)) return null;
   if (/\b(Thinking|Think)\b/i.test(text)) return 'thinking';
   if (/\b(Pro|Heavy)\b/i.test(text)) return 'pro';
   return null;
 }
```

Change `isModelOptionCandidate` so legacy rows are explicitly rejected for
`choice === 'pro'` even if another code path later recognizes the text:

```diff
 async function isModelOptionCandidate(loc, choice) {
   const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
   if (!text) return false;
   if (isStandaloneEffortLabel(text) || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)) return false;
+  if (choice === 'pro' && isLegacyProModelLabel(text)) return false;
   return modelChoiceFromText(text) === choice;
 }
```

If `readActiveModelPill` or equivalent active-model parsing has a direct
`modelChoiceFromText` dependency, the earlier `modelChoiceFromText` change is
enough. Do not add duplicate logic unless a focused test proves a separate path
needs it.

### MODIFY `test/unit/web-ai-chatgpt-model.test.mjs`

Add focused unit coverage:

1. `modelChoiceFromText('GPT-5.4 Pro')` does not classify as current `pro`.
2. `modelChoiceFromText('Pro')` still classifies as `pro`.
3. A simulated picker containing `GPT-5.4 Pro` and `Pro` chooses the current
   bare/current row.
4. `Heavy` remains valid where agbrowse intentionally maps it to Pro effort or
   legacy current-Pro handling.

Suggested vitest assertions:

```js
expect(modelChoiceFromText('GPT-5.4 Pro')).toBe(null);
expect(modelChoiceFromText('Pro')).toBe('pro');
expect(modelChoiceFromText('ChatGPT Pro')).toBe('pro');
```

If `modelChoiceFromText` is not currently exported, prefer testing through the
public selection helper already covered by this file. Exporting a tiny parser is
acceptable only if that matches existing test style in the repo.

### Risk notes

- The helper must not treat `GPT-5.5 Pro` as legacy.
- The helper should be conservative. It should reject known older labels, not
  guess every possible future label.
- Avoid brittle English copy beyond the model label itself.

## Slice B — Temporary Chat archive skip

### MODIFY `web-ai/chatgpt-archive.mjs`

Add a small URL helper:

```js
export function isTemporaryChatgptUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(String(url));
    return parsed.searchParams.get('temporary-chat')?.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}
```

Then place the archive skip after the no-conversation-url guard and before
`archiveFlag === 'always'`:

```diff
 export function resolveArchivePolicy({ archiveFlag = 'auto', session }) {
   if (archiveFlag === 'never') {
       return { shouldArchive: false, reason: 'archive-disabled' };
   }
   const conversationUrl = session?.conversationUrl;
   if (!conversationUrl) {
       return { shouldArchive: false, reason: 'no-conversation-url' };
   }
+  if (isTemporaryChatgptUrl(session?.originalUrl) || isTemporaryChatgptUrl(conversationUrl)) {
+    return { shouldArchive: false, reason: 'temporary-chat' };
+  }
   if (archiveFlag === 'always') {
       return { shouldArchive: true, reason: 'archive-forced' };
   }
```

Policy decision:

- `archiveFlag === 'always'` should not override Temporary Chat.
- Reason: Temporary Chat has no durable archive semantics. A forced archive
  should still respect the target workflow being non-durable.
- This mirrors Oracle's safer direction and prevents misleading archive claims.

If session metadata does not reliably preserve `originalUrl`, inspect:

- `web-ai/session.mjs`
- `web-ai/session-store.mjs`
- `web-ai/tab-finalizer.mjs`

Only modify those files if a real data gap is found. Do not expand scope
preemptively.

### ADD `test/unit/web-ai-chatgpt-archive.test.mjs`

Add vitest tests:

1. Auto archive skips when `conversationUrl` contains
   `?temporary-chat=true`.
2. Auto archive skips when `originalUrl` contains `?temporary-chat=true` but
   `conversationUrl` no longer carries the parameter.
3. `archiveFlag: 'always'` still skips Temporary Chat.
4. Invalid URLs do not throw and do not skip by accident.
5. Existing one-shot archive behavior remains unchanged for normal sessions.

Use a complete session fixture with `conversationUrl`, `originalUrl`,
`followUpCount: 0`, `researchMode: 'standard'`, no project URL, and
`status: 'complete'`.

Expected result style:

```js
expect(resolveArchivePolicy({
  archiveFlag: 'always',
  session: completeSession,
})).toEqual({ shouldArchive: false, reason: 'temporary-chat' });
```

### Risk notes

- Do not rely only on `conversationUrl`. ChatGPT can strip the original query
  parameter after navigation.
- Do not throw on malformed local or test URLs.
- Keep the new reason string stable because downstream logs/tests may assert on
  it.

## Slice C — Strict `web_ai_*` MCP input validation

### MODIFY `web-ai/browser-tool-schema.mjs`

If a policy schema already exists as a local constant, export it. The goal is
to use one shared policy schema in both browser tool and web-ai MCP tool
validation.

Suggested change:

```diff
-const policySchema = {
+export const policySchema = {
   type: 'object',
   additionalProperties: false,
   properties: {
     // existing fields
   },
 };
```

Do not duplicate policy-field definitions in a second module unless exporting
would introduce a real cycle.

### MODIFY `web-ai/tool-schema.mjs`

Import the shared policy schema:

```diff
+import { policySchema } from './browser-tool-schema.mjs';
```

Add known compatibility fields to the relevant `web_ai_*` tool schemas instead
of turning all unknown fields on globally.

Common compatibility fields:

```js
const WEB_AI_COMMON_COMPAT_PROPERTIES = {
  provider: { type: 'string', enum: providerEnum },
  vendor: { type: 'string', enum: providerEnum },
  policy: policySchema,
};
```

Prompt submission should also allow:

```js
filePath: { type: 'string' },
reasoningEffort: { type: 'string' },
```

`reasoningEffort` is a backwards-compatible alias for existing `effort`.
Handlers must not require both.

Then change `validateWebAiToolInput` from relaxed to strict:

```diff
 export function validateWebAiToolInput(toolName, input) {
   const tool = WEB_AI_TOOLS[toolName];
   if (!tool) throw new Error(`Unknown web-ai tool: ${toolName}`);
-  const schema = { ...tool.inputSchema, additionalProperties: true };
-  validateSchema(toolName, schema, input ?? {});
+  validateSchema(toolName, tool.inputSchema, input ?? {});
   return true;
 }
```

Expected schema updates for real tools:

- `web_ai_snapshot`: add `vendor` alias; add `policy` only if route policy is
  enforced.
- `web_ai_click_ref`: add `provider`, `vendor`, and `policy`.
- `web_ai_submit_prompt`: add `vendor`, `policy`, `filePath`, and
  `reasoningEffort`; keep existing `provider`, `effort`, and `prompt`.
- `web_ai_wait_response`: add `vendor` alias if preserving providerFromArgs
  compatibility; keep `sessionId`, `provider`, and `timeout`.
- `web_ai_copy_markdown`: add `vendor` alias and `policy`.
- `web_ai_doctor`: add `vendor` alias if the handler accepts it.
- `web_ai_session_resume`: add `vendor` alias; keep `sessionId`, `provider`,
  and `timeout`.

Do not add fields only because they are convenient. Every added field should
map to an existing handler path or documented compatibility alias.

### MODIFY `web-ai/mcp-server.mjs`

Keep the existing policy safety guard:

```js
rejectClientPolicyFields(args?.policy);
```

Strict input schema validation should not replace this runtime policy rejector.
The two checks serve different purposes:

- Tool schema: rejects unknown or malformed top-level input.
- Runtime policy guard: rejects dangerous policy values such as
  `unsafeAllow`.

Check whether `providerFromArgs(args)` still accepts `args.vendor`. If yes,
the schema must allow `vendor`. If the alias is intentionally deprecated, add a
separate deprecation plan instead of silently breaking clients.

### MODIFY `test/unit/web-ai-tool-validation.test.mjs`

Replace the existing relaxed-unknown-field expectation.

Before:

```js
test('accepts web_ai tools with extra fields like policy (additionalProperties relaxed)', ...)
```

After:

```js
test('accepts documented web_ai compatibility fields', ...)
test('rejects unknown web_ai input fields', ...)
test('rejects misspelled policy field', ...)
```

Minimum vitest assertions:

```js
expect(validateWebAiToolInput('web_ai_submit_prompt', {
  prompt: 'hello',
  provider: 'chatgpt',
  vendor: 'chatgpt',
  filePath: '/tmp/context.txt',
  reasoningEffort: 'high',
  policy: {},
})).toBe(true);

expect(() => validateWebAiToolInput('web_ai_submit_prompt', {
    prompt: 'hello',
    polciy: {},
})).toThrow(/additional|unknown|must NOT have additional properties/i);
```

Also assert that `unsafeAllow` remains rejected by the runtime policy guard if
this test file already covers policy behavior. If not, keep it in the MCP
integration test.

### MODIFY `test/integration/web-ai-mcp-server.test.mjs`

Add or update integration coverage so the MCP path rejects unknown fields at
the actual server entrypoint, not just in isolated schema validation.

Suggested cases:

1. `web_ai_submit_prompt` with `policy: {}` is accepted through validation.
2. `web_ai_submit_prompt` with `polciy: {}` is rejected before command
   execution.
3. `web_ai_submit_prompt` with `policy.unsafeAllow` is rejected by
   `rejectClientPolicyFields`.
4. `vendor` alias still routes to the same provider as `provider`, if this
   compatibility is intentionally preserved.

### Risk notes

- This is the highest-risk part of the slice because external MCP clients may
  be depending on loose field passing.
- To lower risk, keep compatibility fields explicit and documented.
- Error messages should be actionable. A client should be able to see exactly
  which top-level property is unknown.
- Do not accept arbitrary nested policy properties. `policySchema` should
  remain strict.

## Documentation Updates

Update docs only where behavior is already documented:

- `README.md`: MCP inputs are strict except documented compatibility aliases;
  Temporary Chat is never archived, even when archive mode is forced.
- `structure/commands.md`: update only if it lists `web_ai_*` arguments or
  archive behavior.
- `structure/CAPABILITY_TRUTH_TABLE.md`: update only if a capability claim
  changes.

## Verification Plan

Run focused tests first:

```bash
npx vitest run test/unit/web-ai-chatgpt-model.test.mjs
npx vitest run test/unit/web-ai-chatgpt-archive.test.mjs
npx vitest run test/unit/web-ai-tool-validation.test.mjs
npx vitest run test/integration/web-ai-mcp-server.test.mjs
```

Then run project-level checks used by the repo:

```bash
npm run typecheck
npm test
git diff --check
```

The repo uses vitest for these files.

## Acceptance Criteria

- `Pro` selection no longer clicks or classifies legacy `GPT-5.x Pro` rows.
- Current `Pro` and intentional `Heavy` behavior remain covered.
- Temporary Chat sessions return `{ shouldArchive: false, reason:
  'temporary-chat' }`.
- `archiveFlag: 'always'` does not archive Temporary Chat sessions.
- `validateWebAiToolInput` no longer overrides schemas with
  `additionalProperties: true`.
- Known compatibility fields still pass where they map to real handler paths.
- Misspelled unknown fields fail fast at schema validation.
- Runtime unsafe policy rejection remains intact.
- Focused unit and MCP integration tests pass.
- `git diff --check` passes.
