# Plan: Normal Upload File-Size Cap

**Status: draft** | **Priority: P2** | **Reference: oracle #193 / origin/main d9439dd**

## Problem

agbrowse exposes `--max-file-size`, but the help text describes it as a
context-package budget. Normal single-file uploads through `--file` use
hardcoded preflight limits instead of a user/configurable cap.

Current shallow state:

- `--max-file-size` is parsed and passed into context-package logic.
- `web-ai/chatgpt-attachments.mjs` hardcodes `512MB` and `20MB` image limits.
- There is no normal upload cap that maps to Oracle's
  `--max-file-size-bytes` behavior.
- The distinction between context budget and upload cap is not explicit enough.

## Oracle Delta

Oracle #193 passes the configured max file size into browser prompt assembly so
normal `--file` runs honor the cap instead of only applying it to a packaging
path.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/cli.mjs` | MODIFY | Add or clarify upload cap flag. |
| `web-ai/chatgpt-attachments.mjs` | MODIFY | Accept preflight cap options instead of hardcoded-only behavior. |
| `web-ai/gemini-live.mjs` | MODIFY | Apply cap consistently to Gemini uploads. |
| `web-ai/grok-live.mjs` | MODIFY | Apply cap consistently to Grok uploads. |
| `web-ai/context-pack/file-selector.mjs` | NO CHANGE/MODIFY | Keep context cap separate unless naming changes. |
| `README.md` | MODIFY | Document context budget vs upload cap. |
| `skills/web-ai/SKILL.md` | MODIFY | Add agent guidance. |
| `test/unit/chatgpt-attachments.test.mjs` | MODIFY | Add cap tests. |
| `test/integration/web-ai-cli-contract.test.mjs` | MODIFY | Assert help exposes correct cap semantics. |

## Diff Plan

### Flag decision

Preferred:

```text
--max-upload-file-size <bytes>   Per-file live upload cap.
--max-file-size <bytes>          Per-file context package budget.
```

Alternative:

- Keep `--max-file-size` but apply it to both context packages and normal
  uploads. This is more convenient but less precise.

UX naming note:

- `--max-file-size` is already ambiguous because users read it as a general file
  cap, while current help frames it as a context-package budget.
- The long-term cleaner name is `--max-context-file-size` for context package
  selection plus `--max-upload-file-size` for live provider uploads.
- If a rename is too disruptive now, document `--max-file-size` as the legacy
  context-budget alias and add a future deprecation path toward
  `--max-context-file-size`.
- Help examples must show both names together so agents do not send the upload
  cap where the context budget was intended, or the reverse.

### Attachment preflight

Change:

```javascript
preflightAttachment(file)
```

to:

```javascript
preflightAttachment(file, {
  maxUploadBytes,
  maxImageBytes,
})
```

Defaults:

- keep current hard limit unless configured lower/higher by accepted policy;
- retain image-specific limit unless explicitly overridden;
- report both actual size and applied cap in errors.

### Provider consistency

- ChatGPT, Gemini, and Grok upload paths should use the same cap resolver.
- Context package file selection should keep its existing context-specific
  budget and error wording.

## Guardrails

- Do not let a context budget silently become an upload security cap without
  documentation.
- Do not add `--max-upload-file-size` without explicitly documenting how it
  differs from `--max-file-size`.
- Do not leave `--max-file-size` permanently ambiguous; either rename it to
  `--max-context-file-size` or document it as a legacy alias with a deprecation
  path.
- Do not allow unbounded upload size.
- Do not confuse image-specific limits with general file limits.
- Do not break existing `--max-file-size` context package behavior.

## Test Plan

1. ChatGPT upload rejects a file over `--max-upload-file-size`.
2. Gemini upload rejects a file over the same cap.
3. Grok upload rejects a file over the same cap.
4. Context package `--max-file-size` behavior remains unchanged.
5. Help clearly distinguishes context and upload caps.
6. Help includes either `--max-context-file-size` or an explicit legacy alias
   note for `--max-file-size`.
7. Error envelope includes actual size and cap.

## Acceptance Criteria

- Normal live uploads have an explicit configurable cap.
- Context package budgets remain clear.
- Tests prove both paths independently.
