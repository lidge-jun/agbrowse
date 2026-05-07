# Fix 8 — Auto-ZIP for All Upload-Transport Context Packages

**Priority: P2** | **Status: planned** | **Audit: R8-R10 PASS**

## Files

| File | Action |
|------|--------|
| `web-ai/context-pack/file-selector.mjs` | MODIFY |
| `web-ai/context-pack/builder.mjs` | MODIFY |
| `package.json` | MODIFY (add `archiver` dep) |
| `package-lock.json` | AUTO (updated by `npm install archiver`) |

## Problem

When transport is `upload`, agbrowse writes a `.md` text concatenation — regardless of file count. This has two issues:
1. Binary files (images, PDFs) are excluded during text read
2. Large text packages are uncompressed — slow upload via CDP file input

Applies to ALL upload-transport packaging (multi-file AND single-file), not just multi-file scenarios. ChatGPT/Gemini/Grok all read zip contents natively.

## Diffs

### MODIFY `web-ai/context-pack/file-selector.mjs` — Export expanded paths for zip mode

```diff
 export async function buildContextPack(input = {}) {
     const patterns = collectPatterns(input);
     const expanded = await expandContextPaths(patterns.include, patterns.exclude, input.cwd, input.maxFileSize);
+    const allPaths = [...expanded];
     const files = [];
     const excluded = [];
     // ... existing read logic ...
-    return { files, excluded, warnings };
+    return { files, excluded, warnings, allPaths };
 }
```

`expanded` is `string[]` of absolute paths. `allPaths` is a snapshot taken BEFORE binary exclusion in the read loop.

### MODIFY `web-ai/context-pack/builder.mjs` — Zip packaging for upload transport

```diff
+import { createWriteStream } from 'node:fs';
+import { resolve, relative } from 'node:path';
+import archiver from 'archiver';
+
 const PACKAGE_DIR = join(process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent'), 'web-ai-context-packages');

+/** @param {BuilderInput} [input] */
 export async function prepareContextForBrowser(input = {}) {
     if (!hasContextPackaging(input)) return null;
-    const result = await buildContextPackageResult({ ...input, strict: true });
+    const selected = await buildContextPack({ ...input, strict: true });
+    const result = buildContextRenderResult(input, selected.files, selected.excluded, selected.warnings);
     if (result.budget.estimatedTokens > result.budget.maxInputTokens) {
         throw overBudgetError(result.budget);
     }
     if (result.transport === 'inline') {
         const inlineLimit = Number(input.inlineCharLimit || DEFAULT_INLINE_CHAR_LIMIT);
         if (result.composerText.length > inlineLimit) {
             throw inlineLimitError(result.composerText.length, inlineLimit);
         }
         return result;
     }
-    if (!result.attachmentText.trim()) throw new WebAiError({
+    const zipPaths = (selected.allPaths?.filter(Boolean).length ? selected.allPaths : selected.files.map(f => f.path));
+    if (!zipPaths.length) throw new WebAiError({
         errorCode: 'context.over-budget',
         stage: 'context-preflight',
         retryHint: 'reduce-files',
         message: 'context package attachment is empty',
     });
     await fs.mkdir(PACKAGE_DIR, { recursive: true });
-    const filePath = join(PACKAGE_DIR, `web-ai-context-package-${Date.now()}.md`);
-    await fs.writeFile(filePath, `${result.attachmentText}\n`, 'utf8');
-    const stat = await fs.stat(filePath);
+    const cwd = input.cwd || process.cwd();
+    const filePath = join(PACKAGE_DIR, `web-ai-context-package-${Date.now()}.zip`);
+    await zipContextFiles(zipPaths, cwd, filePath);
+    const stat = await fs.stat(filePath);
     result.attachments = [{
         path: filePath,
         displayPath: basename(filePath),
         sizeBytes: stat.size,
     }];
     return result;
 }
+
+/**
+ * @param {string[]} filePaths - Absolute paths to zip
+ * @param {string} cwd - Base directory for relative paths in the archive
+ * @param {string} outputPath
+ * @returns {Promise<void>}
+ */
+async function zipContextFiles(filePaths, cwd, outputPath) {
+    const archive = archiver('zip', { zlib: { level: 6 } });
+    const output = createWriteStream(outputPath);
+    const done = new Promise((resolve, reject) => {
+        output.on('close', resolve);
+        archive.on('error', reject);
+    });
+    archive.pipe(output);
+    for (const absPath of filePaths) {
+        const relPath = relative(cwd, absPath);
+        archive.file(absPath, { name: relPath });
+    }
+    await archive.finalize();
+    await done;
+}
```

Update imports at top of builder.mjs:
```diff
+import { buildContextPack } from './file-selector.mjs';
+import { buildContextRenderResult } from './renderer.mjs';
```

### Dependency

```bash
npm install archiver
```

## Backward compatibility

- `--context-transport inline` is unchanged (uses `composerText`)
- `--context-transport upload` now produces `.zip` instead of `.md`
- `--inline-only` is unchanged
- Single-file `--file` is unchanged (bypasses context packaging)
- `allPaths` includes binary files that were excluded from text rendering
