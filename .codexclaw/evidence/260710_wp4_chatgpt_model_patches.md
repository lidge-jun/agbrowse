# WP4 chatgpt-model.mjs patches for coordinator

Date: 2026-07-10
Context: 04_work_surface_support.md assigns `workSurfaceUnsupportedError` and
the `openModelMenu`/`selectChatGptModel` surface-guard merge to chatgpt-model.mjs.
Worker D currently owns that file. These patches should be applied after
Worker D's changes land.

## 1. workSurfaceUnsupportedError

Currently defined in `web-ai/product-surfaces.mjs` as a temporary home.
After Worker D lands, move it to `chatgpt-model.mjs` and update the import in
`product-surfaces.mjs` to re-export from `chatgpt-model.mjs`.

The function signature and behavior:

```js
// In chatgpt-model.mjs, near the existing error helpers:
import { WebAiError } from './errors.mjs';

/**
 * @param {{ surface?: string, evidence?: unknown }} [context]
 * @returns {WebAiError}
 */
export function workSurfaceUnsupportedError(context = {}) {
    return new WebAiError({
        errorCode: 'capability.unsupported',
        stage: 'provider-surface-preflight',
        retryHint: 'switch-to-chat',
        vendor: 'chatgpt',
        message: 'Chat commands are not supported on the Work surface (detected: '
            + (context.surface || 'unknown')
            + '). Switch to Chat or use web-ai work send / web_ai_work_send.',
        evidence: context.evidence,
    });
}
```

## 2. selectChatGptModel surface guard

Anchor: `selectChatGptModel` function (currently ~line 600+ in chatgpt-model.mjs).

Add at the top of the function body, before any model/effort early return:

```js
// Surface guard: active Work or ambiguous -> hard error, zero selector clicks.
const { detectChatGptComposerSurface } = await import('./product-surfaces.mjs');
const surfaceDetection = await detectChatGptComposerSurface(page);
if (surfaceDetection.surface === 'work' || surfaceDetection.surface === 'ambiguous') {
    throw workSurfaceUnsupportedError({
        surface: surfaceDetection.surface,
        evidence: surfaceDetection,
    });
}
```

## 3. openModelMenu composer-scoped guard

Anchor: `openModelMenu` function (currently uses `chatGptComposerMenuRoot`).

Add at the top of `openModelMenu`, after getting the page parameter:

```js
// Surface guard: same as selectChatGptModel
const { detectChatGptComposerSurface } = await import('./product-surfaces.mjs');
const surfaceDetection = await detectChatGptComposerSurface(page);
if (surfaceDetection.surface === 'work' || surfaceDetection.surface === 'ambiguous') {
    throw workSurfaceUnsupportedError({
        surface: surfaceDetection.surface,
        evidence: surfaceDetection,
    });
}
```

Additionally, within `openModelMenu`, after opening the picker content via
`chatGptComposerMenuRoot(page)`, add a Work marker check:

```js
// Reject if Work picker markers are visible inside the menu
const { CHATGPT_WORK_PICKER_MARKER_SELECTOR } = /* already exported from chatgpt-model.mjs */;
const workMarker = menu.locator(CHATGPT_WORK_PICKER_MARKER_SELECTOR).first();
if (await workMarker.isVisible().catch(() => false)) {
    throw workSurfaceUnsupportedError({
        surface: 'work',
        evidence: { workMarkerVisible: true },
    });
}
```

## 4. Import adjustments after merge

Once `workSurfaceUnsupportedError` moves to chatgpt-model.mjs:
- `product-surfaces.mjs`: remove the function definition, add
  `export { workSurfaceUnsupportedError } from './chatgpt-model.mjs';`
  to preserve existing import paths.
- `chatgpt-work-picker.mjs`: no changes needed (it does not import this error).
- `mcp-server.mjs`: no changes needed (it does not use this error directly).
