# Plan: Generated Images Public Contract

**Status: draft** | **Priority: P1** | **Depends: 15_artifacts_archive_contract**

## Problem

agbrowse has `web-ai/chatgpt-images.mjs`, `--output-image` parser support, and
poll-time image collection hooks, but the feature is not a public contract.
Users cannot discover it in help, README, or `skills/web-ai`, and the failure
semantics do not match an explicit output request.

Current shallow state:

- `web-ai/cli.mjs` parses `--output-image`.
- `web-ai/chatgpt.mjs` passes `outputImage` into `pollWebAi`.
- `web-ai/chatgpt-images.mjs` can detect and download ChatGPT estuary images.
- README, web-ai skill, and MCP schema do not expose the capability.
- There is no `test/unit/chatgpt-images.test.mjs`.

## Oracle Delta

Oracle `src/browser/chatgptImages.ts` has stronger behavior:

- detects generated images inside and outside assistant turn wrappers;
- dedupes by `fileId`, keeping the largest candidate;
- uses active ChatGPT cookies without logging secrets;
- auto-saves to the session artifacts directory when no explicit path is given;
- treats explicit image output paths as meaningful user intent;
- throws or reports a clear failure when explicit output was requested but no
  image was generated;
- caps generated-image waiting with a longer image-specific wait window.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/chatgpt-images.mjs` | MODIFY | Add explicit-output failure contract, richer detection fallback, image wait cap, and testable helpers. |
| `web-ai/chatgpt.mjs` | MODIFY | Preserve image errors/warnings in poll/query results instead of swallowing all failures. |
| `web-ai/cli.mjs` | MODIFY | Add `--output-image <path>` help text and examples. |
| `README.md` | MODIFY | Add image input and generated-image output examples. |
| `skills/web-ai/SKILL.md` | MODIFY | Add agent workflow rules for `--file image.png` and `--output-image out.png`. |
| `structure/CAPABILITY_TRUTH_TABLE.md` | MODIFY | Add generated-image collection support level. |
| `test/unit/chatgpt-images.test.mjs` | NEW | Unit tests for detection, dedupe, explicit failure, and artifact save. |
| `test/integration/web-ai-cli-contract.test.mjs` | MODIFY | Assert help exposes `--output-image`. |

## Diff Plan

### `web-ai/chatgpt-images.mjs`

Add exported helpers for testability:

```javascript
export function resolveGeneratedImageWaitTimeoutMs(waitTimeoutMs)
export function deriveGeneratedImageOutputPaths(outputPath, count)
export function isAllowedChatGptImageUrl(url)
```

Change `collectImages` result shape:

```javascript
{
  images,
  savedPaths,
  markdownSuffix,
  warnings,
  errors,
  explicitOutputRequested,
}
```

Behavior:

- If `outputPath` is provided and no images are detected, return an explicit
  error or throw a `WebAiError` with `stage: 'image-output'`.
- If no explicit output path is provided, auto-save to session artifacts only
  when `sessionId` exists.
- When image download fails without explicit output, keep the answer but add a
  warning.
- When image download fails with explicit output, fail the query because the
  user requested a concrete file artifact.
- Keep cookies in memory only; never write cookie values to traces, artifacts,
  warnings, or errors.

### `web-ai/chatgpt.mjs`

Replace the current broad `catch { /* image collection is best-effort */ }`
with policy-aware handling:

```javascript
if (input.outputImage !== undefined && imageResult.errors.length) {
  throw new WebAiError({
    errorCode: 'provider.image-output',
    stage: 'image-output',
    message: imageResult.errors.join('; '),
  });
}
warnings.push(...imageResult.warnings);
```

Implicit artifact save can stay best-effort; explicit file output cannot.

### Public docs

Add examples:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --output-image ./out.png \
  --prompt "Create an image of a small robot holding a banana."
```

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --file ./input.png \
  --prompt "Describe this image."
```

Help and README text must also state the multi-image naming rule. When the user
passes `--output-image ./out.png` and the provider returns multiple images, the
first image is saved as `out.png` and siblings use numbered names such as
`out-2.png`, `out-3.png`.

Do not hide this behavior behind implementation comments only; agents need the
suffix rule in visible help or examples before they can safely reason about
created files.

## Guardrails

- Do not claim Gemini image generation/editing unless implemented separately.
- Do not read or log OS clipboard.
- Do not log cookies.
- Do not follow off-origin redirects with ChatGPT cookies.
- Do not treat `--output-image` as a directory; it is a concrete primary output
  path and sibling files use numbered suffixes.
- Document the sibling suffix behavior wherever `--output-image` is documented.
- Do not silently pass when explicit image output was requested and no image is
  produced.

## Test Plan

1. Detects estuary images under assistant messages after baseline.
2. Detects generated images rendered outside assistant turn wrappers when still
   after the baseline boundary.
3. Dedupes duplicate `fileId` and keeps the largest candidate.
4. Saves two images to `out.png` and `out-2.png`.
5. Saves implicit images to `$BROWSER_AGENT_HOME/sessions/<id>/artifacts/`.
6. Explicit `--output-image` with no image returns `provider.image-output`.
7. Download failure with explicit path fails; download failure with implicit
   artifact save warns.
8. Help output includes `--output-image`.
9. README or help text shows the `out.png`, `out-2.png` multi-image behavior.

## Acceptance Criteria

- `agbrowse web-ai --help` exposes `--output-image`.
- README and `skills/web-ai/SKILL.md` document image input and output.
- Public docs show how multiple generated images are named from one output path.
- Image behavior is covered by unit tests.
- Explicit image output has fail-closed semantics.
- Capability truth table labels generated image output as beta or experimental.
