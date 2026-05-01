# Phase 9 — Visual fallback / annotated screenshot

When accessibility snapshot can't find a target (icon-only buttons with no
accessible name, canvas-like UI, provider visual churn), fall back to
annotated screenshots where @eN labels overlay interactive elements.

This is a **diagnostic tool**, not a primary interface. agbrowse is
accessibility-snapshot-first; vision is the last resort.

Inspired by Vercel Labs agent-browser `screenshot --annotate` and
WebVoyager's text-marked interactive elements.

Depends on Phase 7 (snapshot refs) and Phase 8 (self-heal uses this as a
signal).

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Annotated screenshot | NEW `web-ai/annotated-screenshot.mjs`; MODIFY `web-ai/doctor.mjs`; MODIFY `web-ai/cli.mjs`; unit tests. |

## When to use (not default)

- Copy button is icon-only and accessible name has been removed.
- Upload surface changed to a hidden input/button combo.
- Streaming indicator not in the accessibility tree.
- Provider DOM churn report needs fast human verification.

## Diffs (PR1)

### NEW `web-ai/annotated-screenshot.mjs`

API surface:

```js
export async function captureAnnotatedScreenshot(page, snapshot, options = {}) {}
```

Skeleton:

```js
export async function captureAnnotatedScreenshot(page, snapshot, {
    outputPath = null,
    highlightRefs = true,
} = {}) {
    const screenshot = await page.screenshot({ fullPage: false });

    if (!highlightRefs || !snapshot) return { image: screenshot, annotations: [] };

    const annotations = [];
    for (const [ref, entry] of Object.entries(snapshot.refs)) {
        if (!entry.selector) continue;
        const box = await page.locator(entry.selector).first().boundingBox().catch(() => null);
        if (box) {
            annotations.push({ ref, role: entry.role, name: entry.name, box });
        }
    }

    return { image: screenshot, annotations };
}
```

Note: actual overlay rendering (drawing @eN labels on the image) can use
Canvas API in Node or a lightweight SVG overlay. Implementation detail
deferred to PR time.

### MODIFY `web-ai/doctor.mjs` — annotated screenshot opt-in

```js
if (options.annotateScreenshot) {
    const snapshot = await buildWebAiSnapshot(page, { provider: vendor });
    report.annotatedScreenshot = await captureAnnotatedScreenshot(page, snapshot);
}
```

### MODIFY `web-ai/cli.mjs`

```
agbrowse web-ai doctor --vendor chatgpt --annotate-screenshot
```

Default: off. Produces a PNG with @eN overlays alongside the JSON report.

## Public-surface changes

- Doctor gains `--annotate-screenshot` flag.
- Output: PNG file written to stdout or `--output <path>`.

## Test plan

- Unit: `captureAnnotatedScreenshot` returns annotations with bounding boxes
  matching known elements.
- Unit: annotations array is empty when snapshot has no selectors.

## Exit criteria

- When `web-ai doctor --annotate-screenshot` runs against a ChatGPT page
  where the copy button has lost its accessible name, the screenshot shows
  a numbered overlay at the button's position that an agent or human can
  use to identify it.

## Risks

- **Most likely:** bounding box coordinates are wrong on high-DPI displays
  or when page is scrolled. Mitigate by using `{ fullPage: false }` and
  testing on retina.
- **Secondary:** screenshot file size is large (> 1MB). Mitigate by
  compressing to JPEG at 80% quality for non-diagnostic use.

## cli-jaw mirror

| Item | cli-jaw status |
| --- | --- |
| `annotated-screenshot` | **Port as-is** to `src/browser/web-ai/annotated-screenshot.ts`. |
| Doctor flag | **Extend** existing diagnose/doctor command. |
