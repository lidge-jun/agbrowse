# agbrowse UX Blocker Fixes — Diff Plan (Round 7)

Repo: https://github.com/lidge-jun/agbrowse

## Part 1: What This Fixes

Eight UX blockers from real-world agbrowse usage. Fixes 1-6 went through 7 rounds of GPT Pro audit (final: 6/6 PASS). Fixes 7-8 added post-audit.

### Round 6 → Round 7 changes:
- **#1**: Added `'grok'` to `PROVIDER_FILE_ACCESS_PROVIDERS` set. Grok supports file upload (upload selectors + `attachLocalFileLive` in grok-live.mjs) but was missing from the default set, causing `--vendor grok --file ...` to fail without a custom policy.

### Round 5 → Round 6 changes (kept for context):
- **#6**: New-tab recovery path now uses `waitForPageByTargetId` (not `getPageByTargetId`) to ensure page handle is attached before calling `waitForConversationReady`. Also persists `recoveredConversationUrl` to session in all paths.

### Round 4 → Round 5 changes (kept for context):
- **#1**: Unified detection for both CLI and MCP. `applyProviderDefaults` now takes `{ explicitKeys }` — a `Set` of keys the user explicitly supplied (from policy file keys OR inline `args.policy` keys). Only overrides keys NOT in that set.
- **#6**: Added `waitForConversationReady` to ALL three `tab-recovery.mjs` navigation paths: (1) `withSessionPage` existing-tab goto, (2) `recoverSessionTab` existing-tab goto, (3) `recoverSessionTab` new-tab via `createTab`. Also persists redirect URL in all three paths.

---

## Part 2: Diff-Level Changes

### Fix 1 — File Upload Policy: Provider-Aware Defaults
**Priority: P1** | **Files: MODIFY `web-ai/policy/default-policy.mjs`, MODIFY `web-ai/mcp-server.mjs`, MODIFY `web-ai/cli.mjs`**

**Round 4 issue:** `hasUserPolicyFile` flag works for CLI but not MCP. MCP builds policy from inline `args.policy` (never a file). A client passing `{ allowFileAccess: false }` explicitly would still get overridden because `hasUserPolicyFile` is always false on MCP.

**New approach:** Track which keys the user explicitly supplied, regardless of source (file or inline). `applyProviderDefaults` takes `{ explicitKeys: Set<string> }`. A key is "explicit" if:
- CLI path: it appeared in the user's policy file (keys of `JSON.parse(raw)` before merge with defaults)
- MCP path: it appeared in `args.policy` (keys of the inline object)

If `explicitKeys` is empty (no policy file, no inline policy), all provider defaults apply freely.

**MODIFY `web-ai/policy/default-policy.mjs`**

```diff
 // @ts-check
 export const DEFAULT_WEB_AI_POLICY = Object.freeze({
     version: 1,
     allowedOrigins: [],
     deniedOrigins: [],
     allowDownloads: false,
     allowUploads: 'explicit-only',
     allowClipboardRead: false,
     allowClipboardWrite: 'explicit-only',
     allowEvaluate: false,
     allowFileAccess: false,
     allowCrossOriginNavigation: 'confirm',
     destructiveFormPolicy: 'deny',
     promptInjectionBoundary: 'strict',
 });
+
+/** @type {ReadonlySet<string>} */
+const PROVIDER_FILE_ACCESS_PROVIDERS = new Set(['chatgpt', 'gemini', 'grok']);
+
+/**
+ * Apply provider-specific file-access default.
+ * Only upgrades allowFileAccess when the user did NOT explicitly set it.
+ * @param {string} provider
+ * @param {Record<string, unknown>} policy
+ * @param {{ explicitKeys: ReadonlySet<string> }} opts
+ * @returns {Record<string, unknown>}
+ */
+export function applyProviderDefaults(provider, policy, opts) {
+    if (!PROVIDER_FILE_ACCESS_PROVIDERS.has(provider)) return policy;
+    if (opts.explicitKeys.has('allowFileAccess')) return policy;
+    return { ...policy, allowFileAccess: true };
+}
```

**Why this works:** Whether the user wrote `{ allowFileAccess: false }` in a policy file or passed it inline via MCP, the key `'allowFileAccess'` will be in `explicitKeys`. The provider default only applies when the user said nothing about it. No TS7053 — we use a typed `Set<string>`, not dynamic object indexing.

**MODIFY `web-ai/policy/schema.mjs`** — Return explicit keys from `loadPolicy`

```diff
-export async function loadPolicy(policyPath) {
-    if (!policyPath) return { ...DEFAULT_WEB_AI_POLICY };
+/**
+ * @param {string|null|undefined} policyPath
+ * @returns {Promise<{ policy: WebAiPolicy, explicitKeys: Set<string> }>}
+ */
+export async function loadPolicy(policyPath) {
+    if (!policyPath) return { policy: { ...DEFAULT_WEB_AI_POLICY }, explicitKeys: new Set() };
     const resolved = path.resolve(policyPath);
     const cwd = process.cwd();
     if (policyPath.split(/[\\/]+/).includes('..') || (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`))) {
         throw policyError('policy.path-traversal', 'policy-load', 'policy path escapes current working directory', { ruleId: 'policyPath', policyPath });
     }
     const raw = await fs.readFile(resolved, 'utf8');
-    return normalizePolicy(JSON.parse(raw));
+    const parsed = JSON.parse(raw);
+    const explicitKeys = new Set(Object.keys(parsed));
+    return { policy: normalizePolicy(parsed), explicitKeys };
 }
```

**Integration check:** `loadPolicy` is used in two places:
1. `enforce.mjs:loadAndEnforcePolicy` — calls `loadPolicy(input.policyPath)` and returns `policy`. After this change, callers that use `loadAndEnforcePolicy` need updating.
2. The new CLI `enforceCliPolicy` split (this plan).

**MODIFY `web-ai/policy/enforce.mjs`** — Update `loadAndEnforcePolicy` for new return shape

```diff
 export async function loadAndEnforcePolicy(input = {}, action = {}) {
-    const policy = await loadPolicy(input.policyPath);
-    enforcePolicy(policy, action);
-    return policy;
+    const { policy } = await loadPolicy(input.policyPath);
+    enforcePolicy(policy, action);
+    return policy;
 }
```

This preserves backward compatibility for any existing callers of `loadAndEnforcePolicy`.

**MODIFY `web-ai/mcp-server.mjs`** — MCP path

```diff
+import { applyProviderDefaults } from './policy/default-policy.mjs';
```

In `callMcpTool`, `web_ai_submit_prompt` branch (~line 188):
```diff
     if (name === 'web_ai_submit_prompt') {
         const provider = providerFromArgs(args);
+        const rawPolicyKeys = new Set(Object.keys(args.policy === undefined ? {} : args.policy));
+        const effectivePolicy = applyProviderDefaults(provider, policy, { explicitKeys: rawPolicyKeys });
-        enforcePolicy(policy, {
+        enforcePolicy(effectivePolicy, {
             url: state.latestSnapshot?.url || args.url || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[provider],
             upload: Boolean(args.filePath),
             explicitUpload: Boolean(args.filePath),
             fileAccess: Boolean(args.filePath),
         });
```

Note: `rawPolicyKeys` is derived from `args.policy` BEFORE `normalizeMcpPolicy()` processes it (line 149). This captures exactly what the client explicitly sent.

**MODIFY `web-ai/cli.mjs`** — CLI path (~line 584)

```diff
+import { applyProviderDefaults } from './policy/default-policy.mjs';
+import { loadPolicy } from './policy/schema.mjs';
```

```diff
 async function enforceCliPolicy(command, input) {
     const mutating = ['send', 'query', 'stop'].includes(command);
+    const provider = input.vendor || input.provider || 'chatgpt';
     const policyUrl = input.url || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[input.vendor || 'chatgpt'];
     const action = {
         url: policyUrl,
         upload: Boolean(input.filePath || input.contextFile || input.contextFromFiles?.length),
         explicitUpload: Boolean(input.filePath || input.contextFile || input.contextFromFiles?.length),
         fileAccess: Boolean(input.filePath || input.contextFile || input.contextFromFiles?.length),
         clipboardRead: input.allowCopyMarkdownFallback === true,
         evaluate: false,
         unsafeAllow: input.unsafeAllow,
     };
     if (!mutating && !action.clipboardRead && !input.unsafeAllow?.length) return null;
-    return loadAndEnforcePolicy(input, action);
+    const { policy, explicitKeys } = await loadPolicy(input.policyPath);
+    const effective = applyProviderDefaults(provider, policy, { explicitKeys });
+    enforcePolicy(effective, action);
+    return { ok: true, policy: effective };
 }
```

Also update imports at the top of cli.mjs (remove `loadAndEnforcePolicy` if not used elsewhere in cli.mjs):
```diff
-import { loadAndEnforcePolicy } from './policy/enforce.mjs';
+import { enforcePolicy } from './policy/enforce.mjs';
+import { loadPolicy } from './policy/schema.mjs';
+import { applyProviderDefaults } from './policy/default-policy.mjs';
```

---

### Fix 2 — Same-Tab Reuse: Session-Aware Default
**Priority: P2** | **File: MODIFY `web-ai/cli.mjs`** | **Rounds 1-4 verdict: PASS**

```diff
-        newTab: values['new-tab'] === true || values.parallel === true || (['send', 'query'].includes(command) && values['reuse-tab'] !== true && process.env.AGBROWSE_REUSE_TAB !== '1'),
+        newTab: values['new-tab'] === true || values.parallel === true || (['send', 'query'].includes(command) && values['reuse-tab'] !== true && !values.session && process.env.AGBROWSE_REUSE_TAB !== '1'),
```

---

### Fix 3 — Browser Crash Recovery in Poll Loops
**Priority: P1** | **Rounds 2-4 verdict: PASS**

Export `isPageDeathError` from `tab-recovery.mjs`. Add import + try/catch in poll loops of `chatgpt.mjs`, `grok-live.mjs`, `gemini-live.mjs`. Crash return includes full fields: `ok`, `vendor`, `status: 'tab-crashed'`, `url`, `sessionId`, `answerText`, `baseline`, `usedFallbacks: []`, `warnings: ['tab-crashed-during-poll']`, `recoverable`. Session status updated to `'crashed'`.

(Full diffs identical to Round 2 — omitted for brevity.)

---

### Fix 4 — Stale Target Ownership: Auto-Expire on Register
**Priority: P0** | **File: MODIFY `web-ai/active-command-store.mjs`** | **Rounds 2-4 verdict: PASS**

```diff
     return withActiveCommandLock(async () => {
         const store = readStore();
         const nowMs = Date.now();
+        let changed = false;
+        store.commands = store.commands.map(row => {
+            if (row.status !== 'running') return row;
+            const expiresMs = Date.parse(row.expiresAt || '');
+            if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
+                changed = true;
+                return { ...row, status: 'expired', completedAt: new Date(nowMs).toISOString() };
+            }
+            return row;
+        });
+        if (changed) writeStore(store);
         const targetConflict = command.targetId
             ? store.commands.find(row =>
                 row.status === 'running' &&
-                Date.parse(row.expiresAt || '') > nowMs &&
                 row.targetId === command.targetId &&
                 row.commandId !== command.commandId)
             : null;
```

---

### Fix 5 — Stale Answer Pickup: Session/TargetId-Scoped Baseline
**Priority: P0** | **File: MODIFY `web-ai/chatgpt.mjs`** | **Rounds 3-4 verdict: PASS**

**Baseline resolution (~lines 297-300):**

```diff
     const baseline = (session && sessionToBaseline(session))
         || getBaseline(vendor, url)
-        || getLatestBaseline(vendor, { sameHostUrl: url })
-        || getLatestBaseline(vendor);
+        || getLatestBaseline(vendor, { sameHostUrl: url });
```

**Poll loop guard (~lines 315-318):**

```diff
     while (Date.now() <= deadline) {
+        if (session?.targetId) {
+            const currentTargetId = await deps.getTargetId?.().catch(() => null);
+            if (currentTargetId && currentTargetId !== session.targetId) {
+                return {
+                    ok: false, vendor, status: 'target-mismatch',
+                    url: page.url(), ...(session ? { sessionId: session.sessionId } : {}),
+                    answerText: '', baseline, usedFallbacks: [],
+                    warnings: [`poll target changed: ${session.targetId} → ${currentTargetId}`],
+                    error: 'target changed during poll',
+                };
+            }
+        } else {
+            const currentUrl = page.url();
+            const baselineConvoId = extractConversationId(baseline.url);
+            const currentConvoId = extractConversationId(currentUrl);
+            if (baselineConvoId !== currentConvoId || (!baselineConvoId && !currentConvoId && baseline.url !== currentUrl)) {
+                return {
+                    ok: false, vendor, status: 'conversation-mismatch',
+                    url: currentUrl, answerText: '', baseline, usedFallbacks: [],
+                    warnings: [`conversation changed: ${baselineConvoId || 'none'} → ${currentConvoId || 'none'}`],
+                    error: 'conversation changed during poll',
+                };
+            }
+        }
         const answers = await readAssistantMessages(page);
```

Helper:
```diff
+function extractConversationId(url) {
+    if (!url) return null;
+    const match = url.match(/\/c\/([a-f0-9-]+)/);
+    return match ? match[1] : null;
+}
```

---

### Fix 6 — Session URL Reuse: Selector Wait + Session Persist
**Priority: P2** | **Files: MODIFY `web-ai/chatgpt.mjs`, MODIFY `web-ai/tab-recovery.mjs`**

**Round 4 issue:** Two gaps: (1) `recoverSessionTab`'s new-tab path (line 52, `createTab`) did not call `waitForConversationReady`. (2) `recoverSessionTab`'s existing-tab path (line 41, `page.goto`) did not persist redirect URL.

**MODIFY `web-ai/chatgpt.mjs`**

Add exported helper (near `waitForStableAssistantCount`, ~line 650):
```diff
+const CONVERSATION_URL_PATTERN = /\/c\/[a-f0-9-]+/;
+
+/**
+ * Wait for conversation page to be ready after navigation.
+ * For existing conversations (URL contains /c/), waits for assistant message
+ * selectors before counting. For new conversations, skips selector wait.
+ * @param {any} page
+ * @param {string} url
+ */
+export async function waitForConversationReady(page, url) {
+    if (CONVERSATION_URL_PATTERN.test(url || '')) {
+        await page.locator(ASSISTANT_SELECTORS[0]).first()
+            .waitFor({ state: 'attached', timeout: 10_000 })
+            .catch(() => undefined);
+    }
+    await waitForStableAssistantCount(page);
+}
```

Update `sendWebAi`'s `if (input.url)` block (~lines 141-144):
```diff
     if (input.url) {
         const page = await deps.getPage();
-        await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
+        await page.goto(input.url, { waitUntil: 'load', timeout: 30_000 });
+        await waitForConversationReady(page, input.url);
+        const redirectedUrl = page.url();
+        if (redirectedUrl !== input.url) {
+            input.url = redirectedUrl;
+        }
     }
```

**MODIFY `web-ai/tab-recovery.mjs`**

Update imports:
```diff
-import { createTab, isTabAlive, getPageByTargetId, listManagedTabs } from '../skills/browser/tab-manager.mjs';
+import { createTab, isTabAlive, getPageByTargetId, waitForPageByTargetId, listManagedTabs } from '../skills/browser/tab-manager.mjs';
```

Add import:
```diff
+import { waitForConversationReady } from './chatgpt.mjs';
```

**Path 1:** `withSessionPage` existing-tab navigation (~line 197-199):
```diff
         if (current.conversationUrl && page.url() !== current.conversationUrl) {
-            await page.goto(current.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
+            await page.goto(current.conversationUrl, { waitUntil: 'load', timeout: 30_000 });
+            await waitForConversationReady(page, current.conversationUrl);
+            const finalUrl = page.url();
+            if (finalUrl !== current.conversationUrl) {
+                updateSession(sessionId, { conversationUrl: finalUrl });
+            }
         }
```

**Path 2:** `recoverSessionTab` existing-tab navigation (~line 39-41):
```diff
             if (currentUrl !== session.conversationUrl) {
-                await page.goto(/** @type {string} */ (session.conversationUrl), { waitUntil: 'domcontentloaded', timeout: 30_000 });
+                await page.goto(/** @type {string} */ (session.conversationUrl), { waitUntil: 'load', timeout: 30_000 });
+                await waitForConversationReady(page, /** @type {string} */ (session.conversationUrl));
+                const finalUrl = page.url();
+                if (finalUrl !== session.conversationUrl) {
+                    await updateSession(session.sessionId, { conversationUrl: finalUrl });
+                }
             }
```

**Path 3:** `recoverSessionTab` new-tab path (~line 52-62):
```diff
     // 2. Create new tab
     const newTab = await createTab(port, session.conversationUrl || 'about:blank');
+    // Wait for page handle unconditionally, then conversation DOM
+    let recoveredConversationUrl = session.conversationUrl;
+    if (session.conversationUrl) {
+        const newPage = await waitForPageByTargetId(port, newTab.targetId);
+        await waitForConversationReady(newPage, session.conversationUrl);
+        const finalUrl = newPage.url();
+        if (finalUrl !== session.conversationUrl) {
+            recoveredConversationUrl = finalUrl;
+        }
+    }

     // 3. Update session binding
     await updateSession(session.sessionId, {
         targetId: newTab.targetId,
+        conversationUrl: recoveredConversationUrl,
         tabState: {
```

**Why this works:** All three navigation paths in tab-recovery now:
1. Use `waitUntil: 'load'` instead of `'domcontentloaded'`
2. Call `waitForConversationReady()` which handles selector wait for existing conversations
3. Persist redirect URL back to the session

The new-tab path via `createTab()` navigates to the URL as part of tab creation. After the tab is created, we get the page handle and run the same conversation-ready wait. This covers the gap identified in Round 4.

---

### Fix 7 — Thinking Placeholder: Prevent "Stopped thinking" as Answer
**Priority: P1** | **File: MODIFY `web-ai/chatgpt.mjs`**

**Problem:** When ChatGPT Pro's extended thinking is interrupted (user or accidental stop-button click), the assistant turn text becomes something like `"Stopped thinking"`, `"Thought for 12s"`, or `"Thought for 3m 2s"`. `PLACEHOLDER_PATTERNS` (lines 46-57) covers `"thinking"` and `"pro thinking"` but NOT these variants. `isFinalAnswer()` passes them through, and agbrowse returns the thinking indicator text as the "answer".

Additionally, `cleanAssistantText()` (line 691) strips `"Thought for Xs"` prefix but only as a leading prefix — if the entire text IS just `"Thought for 3m 2s"` with no actual content after, the cleaned result is empty string, which `filter(Boolean)` removes. That path is safe. But `"Stopped thinking"` has no such cleanup and becomes a false answer.

**Two changes:** (A) Expand `cleanAssistantText` to strip all thinking-duration headers (not just `Xs`), then (B) add only whole-string placeholder patterns.

**MODIFY `web-ai/chatgpt.mjs`** — Expand `cleanAssistantText` (~line 689-692):

```diff
 function cleanAssistantText(text) {
     return String(text || '')
-        .replace(/^Thought for\s+\d+s\s*/i, '')
+        .replace(/^Thought for\s+[\dm\s]+s(?:econds?)?\s*/i, '')
         .trim();
 }
```

This handles `"Thought for 3s"`, `"Thought for 3m 2s"`, `"Thought for 12 seconds"`, and `"Thought for 1m 30s Some actual answer"`. The answer content after the header is preserved.

**MODIFY `web-ai/chatgpt.mjs`** — Add whole-string-only placeholders (~lines 46-57):

```diff
 const PLACEHOLDER_PATTERNS = [
     /^answer now$/i,
     /^pro thinking/i,
     /^finalizing answer$/i,
     /^instant$/i,
     /^thinking$/i,
     /^pro$/i,
     /^configure\.{0,3}$/i,
     /^reading documents?$/i,
     /^analyzing files?$/i,
+    /^stopped thinking$/i,
+    /^reasoning$/i,
+    /^deep thinking$/i,
+    /^searching\.{0,3}$/i,
+    /^browsing\.{0,3}$/i,
     /^\s*$/,
 ];
```

**Why this is safe:**
- All new patterns are anchored with both `^` and `$` (or the existing anchor-at-end via `$` implicitly when the pattern is the full string). `"Searching..."` and `"Browsing..."` use `\.{0,3}$` to match optional trailing dots AND anchor at end — so `"Searching the web for relevant results"` (a real answer) is NOT matched.
- `"Stopped thinking"` and `"Reasoning"` are exact whole-string matches — no risk of matching real content.
- `"Deep thinking"` is ChatGPT's UI indicator text, not user content.
- `"Thought for Xm Ys"` is now handled by `cleanAssistantText` (stripped to empty → filtered by `filter(Boolean)` in `readAssistantMessages`), so it doesn't need a placeholder pattern.

---

### Fix 8 — Zip Default for Multi-File Upload Context Packages
**Priority: P2** | **Files: MODIFY `web-ai/context-pack/builder.mjs`, MODIFY `web-ai/context-pack/renderer.mjs`**

**Problem:** When `--context-from-files` resolves multiple files and transport is `upload`, agbrowse writes a single `.md` file containing all files concatenated as markdown code blocks. This has three issues:
1. The `.md` file can exceed inline char limits for large multi-file contexts
2. Binary files (images, PDFs) are excluded from the markdown render
3. ChatGPT/Gemini can read zip contents natively — zip preserves original file paths and includes binary files

**Two changes:** (A) Use `file.path` (not `file.absolutePath`) and zip from resolved paths. (B) For upload-mode zipping, collect raw file paths from the glob expansion (before binary exclusion) so binary files like images/PDFs are included in the zip.

**MODIFY `web-ai/context-pack/file-selector.mjs`** — Export expanded paths for zip mode:

Add to `buildContextPack` return value (~line 24-51):
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

`expanded` is a string array of absolute paths from `expandContextPaths()`. `allPaths` is a snapshot taken BEFORE binary exclusion in the read loop. The zip path uses these to include binary files.

**MODIFY `web-ai/context-pack/builder.mjs`** — Zip packaging for upload transport (~lines 68-83):

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

Also update imports at top of builder.mjs:
```diff
+import { buildContextPack } from './file-selector.mjs';
+import { buildContextRenderResult } from './renderer.mjs';
```
Note: `buildContextPackageResult` was a wrapper for `buildContextPack` + `buildContextRenderResult`. The zip path now calls them separately to access `selected.allPaths`.

**Dependency:** `archiver` — cross-platform zip library, pure JS, no native bindings. Node.js `zlib` is built-in; `archiver` wraps it with a streaming API.

```bash
npm install archiver
```

**Integration notes:**
- `attachLocalFileLive()` already accepts `.zip` files (not in `UNSUPPORTED_EXTENSIONS`)
- `preflightAttachment()` passes `.zip` through without issues
- ChatGPT natively reads zip contents (proven by our 7-round audit)
- Gemini and Grok also accept zip uploads
- `allPaths` includes binary files (images, PDFs) that were excluded from text rendering
- The `--file` flag for explicit single-file upload is unchanged — this only affects `--context-from-files` upload transport

**Backward compatibility:**
- `--context-transport inline` is unchanged (uses `composerText`)
- `--context-transport upload` now produces `.zip` instead of `.md`
- `--inline-only` is unchanged
- Single-file `--file` is unchanged (bypasses context packaging entirely)

---

## Files Changed Summary

| File | Action | Fixes |
|------|--------|-------|
| `web-ai/policy/default-policy.mjs` | MODIFY | #1 |
| `web-ai/policy/schema.mjs` | MODIFY | #1 |
| `web-ai/policy/enforce.mjs` | MODIFY | #1 (compat) |
| `web-ai/mcp-server.mjs` | MODIFY | #1 |
| `web-ai/cli.mjs` | MODIFY | #1, #2 |
| `web-ai/chatgpt.mjs` | MODIFY | #3, #5, #6, #7 |
| `web-ai/gemini-live.mjs` | MODIFY | #3 |
| `web-ai/grok-live.mjs` | MODIFY | #3 |
| `web-ai/active-command-store.mjs` | MODIFY | #4 |
| `web-ai/tab-recovery.mjs` | MODIFY | #3, #6 |
| `web-ai/context-pack/builder.mjs` | MODIFY | #8 |
| `web-ai/context-pack/file-selector.mjs` | MODIFY | #8 |
| `package.json` | MODIFY | #8 (add `archiver` dep) |
