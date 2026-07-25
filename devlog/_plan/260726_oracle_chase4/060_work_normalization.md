# WP7 — G16: Work→Chat normalization

Row: **G16** (upstream `80ebcf86`). Deferred in round 3 on a rationale that round 4
proved wrong, then re-deferred in round 4 as a product decision. This round it gets
a final answer.

## 1. Where it stands

- Round 3 deferred it as "normalization is UX, not correctness".
- Round 4 §6.4 tried to justify it architecturally ("every surface consumer is a
  guard") and the reviewer produced the counterexample: `ensureWorkSurface`
  (`chatgpt-work-picker.mjs:234-288`) reads the detection and then CLICKS the Work
  radio, verifying the result. So a mirrored `ensureChatSurface` is architecturally
  ordinary. That rebuttal was retracted.
- Round 4 then re-deferred it honestly: no caller wants it, and silently switching
  the user's composer out of Work is a surprising side effect for a `query`.
- Round 5 (WP5 of the previous round) closed the SAFETY half: a Work conversation
  is now detected and model mutation is blocked, so the urgency is gone.

## 2. Decision: implement as an opt-in operation

Deferring a third time on the same reasoning would be the lazy-completion pattern.
The honest options are (a) implement it behind an explicit opt-in, or (b) record a
permanent no-port. This plan chooses **(a)**, because the objection was never to the
capability — it was to doing it implicitly.

An explicit flag removes the entire objection: the surprise only exists when the
caller did not ask.

## 3. Change map

### 3.1 NEW `ensureChatSurface(page)` in `web-ai/chatgpt-work-picker.mjs`

Mirror of `ensureWorkSurface` (`:234-288`), same structure, same failure modes:

```js
/**
 * Ensure the Chat surface is active. If Work is active, click the Chat radio and
 * verify. Mirror of ensureWorkSurface. NEVER called implicitly — only from an
 * explicit caller opt-in, because switching a user's composer out of Work is a
 * visible side effect they must ask for.
 *
 * @param {any} page
 * @returns {Promise<{ switched: boolean, detection: ComposerSurfaceDetection }>}
 */
export async function ensureChatSurface(page) {
    const detection = await detectChatGptComposerSurface(page);
    if (detection.surface === 'chat') return { switched: false, detection };

    // A conversation page has no toggle to click: normalization there would mean
    // navigating away from the user's conversation, which is a different and much
    // larger action. Fail closed with the existing typed error instead.
    if (detection.ui === 'legacy') {
        throw workSurfaceUnsupportedError({
            surface: detection.surface || 'conversation',
            evidence: detection,
        });
    }
    if (detection.surface === 'ambiguous') {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-preflight',
            message: 'Cannot ensure Chat surface: ambiguous surface state',
            retryHint: 'reload-page',
            evidence: detection,
        });
    }
    // detection.surface === 'work' — click the Chat radio and verify.
    ...same radio-click + post-verify shape as ensureWorkSurface:253-286...
}
```

The legacy/conversation branch is the important asymmetry: `ensureWorkSurface` can
fail there harmlessly, but normalization on a conversation page would require
leaving the conversation. That is out of scope and fails closed.

### 3.2 Opt-in surface

A single input flag, defaulting OFF, consumed at the ChatGPT send preflight:

```diff
*** web-ai/chatgpt.mjs (send preflight, near the existing surface handling)
+    if (input.normalizeSurface === true) {
+        const { ensureChatSurface } = await import('./chatgpt-work-picker.mjs');
+        const normalized = await ensureChatSurface(page);
+        if (normalized.switched) warnings.push('composer surface normalized: work -> chat');
+    }
```

CLI: `--normalize-surface` (boolean, default false), documented as "switch the
composer from Work to Chat before sending". The warning makes the side effect
visible in the result envelope, which is what "not surprising" requires.

## 4. Accept criteria (activation-grounded)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Work active, `normalizeSurface: true` | Chat radio clicked, post-verify passes, `switched: true`, warning emitted |
| 2 | Chat already active, flag true | `switched: false`, no click |
| 3 | Work active, flag ABSENT | no click at all — default is zero-touch |
| 4 | ambiguous surface, flag true | `provider.work-state-unknown`, no click |
| 5 | legacy/conversation page, flag true | `capability.unsupported` — never navigates away |
| 6 | post-click verification fails | `provider.work-state-unknown`, error surfaced |
| 7 | `ensureWorkSurface` behavior | unchanged |

Case 3 is the one that protects every existing caller.

Tests: extend `test/unit/web-ai-chatgpt-work-picker.test.mjs`.

## 5. Scope boundary

IN: `ensureChatSurface`, the opt-in flag plumbing in `chatgpt.mjs` + CLI arg
parsing, docs the gates require (README/SKILL/CAPABILITY_TRUTH_TABLE if they
enumerate flags), the work-picker test file.
OUT: making normalization a default, navigating away from a conversation,
Work→Chat for the Work send path, and any change to `ensureWorkSurface`.
