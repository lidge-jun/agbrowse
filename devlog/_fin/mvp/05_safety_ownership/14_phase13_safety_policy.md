# Phase 13 — Safety policy and prompt-injection boundaries

Add a repo-wide action policy before expanding the browser mutation surface.
This phase prevents over-engineering from becoming unsafe engineering.

## PR 13.1 — Policy schema and enforcement

### Diff

- NEW `web-ai/policy/schema.mjs`
- NEW `web-ai/policy/enforce.mjs`
- NEW `web-ai/policy/default-policy.mjs`
- MODIFY `web-ai/cli.mjs`
- MODIFY `web-ai/mcp-server.mjs`
- NEW `test/unit/web-ai-policy.test.mjs`
- NEW `test/integration/web-ai-policy-cli.test.mjs`

### Policy fields

```js
{
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
  promptInjectionBoundary: 'strict'
}
```

### Public surface

```bash
agbrowse web-ai query --policy ./policy.json ...
agbrowse click e3 --unsafe-allow evaluate
```

### Tests

- Risky actions are denied before browser mutation.
- Unknown policy keys fail closed.
- `--policy` path traversal is rejected.
- `--unsafe-allow` is required for explicitly unsafe actions.
- Error envelope includes policy rule ID and `mutationAllowed: false`.

### PASS

- Policy enforcement is shared by CLI and MCP mutations.
- No state-changing Phase 15 command can bypass policy.

## PR 13.2 — Prompt/content boundaries

### Diff

- NEW `web-ai/policy/content-boundary.mjs`
- MODIFY `web-ai/question.mjs`
- NEW `test/unit/content-boundary.test.mjs`
- NEW `test/fixtures/prompt-injection/*.html`

### Prompt contract

- User instruction, repo context, provider output, and webpage text must be
  separate sections.
- Webpage text is labeled untrusted.
- Page-originated instructions cannot override system/user instructions.

### Tests

- Malicious fixture text says "ignore prior instructions"; envelope preserves
  it as untrusted page content.
- Research prompt still includes source discipline.
- Grok-only source discipline remains vendor-specific.

### PASS

- Provider prompts keep provenance boundaries.
- Prompt-injection fixtures cannot change the requested action.

## cli-jaw mirror

- Mirror policy schema in TypeScript.
- HTTP browser routes enforce policy before actions.
- Keep error shape compatible with agbrowse.

## Not now

- No per-site policy UI.
- No policy dashboard.
- No LLM-based risk classifier.
