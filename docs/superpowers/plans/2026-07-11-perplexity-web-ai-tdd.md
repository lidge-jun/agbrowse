# Perplexity Web-AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Perplexity as a first-class, session-persistent web-ai provider with model selection, a verified thinking toggle, file upload, structured citations, CLI/MCP support, and deterministic provider fixtures.

**Architecture:** Follow the existing Gemini/Grok pair-module pattern: `perplexity-model.mjs` owns model and thinking controls, while `perplexity-live.mjs` owns browser lifecycle and response capture. Extend shared answer-artifact, session-finalization, timeout, CLI, MCP, doctor, policy, recovery, and eval contracts before adding live browser mutation.

**Tech Stack:** ESM JavaScript with `// @ts-check`, Playwright Core over CDP, Vitest, JSON session persistence, provider DOM fixtures.

## Global Constraints

- Provider ID is exactly `perplexity`.
- Default provider URL is `https://www.perplexity.ai`.
- Default timeout is exactly 1200 seconds.
- Thinking-enabled timeout tier is exactly 3600 seconds.
- `--model` omission must not mutate the model picker.
- `--effort` omission must not mutate the thinking switch.
- Perplexity `--effort` requires explicit `--model`.
- Thinking OFF aliases: `off`, `low`, `light`, `standard`, `normal`, `default`.
- Thinking ON aliases: `on`, `extended`, `high`, `xhigh`, `heavy`.
- Locked models fail before click with `provider.model-entitlement`.
- Missing thinking controls fail before submit with `provider.mode-unavailable`.
- Never silently select a different model.
- Every completed Perplexity result stores `citations`, including `[]`.
- `answer` remains the full string for backward compatibility.
- `SESSION_STORE_VERSION` remains `1`.
- `provider-adapter.mjs` is not activated or broadly refactored.
- Spaces, Focus modes, Perplexity Deep Research, login automation, and subscription changes are out of scope.
- `Sonar 2` is treated as a non-selectable group heading unless captured DOM proves it is an interactive model row. If live evidence contradicts this, stop and amend the design and plan before coding the alias.

---

## File Map

### New production files

- `web-ai/perplexity-model.mjs`: aliases, labels, picker, lock detection, thinking state, capability probe.
- `web-ai/perplexity-citations.mjs`: pure citation normalization and page extraction.
- `web-ai/perplexity-live.mjs`: provider status/send/poll/query/stop lifecycle.

### New tests and fixtures

- `test/unit/web-ai-perplexity-model.test.mjs`
- `test/unit/web-ai-perplexity-citations.test.mjs`
- `test/unit/web-ai-perplexity-live-policy.test.mjs`
- `test/integration/web-ai-perplexity-session.test.mjs`
- `test/fixtures/provider-dom/perplexity-baseline.html`
- `test/fixtures/provider-dom/perplexity-cosmetic-churn.html`
- `test/fixtures/provider-dom/perplexity-structural-churn.html`
- `test/fixtures/provider-dom/perplexity-breaking.html`
- `test/fixtures/provider-dom/perplexity-model-picker-ko.html`
- `test/fixtures/provider-dom/perplexity-model-picker-en.html`
- `test/fixtures/provider-dom/perplexity-streaming.html`
- `test/fixtures/provider-dom/perplexity-complete-citations.html`

### Shared files modified

- `web-ai/types.mjs`
- `types/agbrowse-shared.d.ts`
- `web-ai/answer-artifact.mjs`
- `web-ai/tab-finalizer.mjs`
- `web-ai/session.mjs`
- `web-ai/question.mjs`
- `web-ai/cli.mjs`
- `web-ai/mcp-server.mjs`
- `web-ai/tool-schema.mjs`
- `web-ai/cli-sessions.mjs`
- `web-ai/copy-markdown.mjs`
- `web-ai/doctor.mjs`
- `web-ai/navigation-ready.mjs`
- `web-ai/tab-recovery.mjs`
- `web-ai/policy/default-policy.mjs`
- `web-ai/vendor-editor-contract.mjs`
- `web-ai/capability-types.mjs`
- `web-ai/eval/types.mjs`
- `skills/browser/browser.mjs`
- `skills/browser/SKILL.md`
- `skills/browser/extract.mjs`
- `skills/search/references/cli-reference.md`
- `skills/web-ai/SKILL.md`
- `README.md`
- `structure/INDEX.md`
- `structure/CAPABILITY_TRUTH_TABLE.md`
- `structure/commands.md`
- `structure/runtime_contracts.md`
- `structure/release_gates.md`
- `structure/phase_status.md`
- `docs/index.html`
- `docs/dev/index.html`
- `docs/dev/concepts/architecture.html`
- `docs/dev/concepts/web-ai-sessions.html`
- `docs/dev/guides/web-ai.html`
- `docs/dev/reference/cli.html`
- `docs/dev/ko/index.html`
- `docs/dev/ko/concepts/architecture.html`
- `docs/dev/ko/concepts/web-ai-sessions.html`
- `docs/dev/ko/guides/web-ai.html`
- `docs/dev/ko/reference/cli.html`

## Preflight: Install Dependencies And Record The Baseline

- [ ] **Step 1: Install the lockfile-defined dependency tree**

```bash
npm ci
```

Expected: exits 0 without changing `package-lock.json`.

- [ ] **Step 2: Run the baseline test and documentation gates**

```bash
npm test
npm run docs:drift
```

Expected: both commands PASS before feature code is changed. If either command
fails, record the exact pre-existing failure and do not broaden this feature to
repair unrelated baseline defects.

- [ ] **Step 3: Confirm the implementation starts from a clean tree**

```bash
git status --short
```

Expected: no output after the committed design and plan documents.

---

### Task 1: Freeze The Observed Picker Contract And Pure Model Rules

**Files:**
- Create: `test/fixtures/provider-dom/perplexity-model-picker-ko.html`
- Create: `test/fixtures/provider-dom/perplexity-model-picker-en.html`
- Create: `test/unit/web-ai-perplexity-model.test.mjs`
- Create: `web-ai/perplexity-model.mjs`

**Interfaces:**
- Produces: `normalizePerplexityModelChoice(value): string|null`
- Produces: `normalizePerplexityModelLabel(value): string|null`
- Produces: `normalizePerplexityEffort(value): 'on'|'off'|null`
- Produces: `classifyPerplexityModelRow(row): { model:string|null, locked:boolean, selected:boolean, selectable:boolean }`
- Produces: `selectPerplexityModel(page, model, effort): Promise<PerplexityModelSelection|null>`

- [ ] **Step 1: Capture and sanitize the live picker DOM**

Run the authenticated headed browser:

```bash
agbrowse navigate https://www.perplexity.ai
agbrowse snapshot --interactive --max-nodes 240
```

Open the model picker using the returned interactive ref, then capture only the
picker subtree:

```bash
agbrowse get-dom --selector '[role="dialog"], [role="menu"], [role="listbox"]' --max-chars 60000
```

Create sanitized Korean and English fixtures that retain:

```html
<div role="dialog" data-eval-key="model-picker">
  <div data-eval-key="best-row" role="button" aria-pressed="false">최고</div>
  <div data-eval-key="sonar-group">Sonar 2</div>
  <div data-eval-key="terra-row" role="button" aria-pressed="true">
    <span>GPT-5.6 Terra</span>
    <span>새로 만들기</span>
    <button role="switch" aria-label="사고" aria-checked="true"></button>
  </div>
  <div data-eval-key="sol-row" role="button" aria-disabled="true">
    <span>GPT-5.6 Sol</span><span>Max</span>
  </div>
</div>
```

Acceptance: `sonar-group` has no interactive role, enabled button ancestor, or
selected-state attribute. If it is interactive in the captured DOM, stop and
amend the design before continuing.

- [ ] **Step 2: Write failing pure-contract tests**

```js
import { describe, expect, it } from 'vitest';
import {
    classifyPerplexityModelRow,
    normalizePerplexityEffort,
    normalizePerplexityModelChoice,
    normalizePerplexityModelLabel,
} from '../../web-ai/perplexity-model.mjs';

describe('Perplexity model contract', () => {
    it.each([
        ['best', 'best'],
        ['최고', 'best'],
        ['GPT-5.6 Terra 새로 만들기', 'gpt-5.6-terra'],
        ['GPT-5.6 Sol Max', 'gpt-5.6-sol'],
        ['Gemini 3.1 Pro', 'gemini-3.1-pro'],
        ['Claude Sonnet 5', 'claude-sonnet-5'],
        ['Claude Opus 4.8 Max', 'claude-opus-4.8'],
        ['GLM 5.2', 'glm-5.2'],
        ['Kimi K2.6', 'kimi-k2.6'],
        ['Nemotron 3 Ultra', 'nemotron-3-ultra'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizePerplexityModelChoice(input)).toBe(expected);
        expect(normalizePerplexityModelLabel(input)).toBe(expected);
    });

    it('does not treat the Sonar 2 group heading as a model', () => {
        expect(normalizePerplexityModelLabel('Sonar 2')).toBeNull();
    });

    it.each([
        ['off', 'off'], ['standard', 'off'], ['default', 'off'],
        ['on', 'on'], ['extended', 'on'], ['heavy', 'on'],
    ])('maps effort %s to %s', (input, expected) => {
        expect(normalizePerplexityEffort(input)).toBe(expected);
    });

    it('classifies locked and selected evidence before clicking', () => {
        expect(classifyPerplexityModelRow({
            text: 'GPT-5.6 Sol Max',
            role: 'button',
            ariaDisabled: 'true',
            hasLockIcon: true,
            selected: false,
        })).toEqual({
            model: 'gpt-5.6-sol',
            locked: true,
            selected: false,
            selectable: false,
        });
    });
});
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
npx vitest run test/unit/web-ai-perplexity-model.test.mjs
```

Expected: FAIL because `web-ai/perplexity-model.mjs` does not exist.

- [ ] **Step 4: Implement the pure model contract**

Create the module with these exported tables and functions:

```js
// @ts-check
import { WebAiError } from './errors.mjs';

export const PERPLEXITY_MODEL_ALIASES = Object.freeze({
    best: 'best',
    auto: 'best',
    'gpt-5.6-terra': 'gpt-5.6-terra',
    terra: 'gpt-5.6-terra',
    'gpt-5.6-sol': 'gpt-5.6-sol',
    sol: 'gpt-5.6-sol',
    'gemini-3.1-pro': 'gemini-3.1-pro',
    'claude-sonnet-5': 'claude-sonnet-5',
    'claude-opus-4.8': 'claude-opus-4.8',
    'glm-5.2': 'glm-5.2',
    'kimi-k2.6': 'kimi-k2.6',
    'nemotron-3-ultra': 'nemotron-3-ultra',
});

const LABEL_PATTERNS = [
    ['best', /^(best|최고)$/i],
    ['gpt-5.6-terra', /^gpt[- ]?5\.6\s+terra\b/i],
    ['gpt-5.6-sol', /^gpt[- ]?5\.6\s+sol\b/i],
    ['gemini-3.1-pro', /^gemini\s+3\.1\s+pro\b/i],
    ['claude-sonnet-5', /^claude\s+sonnet\s+5\b/i],
    ['claude-opus-4.8', /^claude\s+opus\s+4\.8\b/i],
    ['glm-5.2', /^glm\s+5\.2\b/i],
    ['kimi-k2.6', /^kimi\s+k2\.6\b/i],
    ['nemotron-3-ultra', /^nemotron\s+3\s+ultra\b/i],
];

export function normalizePerplexityModelChoice(value) {
    const key = String(value || '').trim().toLowerCase();
    return PERPLEXITY_MODEL_ALIASES[key] || normalizePerplexityModelLabel(value);
}

export function normalizePerplexityModelLabel(value) {
    const text = String(value || '')
        .replace(/\bMax\b/gi, '')
        .replace(/새로\s*만들기/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const [model, pattern] of LABEL_PATTERNS) {
        if (pattern.test(text)) return model;
    }
    return null;
}

export function normalizePerplexityEffort(value) {
    const key = String(value || '').trim().toLowerCase();
    if (['off', 'low', 'light', 'standard', 'normal', 'default'].includes(key)) return 'off';
    if (['on', 'extended', 'high', 'xhigh', 'heavy'].includes(key)) return 'on';
    return null;
}

export function classifyPerplexityModelRow(row) {
    const model = normalizePerplexityModelLabel(row?.text);
    const locked = row?.ariaDisabled === 'true' || row?.hasLockIcon === true;
    const selected = row?.selected === true;
    return {
        model,
        locked,
        selected,
        selectable: Boolean(model && !locked && ['button', 'option', 'menuitem'].includes(row?.role)),
    };
}

export function lockedModelError(model, evidence = {}) {
    return new WebAiError({
        errorCode: 'provider.model-entitlement',
        stage: 'provider-select-mode',
        vendor: 'perplexity',
        retryHint: 'choose-unlocked-model',
        mutationAllowed: false,
        message: `Perplexity model is locked by account entitlement: ${model}`,
        evidence: { model, ...evidence },
    });
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
npx vitest run test/unit/web-ai-perplexity-model.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-ai/perplexity-model.mjs test/unit/web-ai-perplexity-model.test.mjs test/fixtures/provider-dom/perplexity-model-picker-ko.html test/fixtures/provider-dom/perplexity-model-picker-en.html
git commit -m "test: define Perplexity model picker contract"
```

---

### Task 2: Preserve Citations In Answer Artifacts And Sessions

**Files:**
- Modify: `web-ai/types.mjs`
- Modify: `types/agbrowse-shared.d.ts`
- Modify: `web-ai/answer-artifact.mjs`
- Modify: `web-ai/tab-finalizer.mjs`
- Modify: `test/unit/web-ai-answer-artifact.test.mjs`
- Modify: `test/unit/web-ai-tab-finalizer.test.mjs`

**Interfaces:**
- Produces: `CitationArtifact = { index:number|null, title:string, url:string }`
- Produces: `AnswerArtifact.citations?: CitationArtifact[]`
- Changes: `finalizeProviderTab(deps, { answerArtifact, ... })`

- [ ] **Step 1: Write failing citation preservation tests**

Add:

```js
it('preserves normalized citations through every artifact helper', () => {
    const citations = [
        { index: 1, title: 'Primary', url: 'https://example.com/a' },
    ];
    const direct = createAnswerArtifact({
        provider: 'perplexity',
        text: 'answer',
        citations,
    });
    expect(direct.citations).toEqual(citations);

    const fromPoll = artifactFromPollResult({
        vendor: 'perplexity',
        answerText: 'answer',
        citations,
    });
    expect(fromPoll.citations).toEqual(citations);

    const wrapped = withAnswerArtifact({
        ok: true,
        vendor: 'perplexity',
        answerText: 'answer',
        citations,
    });
    expect(wrapped.answerArtifact.citations).toEqual(citations);
});
```

Add a finalizer round-trip test:

```js
it('stores answer string and structured artifact in the session record', async () => {
    const { createSession, getSession } = await import('../../web-ai/session.mjs');
    const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
    const session = createSession(
        { vendor: 'perplexity', prompt: 'hello', attachmentPolicy: 'inline-only' },
        { targetId: 'target-pplx', conversationUrl: 'https://www.perplexity.ai/search/test' },
    );
    const answerArtifact = {
        provider: 'perplexity',
        capturedBy: 'dom-fallback',
        text: 'answer',
        markdown: 'answer',
        citations: [{ index: 1, title: 'A', url: 'https://example.com/a' }],
    };

    await finalizeProviderTab({ getPort: () => 9222 }, {
        vendor: 'perplexity',
        session,
        page: { url: () => 'https://www.perplexity.ai/search/test' },
        answerText: 'answer',
        answerArtifact,
    });

    expect(getSession(session.sessionId)).toMatchObject({
        answer: 'answer',
        answerArtifact: {
            provider: 'perplexity',
            citations: [{ index: 1, title: 'A', url: 'https://example.com/a' }],
        },
    });
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/unit/web-ai-answer-artifact.test.mjs test/unit/web-ai-tab-finalizer.test.mjs
```

Expected: FAIL because citations are dropped and finalizer has no artifact option.

- [ ] **Step 3: Extend shared artifact types**

Add the exact type:

```js
/**
 * @typedef {{ index: number|null, title: string, url: string }} AnswerCitation
 */
```

Extend `AnswerArtifactInput` and `AnswerArtifact` with:

```js
 * @property {AnswerCitation[]} [citations]
```

Mirror the same additive field in `web-ai/types.mjs` and
`types/agbrowse-shared.d.ts`.

- [ ] **Step 4: Preserve citations in artifact helpers**

Add:

```js
function normalizeCitations(value) {
    if (!Array.isArray(value)) return undefined;
    return value
        .filter(row => row && typeof row.url === 'string')
        .map(row => ({
            index: Number.isInteger(row.index) && row.index > 0 ? row.index : null,
            title: typeof row.title === 'string' ? row.title : '',
            url: row.url,
        }));
}
```

In `createAnswerArtifact()`:

```js
const citations = normalizeCitations(input.citations);
return {
    provider: input.provider || 'unknown',
    sessionId: input.sessionId || null,
    conversationUrl: input.conversationUrl || null,
    capturedBy,
    markdown,
    text,
    exactnessScore,
    responseStableMs: Number.isFinite(Number(input.responseStableMs)) ? Number(input.responseStableMs) : null,
    warnings,
    ...(citations ? { citations } : {}),
};
```

In `artifactFromPollResult()` pass:

```js
citations: result.answerArtifact?.citations || result.citations,
```

- [ ] **Step 5: Persist the normalized artifact in finalization**

Import `createAnswerArtifact` and extend options:

```js
 * @property {Record<string, any>} [answerArtifact]
```

Normalize and store:

```js
const normalizedArtifact = answerArtifact
    ? createAnswerArtifact({
        ...answerArtifact,
        provider: answerArtifact.provider || vendor || session.vendor,
        sessionId: answerArtifact.sessionId || session.sessionId,
        conversationUrl: answerArtifact.conversationUrl || conversationUrl,
        text: answerArtifact.text || answerText || '',
        markdown: answerArtifact.markdown || artifactText || answerText || '',
        warnings: [...baseWarnings, ...(answerArtifact.warnings || [])],
    })
    : null;

updateSession(session.sessionId, {
    status: 'complete',
    conversationUrl,
    answer: answerText,
    ...(normalizedArtifact ? { answerArtifact: normalizedArtifact } : {}),
    warnings: baseWarnings,
    completedAt: new Date().toISOString(),
});
```

- [ ] **Step 6: Verify GREEN**

```bash
npx vitest run test/unit/web-ai-answer-artifact.test.mjs test/unit/web-ai-tab-finalizer.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web-ai/types.mjs types/agbrowse-shared.d.ts web-ai/answer-artifact.mjs web-ai/tab-finalizer.mjs test/unit/web-ai-answer-artifact.test.mjs test/unit/web-ai-tab-finalizer.test.mjs
git commit -m "feat: persist structured answer citations"
```

---

### Task 3: Add Citation Normalization As A Pure Provider Module

**Files:**
- Create: `web-ai/perplexity-citations.mjs`
- Create: `test/unit/web-ai-perplexity-citations.test.mjs`

**Interfaces:**
- Produces: `normalizePerplexityCitations(rows, baseUrl): CitationArtifact[]`
- Produces: `extractPerplexityCitations(page, rootSelector): Promise<CitationArtifact[]>`

- [ ] **Step 1: Write failing normalization tests**

```js
import { describe, expect, it } from 'vitest';
import { normalizePerplexityCitations } from '../../web-ai/perplexity-citations.mjs';

describe('Perplexity citations', () => {
    it('resolves, filters, removes fragments, deduplicates, and preserves order', () => {
        expect(normalizePerplexityCitations([
            { index: '1', title: 'A', href: '/source?a=1#part' },
            { index: 2, title: 'A duplicate', href: 'https://www.perplexity.ai/source?a=1#other' },
            { index: '3', title: '', href: 'https://example.com/b?utm=kept' },
            { index: 4, title: 'bad', href: 'javascript:alert(1)' },
        ], 'https://www.perplexity.ai/search/test')).toEqual([
            { index: 1, title: 'A', url: 'https://www.perplexity.ai/source?a=1' },
            { index: 3, title: '', url: 'https://example.com/b?utm=kept' },
        ]);
    });
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/unit/web-ai-perplexity-citations.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalization and DOM extraction**

```js
// @ts-check

export function normalizePerplexityCitations(rows, baseUrl) {
    const seen = new Set();
    const output = [];
    for (const row of rows || []) {
        let url;
        try {
            url = new URL(String(row?.href || row?.url || ''), baseUrl);
        } catch {
            continue;
        }
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        url.hash = '';
        const normalized = url.href;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        const index = Number(row?.index);
        output.push({
            index: Number.isInteger(index) && index > 0 ? index : null,
            title: typeof row?.title === 'string' ? row.title.trim() : '',
            url: normalized,
        });
    }
    return output;
}

export async function extractPerplexityCitations(page, rootSelector) {
    const rows = await page.locator(rootSelector).last().locator('a[href]').evaluateAll(links =>
        links.map((link, offset) => ({
            index: link.getAttribute('data-index') || link.textContent?.match(/\d+/)?.[0] || offset + 1,
            title: link.getAttribute('title') || link.textContent || '',
            href: link.getAttribute('href') || '',
        })),
    ).catch(() => []);
    return normalizePerplexityCitations(rows, page.url());
}
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run test/unit/web-ai-perplexity-citations.test.mjs
git add web-ai/perplexity-citations.mjs test/unit/web-ai-perplexity-citations.test.mjs
git commit -m "feat: normalize Perplexity citations"
```

---

### Task 4: Make Timeout And Session Metadata Effort-Aware

**Files:**
- Modify: `web-ai/session.mjs`
- Modify: `web-ai/cli.mjs`
- Modify: `test/unit/web-ai-timeout-default.test.mjs`
- Modify: `test/unit/web-ai-provider-session.test.mjs`

**Interfaces:**
- Changes: `deriveTimeoutTier(vendor, model, research, effort): string|null`
- Changes: `resolveTimeoutDefaultSec(input, vendor): number`
- Changes: `summarizeEnvelope(input, contextPack): Record<string, unknown>`

- [ ] **Step 1: Write failing timeout tests**

```js
it('uses Perplexity default and thinking timeout tiers', () => {
    expect(resolveTimeoutDefaultSec({}, 'perplexity')).toBe(1200);
    expect(resolveTimeoutDefaultSec({
        model: 'gpt-5.6-terra',
        reasoningEffort: 'on',
    }, 'perplexity')).toBe(3600);
    expect(resolveTimeoutDefaultSec({
        model: 'gpt-5.6-terra',
        reasoningEffort: 'off',
    }, 'perplexity')).toBe(1200);
});

it('persists effort so resume can reconstruct the timeout tier', () => {
    expect(summarizeEnvelope({
        model: 'gpt-5.6-terra',
        reasoningEffort: 'extended',
    })).toMatchObject({
        model: 'gpt-5.6-terra',
        reasoningEffort: 'extended',
    });
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/unit/web-ai-timeout-default.test.mjs test/unit/web-ai-provider-session.test.mjs
```

Expected: FAIL because Perplexity is absent and effort is discarded.

- [ ] **Step 3: Implement the timeout tier**

In `session.mjs`:

```js
const VENDOR_DEFAULT_TIMEOUT_SEC = {
    chatgpt: 1200,
    gemini: 1200,
    grok: 600,
    perplexity: 1200,
};

export const TIER_DEFAULT_TIMEOUT_SEC = Object.freeze({
    instant: 120,
    thinking: 600,
    'chatgpt-pro': 5400,
    'grok-heavy': 3600,
    'perplexity-thinking': 3600,
    'deep-research': 3600,
});
```

Extend the signature and branch:

```js
export function deriveTimeoutTier(vendor, model, research, effort) {
    if (vendor === 'perplexity') {
        const normalized = String(effort || '').trim().toLowerCase();
        if (['on', 'extended', 'high', 'xhigh', 'heavy'].includes(normalized)) {
            return 'perplexity-thinking';
        }
        return null;
    }
}
```

Insert this branch immediately before the current Gemini branch, leaving the
existing Gemini, Grok, and ChatGPT branch bodies byte-for-byte unchanged. Pass
`input.reasoningEffort || input.effort` from
`resolveTimeoutDefaultSec()` and persist it in `summarizeEnvelope()`.

- [ ] **Step 4: Update CLI timeout injection**

Change the send/query default call to:

```js
resolveTimeoutDefaultSec({
    model: values.model,
    research: values.research,
    reasoningEffort: values.effort || values['reasoning-effort'],
}, values.vendor || 'chatgpt')
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run test/unit/web-ai-timeout-default.test.mjs test/unit/web-ai-provider-session.test.mjs
git add web-ai/session.mjs web-ai/cli.mjs test/unit/web-ai-timeout-default.test.mjs test/unit/web-ai-provider-session.test.mjs
git commit -m "feat: add Perplexity timeout tiers"
```

---

### Task 5: Implement Provider Status, Model Selection, Thinking, And Send

**Files:**
- Create: `web-ai/perplexity-live.mjs`
- Create: `test/unit/web-ai-perplexity-live-policy.test.mjs`
- Create: `test/fixtures/provider-dom/perplexity-baseline.html`
- Create: `test/fixtures/provider-dom/perplexity-cosmetic-churn.html`
- Create: `test/fixtures/provider-dom/perplexity-structural-churn.html`
- Create: `test/fixtures/provider-dom/perplexity-breaking.html`
- Modify: `web-ai/perplexity-model.mjs`

**Interfaces:**
- Produces: `perplexityCapabilities`
- Produces: `perplexityStatusWebAi(deps, input)`
- Produces: `perplexitySendWebAi(deps, input)`
- Produces: `perplexityStopWebAi(deps)`

- [ ] **Step 1: Write source-level fail-closed policy tests**

```js
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const live = readFileSync(new URL('../../web-ai/perplexity-live.mjs', import.meta.url), 'utf8');
const model = readFileSync(new URL('../../web-ai/perplexity-model.mjs', import.meta.url), 'utf8');

describe('Perplexity live policy', () => {
    it('uses provider-scoped selectors and typed errors', () => {
        expect(live).toContain("new Set(['perplexity.ai', 'www.perplexity.ai'])");
        expect(live).toContain('perplexity-active-tab-verification');
        expect(live).toContain('provider.composer-not-visible');
        expect(live).toContain('provider.commit-not-verified');
    });

    it('fails before prompt submission for locked models and missing thinking controls', () => {
        expect(model).toContain('provider.model-entitlement');
        expect(model).toContain('provider.mode-unavailable');
        expect(model).not.toContain('model fallback');
        expect(live.indexOf('selectPerplexityModel')).toBeLessThan(live.indexOf('insertPerplexityPrompt'));
    });
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/unit/web-ai-perplexity-live-policy.test.mjs
```

Expected: FAIL because the live module does not exist.

- [ ] **Step 3: Implement model picker mutation and verification**

Complete `selectPerplexityModel()` with this contract:

```js
export async function selectPerplexityModel(page, model, effort) {
    const requestedModel = normalizePerplexityModelChoice(model);
    if (!requestedModel) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: 'perplexity',
            retryHint: 'model-fallback',
            mutationAllowed: false,
            message: `unsupported Perplexity model selection: ${model}`,
            evidence: { model },
        });
    }

    await openPerplexityModelPicker(page);
    const row = await findPerplexityModelRow(page, requestedModel);
    if (!row) throw modelMismatchError(requestedModel);
    const before = await inspectPerplexityModelRow(row);
    if (before.locked) throw lockedModelError(requestedModel, before);
    if (!before.selected) await row.click({ timeout: 5_000 });

    await openPerplexityModelPicker(page);
    const selectedRow = await findPerplexityModelRow(page, requestedModel);
    const selected = await inspectPerplexityModelRow(selectedRow);
    if (!selected.selected) throw modelMismatchError(requestedModel, selected);

    const thinking = normalizePerplexityEffort(effort);
    if (effort && !thinking) throw modeUnavailableError(requestedModel, effort);
    if (thinking) await setPerplexityThinking(selectedRow, thinking);

    return {
        requestedModel,
        resolvedModel: requestedModel,
        resolvedLabel: selected.label,
        locked: false,
        thinking: thinking || null,
        verified: true,
    };
}
```

Use row-scoped switch selectors:

```js
const THINKING_SWITCH_SELECTORS = [
    'button[role="switch"][aria-label="Thinking"]',
    'button[role="switch"][aria-label="사고"]',
    '[role="switch"][aria-label*="thinking" i]',
];
```

- [ ] **Step 4: Implement capability and status**

Use six capabilities matching other providers:

```js
export const perplexityCapabilities = [
    defineCapability('perplexity-active-tab-verification',
        async deps => probeHostMatches(await deps.getPage(), PERPLEXITY_HOSTS)),
    defineCapability('perplexity-composer-visible',
        async deps => probeFirstVisibleSelector(await deps.getPage(), COMPOSER_SELECTORS)),
    defineCapability('perplexity-model-alias-selectable',
        async (deps, input) => perplexityModelCapabilityProbe(await deps.getPage(), input.model, input.reasoningEffort)),
    defineCapability('perplexity-upload-surface-visible',
        async deps => probeFirstVisibleSelector(await deps.getPage(), UPLOAD_SELECTORS)),
    defineCapability('perplexity-copy-button-present',
        async deps => probeFirstVisibleSelector(await deps.getPage(), PERPLEXITY_COPY_SELECTORS.copyButtonSelectors)),
    defineCapability('perplexity-response-streaming',
        async deps => probePerplexityStreaming(await deps.getPage())),
];
```

- [ ] **Step 5: Implement send with commit evidence**

The send order must be:

```js
await dismissPerplexityOverlays(page, warnings);
await openFreshPerplexityThread(page, warnings);
const composerSelector = await findFirstVisibleSelector(page, COMPOSER_SELECTORS, 10_000);
const modelSelection = input.model
    ? await selectPerplexityModel(page, input.model, input.reasoningEffort)
    : null;
await insertPerplexityPrompt(page, composerSelector, rendered.composerText);
if (uploadPath) await attachPerplexityFile(page, uploadPath, input);
const baseline = await capturePerplexityBaseline(page);
await submitPerplexityPrompt(page);
await verifyPerplexityCommit(page, baseline);
```

Create the session with:

```js
const session = createSession(envelope, {
    vendor: 'perplexity',
    targetId: await deps.getTargetId?.(),
    originalUrl: baseline.url,
    conversationUrl: page.url(),
    deadlineAt: resolveDeadlineAt(input, 'perplexity'),
    envelopeSummary: summarizeEnvelope(input, contextPack),
});
if (modelSelection) updateSession(session.sessionId, { modelSelection });
```

- [ ] **Step 6: Implement upload evidence**

Use `page.waitForEvent('filechooser')` or a visible `input[type=file]`. After
setting files, require a visible attachment chip whose text contains the
uploaded basename. On failure throw:

```js
new WebAiError({
    errorCode: 'provider.attachment-evidence-missing',
    stage: 'attachment-verify',
    vendor: 'perplexity',
    retryHint: 're-upload',
    mutationAllowed: true,
    message: `Perplexity attachment was not verified: ${basename(filePath)}`,
});
```

- [ ] **Step 7: Verify focused tests and fixture eval**

```bash
npx vitest run test/unit/web-ai-perplexity-model.test.mjs test/unit/web-ai-perplexity-live-policy.test.mjs
node scripts/run-web-ai-eval.mjs --vendor perplexity --fixtures test/fixtures/provider-dom --json
```

Expected: unit tests PASS; fixture eval passes baseline/cosmetic/structural and
fails only the intentional breaking fixture metric.

- [ ] **Step 8: Commit**

```bash
git add web-ai/perplexity-model.mjs web-ai/perplexity-live.mjs test/unit/web-ai-perplexity-live-policy.test.mjs test/fixtures/provider-dom/perplexity-*.html
git commit -m "feat: add Perplexity send lifecycle"
```

---

### Task 6: Implement Polling, Citation Capture, And Session Finalization

**Files:**
- Modify: `web-ai/perplexity-live.mjs`
- Create: `test/fixtures/provider-dom/perplexity-streaming.html`
- Create: `test/fixtures/provider-dom/perplexity-complete-citations.html`
- Create: `test/integration/web-ai-perplexity-session.test.mjs`

**Interfaces:**
- Produces: `perplexityPollWebAi(deps, input)`
- Produces: `perplexityQueryWebAi(deps, input)`

- [ ] **Step 1: Write failing poll/session integration tests**

Test the returned and persisted shapes:

```js
expect(result).toMatchObject({
    ok: true,
    vendor: 'perplexity',
    status: 'complete',
    answerText: 'Stable answer',
    citations: [
        { index: 1, title: 'Source A', url: 'https://example.com/a' },
    ],
    answerArtifact: {
        provider: 'perplexity',
        citations: [
            { index: 1, title: 'Source A', url: 'https://example.com/a' },
        ],
    },
});

expect(getSession(result.sessionId)).toMatchObject({
    status: 'complete',
    answer: 'Stable answer',
    answerArtifact: {
        citations: [
            { index: 1, title: 'Source A', url: 'https://example.com/a' },
        ],
    },
});
```

Add a missing-citation case:

```js
expect(result.answerArtifact.citations).toEqual([]);
expect(result.warnings).toContain('citations-unavailable');
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/integration/web-ai-perplexity-session.test.mjs
```

Expected: FAIL because poll/query are not implemented.

- [ ] **Step 3: Implement stable response polling**

The poll loop must require:

```js
const isStable = latest.trim()
    && latest === stableText
    && Date.now() - stableSince >= 1500
    && !streaming;
```

Progress may be either:

```js
const urlProgress = page.url() !== baseline.url && /\/search\//.test(page.url());
const turnProgress = responseCount > baseline.responseCount;
```

Do not require URL progress for follow-up turns.

- [ ] **Step 4: Build one artifact and use it for result and finalizer**

```js
const citations = await extractPerplexityCitations(page, responseSelector);
if (citations.length === 0) warnings.push('citations-unavailable');

const answerArtifact = createAnswerArtifact({
    provider: 'perplexity',
    sessionId: session?.sessionId || null,
    conversationUrl: page.url(),
    capturedBy,
    markdown: answerText,
    text: answerText,
    responseStableMs: Date.now() - stableSince,
    citations,
    warnings,
});

if (session) {
    await finalizeProviderTab(deps, {
        vendor: 'perplexity',
        session,
        page,
        answerText,
        answerArtifact,
        warnings,
    });
}

return {
    ok: true,
    vendor: 'perplexity',
    status: 'complete',
    url: page.url(),
    ...(session ? { sessionId: session.sessionId } : {}),
    answerText,
    citations,
    answerArtifact,
    baseline,
    usedFallbacks,
    warnings,
    responseStableMs: Date.now() - stableSince,
};
```

- [ ] **Step 5: Implement query and stop**

```js
export async function perplexityQueryWebAi(deps, input = {}) {
    const sent = await perplexitySendWebAi(deps, input);
    return perplexityPollWebAi(deps, {
        ...input,
        session: sent.sessionId,
        baseline: sent.baseline,
    });
}
```

Stop behavior:

```js
const stop = page.locator('button[aria-label*="Stop" i], button[aria-label*="중지" i]').first();
if (await stop.isVisible().catch(() => false)) await stop.click();
else await page.keyboard.press('Escape');
```

- [ ] **Step 6: Verify GREEN and commit**

```bash
npx vitest run test/integration/web-ai-perplexity-session.test.mjs test/unit/web-ai-answer-artifact.test.mjs test/unit/web-ai-tab-finalizer.test.mjs
git add web-ai/perplexity-live.mjs test/integration/web-ai-perplexity-session.test.mjs test/fixtures/provider-dom/perplexity-streaming.html test/fixtures/provider-dom/perplexity-complete-citations.html
git commit -m "feat: capture Perplexity answers and citations"
```

---

### Task 7: Wire CLI, Bound Sessions, Resume, And Reattach

**Files:**
- Modify: `web-ai/types.mjs`
- Modify: `types/agbrowse-shared.d.ts`
- Modify: `web-ai/question.mjs`
- Modify: `web-ai/cli.mjs`
- Modify: `web-ai/cli-sessions.mjs`
- Modify: `web-ai/navigation-ready.mjs`
- Modify: `web-ai/tab-recovery.mjs`
- Modify: `test/integration/web-ai-cli-contract.test.mjs`
- Modify: `test/unit/web-ai-question.test.mjs`
- Modify: `test/unit/web-ai-provider-session.test.mjs`

**Interfaces:**
- Adds provider ID to all CLI and session dispatch paths.
- Produces: `isSafeProviderConversationUrl(vendor, url): boolean`
- Produces: `openProviderConversationInNewTab(deps, { vendor, conversationUrl })`

- [ ] **Step 1: Write failing CLI validation tests**

```js
it('renders Perplexity without a browser', async () => {
    const result = await execBrowser([
        'web-ai', 'render',
        '--vendor', 'perplexity',
        '--prompt', 'hello',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[USER]');
});

it('accepts Perplexity model and binary effort aliases', async () => {
    const result = await execBrowser([
        'web-ai', 'send',
        '--vendor', 'perplexity',
        '--model', 'gpt-5.6-terra',
        '--effort', 'on',
        '--inline-only',
        '--prompt', 'hello',
        '--json',
    ], { env: { AGBROWSE_WEB_AI_AUTO_START: '0' } });
    expect(result.stderr).not.toContain('unsupported Perplexity');
});

it('rejects Perplexity effort without model before browser startup', async () => {
    const result = await execBrowser([
        'web-ai', 'send',
        '--vendor', 'perplexity',
        '--effort', 'on',
        '--inline-only',
        '--prompt', 'hello',
        '--json',
    ], { env: { AGBROWSE_WEB_AI_AUTO_START: '0' } });
    const parsed = JSON.parse(result.stderr);
    expect(parsed.error.errorCode).toBe('provider.model-mismatch');
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/integration/web-ai-cli-contract.test.mjs test/unit/web-ai-question.test.mjs test/unit/web-ai-provider-session.test.mjs
```

Expected: Perplexity cases FAIL.

- [ ] **Step 3: Add provider constants and validation**

Add:

```js
PERPLEXITY: 'perplexity',
```

to `WEB_AI_VENDOR`, and add `'perplexity'` to all corresponding typedefs and
`question.mjs` supported vendors.

In CLI:

```js
const VENDOR_DEFAULT_URLS = {
    chatgpt: 'https://chatgpt.com',
    gemini: 'https://gemini.google.com',
    grok: 'https://grok.com',
    perplexity: 'https://www.perplexity.ai',
};
```

Add a Perplexity model set and effort branch:

```js
perplexity: new Set([
    'best', 'auto',
    'gpt-5.6-terra', 'terra',
    'gpt-5.6-sol', 'sol',
    'gemini-3.1-pro',
    'claude-sonnet-5',
    'claude-opus-4.8',
    'glm-5.2',
    'kimi-k2.6',
    'nemotron-3-ultra',
]),
```

```js
if (vendor === 'perplexity') {
    return normalizePerplexityEffort(effort) !== null;
}
```

- [ ] **Step 4: Wire every CLI dispatch path**

Import all five Perplexity functions. Add Perplexity branches to:

- `runBoundSendOrQuery`
- `runCommand`
- session vendor resolution
- usage/help labels
- vendor label formatting

Use:

```js
if (input.vendor === 'perplexity') {
    switch (command) {
        case 'render': return renderWebAi(input);
        case 'status': return perplexityStatusWebAi(deps, input);
        case 'send': return withWebAiActiveCommand(command, deps, input, () => perplexitySendWebAi(deps, input));
        case 'poll': return runBoundCommand(command, deps, input, perplexityPollWebAi, perplexityStopWebAi);
        case 'query': return withWebAiActiveCommand(command, deps, input, () => perplexityQueryWebAi(deps, input));
        case 'stop': return runBoundCommand(command, deps, input, perplexityPollWebAi, perplexityStopWebAi);
        default: throw new Error(`unknown web-ai command: ${command}`);
    }
}
```

- [ ] **Step 5: Wire resume and provider-safe reattach**

In `cli-sessions.mjs`, add `perplexityPollWebAi` to the poll selection.

Replace the ChatGPT-only new-tab helper with:

```js
export function isSafeProviderConversationUrl(vendor, value) {
    try {
        const url = new URL(String(value || ''));
        if (vendor === 'chatgpt') {
            return ['chatgpt.com', 'chat.openai.com'].includes(url.hostname)
                && /^\/c\/[a-f0-9-]+/i.test(url.pathname);
        }
        if (vendor === 'perplexity') {
            return ['perplexity.ai', 'www.perplexity.ai'].includes(url.hostname)
                && /^\/search\/[^/]+/i.test(url.pathname);
        }
        return false;
    } catch {
        return false;
    }
}
```

Use the vendor-aware function before opening a new tab and rebind the returned
target ID to the session.

- [ ] **Step 6: Verify GREEN and commit**

```bash
npx vitest run test/integration/web-ai-cli-contract.test.mjs test/unit/web-ai-question.test.mjs test/unit/web-ai-provider-session.test.mjs test/integration/web-ai-perplexity-session.test.mjs
git add web-ai/types.mjs types/agbrowse-shared.d.ts web-ai/question.mjs web-ai/cli.mjs web-ai/cli-sessions.mjs web-ai/navigation-ready.mjs web-ai/tab-recovery.mjs test/integration/web-ai-cli-contract.test.mjs test/unit/web-ai-question.test.mjs test/unit/web-ai-provider-session.test.mjs
git commit -m "feat: route Perplexity CLI sessions"
```

---

### Task 8: Wire MCP, Copy, Policy, Doctor, Semantic Contracts, And Eval

**Files:**
- Modify: `web-ai/mcp-server.mjs`
- Modify: `web-ai/tool-schema.mjs`
- Modify: `web-ai/copy-markdown.mjs`
- Modify: `web-ai/policy/default-policy.mjs`
- Modify: `web-ai/doctor.mjs`
- Modify: `web-ai/vendor-editor-contract.mjs`
- Modify: `web-ai/capability-types.mjs`
- Modify: `web-ai/eval/types.mjs`
- Modify: `test/integration/web-ai-mcp-server.test.mjs`
- Modify: `test/unit/web-ai-tool-schema.test.mjs`
- Modify: `test/unit/web-ai-tool-validation.test.mjs`
- Modify: `test/unit/web-ai-copy-markdown.test.mjs`
- Modify: `test/unit/web-ai-eval-fixtures.test.mjs`
- Modify: `test/fixtures/provider-dom/parallel-eval.json`

**Interfaces:**
- MCP provider enum accepts `perplexity`.
- MCP send/wait/copy dispatches to Perplexity.
- Doctor and eval understand Perplexity hosts and fixtures.

- [ ] **Step 1: Write failing MCP/schema/copy tests**

```js
expect(toolSchemaForMcp('web_ai_submit_prompt').inputSchema
    .properties.provider.enum).toContain('perplexity');
expect(toolSchemaForMcp('web_ai_submit_prompt').inputSchema
    .properties.effort.enum).toContain('on');
expect(toolSchemaForMcp('web_ai_submit_prompt').inputSchema
    .properties.effort.enum).toContain('off');
expect(PERPLEXITY_COPY_SELECTORS.turnSelectors.length).toBeGreaterThan(0);
```

Add an MCP submit test whose fake deps record that
`perplexitySendWebAi` was selected, and an MCP wait test that dispatches
`perplexityPollWebAi` from the stored session vendor.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/integration/web-ai-mcp-server.test.mjs test/unit/web-ai-tool-schema.test.mjs test/unit/web-ai-tool-validation.test.mjs test/unit/web-ai-copy-markdown.test.mjs test/unit/web-ai-eval-fixtures.test.mjs
```

Expected: Perplexity assertions FAIL.

- [ ] **Step 3: Update MCP and tool schemas**

Add Perplexity to `PROVIDERS`, `VENDOR_DEFAULT_URLS`, `sendByProvider`,
`pollByProvider`, and `copySelectorsForProvider`.

Set:

```js
const providerEnum = ['chatgpt', 'gemini', 'grok', 'perplexity'];
```

Add `on` and `off` to the effort and reasoning-effort enums. Keep runtime
provider-specific validation in CLI/live code so these aliases do not change
ChatGPT behavior.

- [ ] **Step 4: Add copy, policy, doctor, and semantic contracts**

Add:

```js
export const PERPLEXITY_COPY_SELECTORS = {
    turnSelectors: [
        '[data-testid="answer"]',
        '[data-testid*="assistant" i]',
        'main .prose',
    ],
    copyButtonSelectors: [
        'button[aria-label="Copy"]',
        'button[aria-label*="Copy" i]',
        'button[aria-label*="복사" i]',
    ],
};
```

Add `perplexity` to provider file-access defaults, doctor host maps,
navigation provider hosts, editor contract maps, capability vendor typedefs,
and eval vendors.

Perplexity editor contract:

```js
export const PERPLEXITY_EDITOR_CONTRACT = Object.freeze({
    vendor: 'perplexity',
    targets: {
        composer: {
            roles: ['textbox'],
            names: [/ask/i, /질문/i, /search/i],
            cssFallbacks: [
                'div[role="textbox"][contenteditable="true"]',
                '.ProseMirror[contenteditable="true"]',
            ],
            required: true,
        },
        send: {
            roles: ['button'],
            names: [/submit/i, /send/i, /검색/i],
            cssFallbacks: ['button[aria-label="Submit"]'],
            required: true,
        },
        responseFeed: {
            roles: ['article', 'region', 'main'],
            names: [/answer/i, /response/i],
            cssFallbacks: ['[data-testid="answer"]', 'main .prose'],
        },
    },
});
```

- [ ] **Step 5: Add eval fixtures to the registry**

Set:

```js
export const EVAL_VENDORS = ['chatgpt', 'gemini', 'grok', 'perplexity'];
```

Add Perplexity baseline/cosmetic/structural fixture entries to
`parallel-eval.json` with required intents:

```json
{
  "vendor": "perplexity",
  "variant": "baseline",
  "htmlPath": "perplexity-baseline.html",
  "requiredIntents": ["composer.fill", "upload.open", "send.click", "copy.click"]
}
```

- [ ] **Step 6: Verify GREEN and commit**

```bash
npx vitest run test/integration/web-ai-mcp-server.test.mjs test/unit/web-ai-tool-schema.test.mjs test/unit/web-ai-tool-validation.test.mjs test/unit/web-ai-copy-markdown.test.mjs test/unit/web-ai-eval-fixtures.test.mjs
node scripts/run-web-ai-eval.mjs --vendor perplexity --fixtures test/fixtures/provider-dom --json
git add web-ai/mcp-server.mjs web-ai/tool-schema.mjs web-ai/copy-markdown.mjs web-ai/policy/default-policy.mjs web-ai/doctor.mjs web-ai/navigation-ready.mjs web-ai/vendor-editor-contract.mjs web-ai/capability-types.mjs web-ai/eval/types.mjs test/integration/web-ai-mcp-server.test.mjs test/unit/web-ai-tool-schema.test.mjs test/unit/web-ai-tool-validation.test.mjs test/unit/web-ai-copy-markdown.test.mjs test/unit/web-ai-eval-fixtures.test.mjs test/fixtures/provider-dom/parallel-eval.json
git commit -m "feat: expose Perplexity through MCP and diagnostics"
```

---

### Task 9: Synchronize Documentation And Public Command Surfaces

**Files:**
- Modify: `README.md`
- Modify: `skills/web-ai/SKILL.md`
- Modify: `skills/browser/SKILL.md`
- Modify: `skills/browser/browser.mjs`
- Modify: `skills/browser/extract.mjs`
- Modify: `skills/search/references/cli-reference.md`
- Modify: `web-ai/cli.mjs`
- Modify: `web-ai/tool-schema.mjs`
- Modify: `web-ai/errors.mjs`
- Modify: `structure/INDEX.md`
- Modify: `structure/CAPABILITY_TRUTH_TABLE.md`
- Modify: `structure/commands.md`
- Modify: `structure/runtime_contracts.md`
- Modify: `structure/release_gates.md`
- Modify: `structure/phase_status.md`
- Modify: `docs/index.html`
- Modify: `docs/dev/index.html`
- Modify: `docs/dev/concepts/architecture.html`
- Modify: `docs/dev/concepts/web-ai-sessions.html`
- Modify: `docs/dev/guides/web-ai.html`
- Modify: `docs/dev/reference/cli.html`
- Modify: `docs/dev/ko/index.html`
- Modify: `docs/dev/ko/concepts/architecture.html`
- Modify: `docs/dev/ko/concepts/web-ai-sessions.html`
- Modify: `docs/dev/ko/guides/web-ai.html`
- Modify: `docs/dev/ko/reference/cli.html`

**Interfaces:**
- Public help consistently advertises the fourth provider and its aliases.
- Error documentation includes entitlement and mode-unavailable failures.

- [ ] **Step 1: Write failing help-contract assertions**

Add to CLI contract tests:

```js
expect(result.stdout).toContain('chatgpt | gemini | grok | perplexity');
expect(result.stdout).toContain('Perplexity: best, gpt-5.6-terra');
expect(result.stdout).toContain('Perplexity thinking: off/on');
```

Add source checks that no public provider enum still says only
`chatgpt|gemini|grok`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run test/integration/web-ai-cli-contract.test.mjs
```

Expected: new help assertions FAIL.

- [ ] **Step 3: Update all public documentation**

Document:

```bash
agbrowse web-ai query \
  --vendor perplexity \
  --url https://www.perplexity.ai \
  --model gpt-5.6-terra \
  --effort on \
  --inline-only \
  --prompt "Compare the current approaches and preserve citations."
```

Document locked-model and missing-thinking errors without suggesting automatic
fallback.

- [ ] **Step 4: Run documentation and structure-count gates**

```bash
npm run docs:drift
npm run fix:counts
npm run docs:drift
git diff --check
```

Expected: `fix:counts` updates only count fields derived from the source tree;
the final docs drift check and `git diff --check` PASS. Inspect
`git diff --name-only` and reject unrelated generated-file changes before
committing.

- [ ] **Step 5: Commit**

```bash
git add README.md skills web-ai/cli.mjs web-ai/tool-schema.mjs web-ai/errors.mjs structure docs
git commit -m "docs: document Perplexity web-ai support"
```

---

### Task 10: Full Regression, Package Gates, And Manual Smoke

**Files:**
- Modify only files required by failures attributable to this feature.
- Record smoke evidence in: `devlog/_smoke/260711_perplexity_web_ai/README.md`

**Interfaces:**
- Produces a release-ready verification record.

- [ ] **Step 1: Run focused provider tests**

```bash
npx vitest run \
  test/unit/web-ai-perplexity-model.test.mjs \
  test/unit/web-ai-perplexity-citations.test.mjs \
  test/unit/web-ai-perplexity-live-policy.test.mjs \
  test/integration/web-ai-perplexity-session.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run all web-ai unit and integration tests**

```bash
npm run test:unit
npm run test:integration
```

Expected: PASS with existing ChatGPT, Gemini, and Grok behavior unchanged.

- [ ] **Step 3: Run type, module, package, and release gates**

```bash
npm run typecheck:checkjs
npm run typecheck:checkjs-dom
npm run typecheck
npm run check:module-graph
npm run smoke:bins
npm run test:release-gates
npm run pack:dry
```

Expected: every command exits 0.

- [ ] **Step 4: Run authenticated headed live smoke**

```bash
agbrowse web-ai status \
  --vendor perplexity \
  --url https://www.perplexity.ai \
  --json
```

Expected: `ok: true`, Perplexity host verified, composer visible.

```bash
agbrowse web-ai query \
  --vendor perplexity \
  --url https://www.perplexity.ai \
  --model gpt-5.6-terra \
  --effort on \
  --inline-only \
  --prompt "Reply with a short sourced explanation of CDP." \
  --timeout 180 \
  --json | tee /tmp/perplexity-query.json

SID="$(jq -r '.sessionId' /tmp/perplexity-query.json)"
test -n "$SID"
test "$SID" != "null"
```

Expected:

- `status: "complete"`
- non-empty `sessionId`
- non-empty `answerText`
- `answerArtifact.provider: "perplexity"`
- `answerArtifact.citations` is an array
- session conversation URL is a concrete Perplexity search URL

Verify persistence:

```bash
agbrowse web-ai sessions show "$SID" --json | tee /tmp/perplexity-session.json
jq -e '.session.answerArtifact.citations | type == "array"' \
  /tmp/perplexity-session.json
jq -e --slurpfile query /tmp/perplexity-query.json \
  '.session.answer == $query[0].answerText
   and .session.answerArtifact.citations == $query[0].answerArtifact.citations' \
  /tmp/perplexity-session.json
```

Expected: stored `answer` equals the completed answer and stored
`answerArtifact.citations` equals the query result citations.

- [ ] **Step 5: Record smoke evidence**

The smoke README must contain:

```markdown
# Perplexity Web-AI Smoke

- Date: 2026-07-11
- Provider: perplexity
- Model: gpt-5.6-terra
- Thinking: on
- Status: complete
- Citation array persisted: yes
- Session resume verified: yes
- Locked Max model fail-closed verified: yes
```

- [ ] **Step 6: Commit verification evidence**

```bash
git add devlog/_smoke/260711_perplexity_web_ai/README.md
git commit -m "test: record Perplexity web-ai smoke"
```

---

## Final Acceptance Checklist

- [ ] Perplexity is accepted by CLI, MCP, sessions, doctor, policy, recovery, and eval.
- [ ] No existing provider behavior changes when Perplexity is unused.
- [ ] Model and thinking controls mutate only when explicitly requested.
- [ ] Locked models fail before click.
- [ ] Missing thinking controls fail before submit.
- [ ] `Sonar 2` is never clicked as a heading.
- [ ] Initial URL navigation and same-URL follow-ups both poll successfully.
- [ ] Citations survive query, poll, MCP, session store, and `sessions show`.
- [ ] Missing citations produce `[]` plus `citations-unavailable`.
- [ ] All deterministic tests and release gates pass.
- [ ] Live smoke evidence is recorded separately from CI.
