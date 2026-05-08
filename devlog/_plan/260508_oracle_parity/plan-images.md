# Plan: ChatGPT Generated Image Collection

**Issue: #68** | **Priority: P1** | **Status: planned** | **Depends: #72**

## Problem

ChatGPT generates DALL-E images inline in responses. agbrowse only captures text — generated images are silently discarded.

## Reference Implementation

Oracle `src/browser/chatgptImages.ts` (commit `9b84357`):
- DOM evaluation finds `<img>` with `backend-api/estuary/content?id=file_` URLs
- Dedupes by fileId, picks highest resolution (naturalWidth × naturalHeight)
- Downloads via fetch with ChatGPT cookies from `Network.getCookies()`
- Saves to session artifacts dir with content-type-based extension
- Cookie header stays in memory, never logged or saved to artifacts

## Files

| File | Action | Description |
|------|--------|-------------|
| `web-ai/chatgpt-images.mjs` | NEW | Image detection, download, save |
| `web-ai/chatgpt.mjs` | MODIFY | Integrate image collection into poll completion |
| `web-ai/tab-finalizer.mjs` | MODIFY | Include image paths in finalization result |
| `web-ai/cli.mjs` | MODIFY | `--output-image <path>` flag |

## Diff Plan

### NEW `web-ai/chatgpt-images.mjs`

```javascript
export async function detectGeneratedImages(cdpSession, { baselineAssistantCount } = {})
// Evaluate JS expression in page to find generated image elements
// Pattern: img[src*="backend-api/estuary/content?id=file_"]
// Whitelist: only URLs matching chatgpt.com/backend-api/estuary/content
// Detection boundary: assistant messages AFTER baselineAssistantCount
//   (this is an assistant-message count, NOT a conversation-turn index —
//    do not mix with oracle's minTurnIndex which counts full turns)
// Return empty array when no new images found after baseline
// Return: [{ url, alt, width, height, fileId }]

export async function downloadGeneratedImages(cdpSession, images, outputPath)
// Get ChatGPT cookies via Network.getCookies({ urls: ["https://chatgpt.com/"] })
// Build cookie header string — NEVER log cookie values
// fetch each image URL with cookie + user-agent headers
// Redirect safety: set redirect to 'manual' or validate final response URL
//   host+path before reading body — do not follow off-origin redirects with cookies
// URL whitelist check: reject non-estuary URLs
// Detect extension from content-type (png/jpg/webp/gif)
// If outputPath specified: treat as meaningful path, derive sibling names for multiple images
//   e.g., outputPath="out.png" → out.png, out-2.png, out-3.png
// If no outputPath: save to session artifacts dir via #72
// Return: [{ path, mimeType, sizeBytes, sourceUrl, fileId }]

export async function collectImages(cdpSession, { baselineAssistantCount, outputPath, artifactsDir, waitTimeoutMs })
// Detect → if empty, poll (1.5s interval, up to waitTimeoutMs default 60s)
// Download if found (to outputPath or artifactsDir)
// Append artifact records if saving to artifactsDir
// Return: { images, savedPaths, markdownSuffix }
```

### MODIFY `web-ai/chatgpt.mjs` — poll completion

```javascript
// After answer text extraction, before finalization:
// Uses baselineAssistantCount from sendWebAi/pollWebAi (already tracked),
// NOT session.turnIndex (which does not exist)
// cdpSession obtained via deps.getCdpSession() (Playwright page + optional CDP)
const imageResult = await collectImages(deps.getCdpSession(), {
    baselineAssistantCount,
    outputPath: opts.outputImage || null,
    artifactsDir: opts.outputImage ? null : resolveArtifactsDir(session.sessionId),
    waitTimeoutMs: 60_000,
});
if (imageResult.savedPaths.length > 0) {
    answerText += imageResult.markdownSuffix;
}
```

## Guardrails

- URL whitelist: only download from `chatgpt.com/backend-api/estuary/content`
- Redirect safety: `redirect: 'manual'` or validate final URL host/path before reading body
- Cookie values NEVER logged, saved to artifacts, or included in session metadata
- baselineAssistantCount is an assistant-message boundary, not a conversation-turn index
- `--output-image <path>` treated as meaningful output path (not reduced to dirname)
- Without explicit output path: saves to #72 artifact dir
- Requires #72 artifacts for implicit save path

## Test Plan

1. Send image generation prompt → verify images detected and downloaded
2. Send text-only prompt → verify no image collection attempted
3. Multiple images → verify sibling naming (out.png, out-2.png)
4. Cookie expiry → verify graceful error (not crash), no cookie in logs
5. Non-estuary URL injected → verify rejected by whitelist
