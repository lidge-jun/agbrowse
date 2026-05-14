# Plan: Current ChatGPT Attachment-Chip Hardening

**Status: draft** | **Priority: P1** | **Reference: oracle #192 / origin/main 1828e2b**

## Problem

Oracle upstream broadened attachment-chip detection for current ChatGPT DOM.
agbrowse still uses a smaller attachment upload verifier. The current agbrowse
tests do not cover nested chip labels, stale page-level chips, count-based
fallback, or image-only file-input avoidance.

Current shallow state:

- `web-ai/chatgpt-attachments.mjs` has basic selectors and preflight.
- `test/unit/chatgpt-attachments.test.mjs` has one behavior test and one
  source-string assertion.
- Current Oracle changed attachment readiness to inspect nested chip text,
  stay scoped to the active composer, and use count-based fallback when names
  are hidden.

## Oracle Delta

Oracle #192 adds:

- `collectLabelHaystack` over chip node, parent, and grandparent text/attrs;
- `Remove attachment` selectors in addition to `Remove file`;
- active-composer-only attachment roots;
- exclusion of editable prompt nodes to avoid matching filename text in prompt;
- count-based readiness fallback when filename text is hidden;
- longer send-button timeout only for attachment-bearing sends.

Oracle attachment infrastructure also scores file inputs and avoids image-only
inputs for non-image attachments.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/chatgpt-attachments.mjs` | MODIFY | Add scoped chip readiness, nested label matching, count fallback, and input scoring. |
| `web-ai/chatgpt-composer.mjs` | MODIFY if needed | Keep send readiness scoped to active composer. |
| `web-ai/chatgpt.mjs` | MODIFY if needed | Preserve warnings and upload evidence. |
| `test/unit/chatgpt-attachments.test.mjs` | MODIFY | Replace source-string assertion with behavior tests. |
| `test/unit/chatgpt-attachment-expressions.test.mjs` | NEW optional | Test generated DOM expressions if split out. |

## Diff Plan

### Extract testable helpers

```javascript
export function buildAttachmentReadyExpression(fileNames)
export function scoreFileInputCandidate(inputMetadata, { isImageAttachment })
export function isImageAttachmentPath(path)
export function sendButtonTimeoutMs(fileNames)
```

### Improve ready detection

- Scope chip lookup to active composer/form.
- Ignore textarea/contenteditable descendants.
- Collect text/attrs from node, parent, grandparent, and known tooltip attrs.
- Include `Remove attachment` affordances.
- Count chips with remove affordances as fallback when filenames are hidden.
- Keep `input.files` as a secondary proof source.

### Improve file input selection

- Prefer local composer inputs.
- Prefer visible or stable file inputs.
- Prefer `multiple`.
- Avoid image-only inputs for non-image files.
- Allow image-only inputs only for image attachments.

## Guardrails

- Do not scan arbitrary page-level `div/span` nodes; prompt text may contain the
  filename and cause false positives.
- Do not treat stale chips from older conversations as readiness.
- Do not fall back to Enter when attachment upload/send readiness fails.
- Do not remove existing fallback behavior unless tests prove it is unsafe.
- Keep image and non-image upload paths distinct.

## Test Plan

1. Nested chip text under current ChatGPT DOM satisfies readiness.
2. Filename text inside the prompt composer does not satisfy readiness.
3. Stale page-level chip outside active composer does not satisfy readiness.
4. Count-based fallback accepts N chips with N remove affordances.
5. Non-image upload avoids image-only file inputs.
6. Image upload may use image-only file input.
7. Attachment sends get longer send-button timeout.
8. Plain text sends keep shorter timeout.

## Acceptance Criteria

- Attachment readiness matches Oracle #192's current DOM hardening where relevant.
- Existing upload behavior remains green.
- Tests cover behavior rather than source strings.
