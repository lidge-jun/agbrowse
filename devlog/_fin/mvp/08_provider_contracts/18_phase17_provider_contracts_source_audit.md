# Phase 17 — Provider workflow contracts and source audit

Make ChatGPT/Gemini/Grok support operation-level and auditable instead of
claiming vague provider support.

## PR 17.1 — Provider manifest

### Diff

- NEW `web-ai/providers/manifest.mjs`
- NEW `web-ai/providers/chatgpt-contract.mjs`
- NEW `web-ai/providers/gemini-contract.mjs`
- NEW `web-ai/providers/grok-contract.mjs`
- MODIFY `web-ai/capability.mjs`
- MODIFY `web-ai/doctor.mjs`
- MODIFY `web-ai/tool-schema.mjs`
- NEW `test/unit/provider-contract.test.mjs`

### Contract shape

```js
{
  provider: 'chatgpt',
  operations: {
    composerFill: 'required',
    submit: 'required',
    poll: 'required',
    stop: 'required',
    copyMarkdown: 'optional',
    uploadFile: 'supported',
    contextPackage: 'supported',
    modelSelect: 'supported'
  }
}
```

### PASS

- Unsupported provider/model/effort combinations fail before mutation.
- Doctor prints operation-level capability rows.
- CLI help/status and MCP descriptions use the same manifest.

## PR 17.2 — Answer artifact

### Diff

- NEW `web-ai/answer-artifact.mjs`
- MODIFY `web-ai/chatgpt.mjs`
- MODIFY `web-ai/gemini-live.mjs`
- MODIFY `web-ai/grok-live.mjs`
- NEW `test/unit/answer-artifact.test.mjs`

### Artifact shape

```js
{
  provider: 'grok',
  sessionId: '01...',
  conversationUrl: 'https://...',
  capturedBy: 'copy-button',
  markdown: '...',
  text: '...',
  exactnessScore: 1,
  responseStableMs: 1500,
  warnings: []
}
```

### PASS

- Copy-button captures and DOM fallbacks are marked separately.
- Poll/query results include capture method and warnings.
- Exactness can be measured against fixtures.

## PR 17.3 — Source audit

### Diff

- NEW `web-ai/source-audit.mjs`
- MODIFY `web-ai/question.mjs`
- MODIFY `web-ai/answer-artifact.mjs`
- NEW `test/unit/source-audit.test.mjs`

### Audit output

- `claims`
- `claimsWithInlineSource`
- `unsourcedClaims`
- `sourceQualityRows`
- `gaps`

### PASS

- Grok responses are checked for source-quality table compliance.
- `--require-source-audit` can fail research smoke below threshold.
- Absence claims require checked scope/date.

## PR 17.4 — Live provider smoke matrix

### Diff

- NEW `scripts/run-live-provider-smoke.mjs`
- NEW `docs/live-smoke.md`
- NEW `test/integration/live-provider-smoke.contract.test.mjs`

### PASS

- Manual/secret-gated smoke covers ChatGPT, Gemini, and Grok.
- Smoke writes trace artifacts.
- No credentials or conversation content are committed.

## cli-jaw mirror

- Mirror manifest shape in TypeScript.
- Keep `leaseClosedTabs`, source warnings, and trace IDs in HTTP output.
