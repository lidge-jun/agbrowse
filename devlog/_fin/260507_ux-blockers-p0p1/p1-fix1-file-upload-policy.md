# Fix 1 — File Upload Policy: Provider-Aware Defaults

**Priority: P1** | **Status: planned** | **Audit: Rounds 1-7 PASS**

## Files

| File | Action |
|------|--------|
| `web-ai/policy/default-policy.mjs` | MODIFY |
| `web-ai/policy/schema.mjs` | MODIFY |
| `web-ai/policy/enforce.mjs` | MODIFY |
| `web-ai/mcp-server.mjs` | MODIFY |
| `web-ai/cli.mjs` | MODIFY |

## Problem

`--file` flag fails for chatgpt/gemini/grok because `allowFileAccess` defaults to `false`. Users must create a policy file just to upload files to providers that natively support it.

## Approach

Track which keys the user explicitly supplied, regardless of source (file or inline). `applyProviderDefaults` takes `{ explicitKeys: Set<string> }`. A key is "explicit" if:
- CLI path: it appeared in the user's policy file (keys of `JSON.parse(raw)` before merge with defaults)
- MCP path: it appeared in `args.policy` (keys of the inline object)

If `explicitKeys` is empty (no policy file, no inline policy), all provider defaults apply freely.

## Diffs

### MODIFY `web-ai/policy/default-policy.mjs`

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

### MODIFY `web-ai/policy/schema.mjs` — Return explicit keys from `loadPolicy`

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

### MODIFY `web-ai/policy/enforce.mjs` — Update `loadAndEnforcePolicy` for new return shape

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

### MODIFY `web-ai/mcp-server.mjs` — MCP path

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

### MODIFY `web-ai/cli.mjs` — CLI path

Update imports:
```diff
-import { loadAndEnforcePolicy } from './policy/enforce.mjs';
+import { enforcePolicy } from './policy/enforce.mjs';
+import { loadPolicy } from './policy/schema.mjs';
+import { applyProviderDefaults } from './policy/default-policy.mjs';
```

Update `enforceCliPolicy` (~line 584):
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
