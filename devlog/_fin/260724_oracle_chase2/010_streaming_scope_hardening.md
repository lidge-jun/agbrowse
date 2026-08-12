# 010 — Streaming Scope Hardening

Status: D (diff-level implementation roadmap)

## Audit amendments (round 1, Sol reviewer Newton — GO-WITH-FIXES, 5 blockers, all folded)

1. **Latest-assistant-turn must be role-verified** (High): do not treat the last top-level match of the combined selector list as assistant. Selection rule: prefer the last node matching `[data-message-author-role="assistant"]`/`[data-turn="assistant"]`; use its nearest top-level conversation wrapper as the progress scope. A bare `article[data-testid^="conversation-turn"]` without an assistant-role descendant is NOT an assistant turn.
2. **Behavioral DOM tests, not string assertions** (High): the streaming-state tests must run `readChatGptStreamingState` against real jsdom/happy-dom fixtures — exact stop button hit, form-scoped fallback hit, out-of-form fallback miss, and each `:not()` exclusion (dictation/voice/read) as separate fixtures.
3. **No new broad completed-sidecar `includes('thought for')`** (High): the predicate must use the anchored duration grammar `/^thought for \d+[a-z]*( seconds?| minutes?)?( edit)?$/i` on normalized visible text (G7/G12 stay deferred; this plan must not introduce a NEW broad suppression). A growing live trace containing "Thought for 2s: Searching…" must remain live.
4. **Out-of-scope callers declared** (Medium): `chatgpt-deep-research.mjs:49-52`, `chatgpt-work-picker.mjs:690,950`, `chatgpt-multi-turn.mjs:54-56` keep their own stop predicates — WP2 scope is the general ChatGPT response path (`chatgpt.mjs` poller + observer + shared constants). Their migration is recorded as a deferred follow-up row in 040 (G1b).
5. **Activation table ↔ test mapping** (Medium): every activation row must name its executable test case; ARIA omitted-max and completed-sidecar counter-case get explicit fixtures.
Format: DIFFLEVEL-ROADMAP-01
Work-phase: WP2
Upstream predicates verified with `git show 99b30cfa 0071c547 9f6703bf 93ccb79d` in `/tmp/oracle-chase-260724`.

## Objective

Make ChatGPT streaming detection response-scoped and fail-safe against unrelated controls. Keep the exact `button[data-testid="stop-button"]` signal, but constrain the broad aria-label fallback to the composer form and reject dictation, voice, and read-aloud controls. Evaluate progress only in the latest assistant turn or in a metadata-verified thinking sidecar; determinate completed progress is idle. Geometry may narrow a sidecar candidate, but cannot establish that it is reasoning chrome.

The implementation should move the browser-context predicate into `chatgpt-response-dom.mjs` so the authoritative poller and focused unit tests exercise one implementation. The observer continues to be an early-wake mechanism only, but inherits the same scoped stop selector constants.

## Gaps covered

| Gap | Required closure |
| --- | --- |
| G1 | Composer-scope the aria-label Stop fallback and exclude dictation/voice/read controls everywhere the shared selectors are consumed. |
| G2 | Search progress indicators only in the latest assistant turn, with a separate verified-sidecar path. |
| G3 | Treat indeterminate progress or determinate `value < max` as live; treat `value >= max` as idle. |
| G4 | Require thinking/reasoning/sidecar metadata before a right-side panel can veto completion. |

## File change map

| Path | Action | Current path:line anchor | Functions / constants |
| --- | --- | --- | --- |
| `web-ai/chatgpt-response-dom.mjs` | MODIFY | `web-ai/chatgpt-response-dom.mjs:3-12`, `web-ai/chatgpt-response-dom.mjs:14-40` | `CHATGPT_STOP_SELECTORS`; add `readChatGptStreamingState()` and its browser-context helpers |
| `web-ai/chatgpt.mjs` | MODIFY | `web-ai/chatgpt.mjs:55-60`, `web-ai/chatgpt.mjs:909-965` | response-DOM imports; `isStreaming()` |
| `web-ai/chatgpt-response-observer.mjs` | MODIFY | `web-ai/chatgpt-response-observer.mjs:13-17`, `web-ai/chatgpt-response-observer.mjs:30-66`, `web-ai/chatgpt-response-observer.mjs:151-167` | shared `CHATGPT_STOP_SELECTORS` usages in `buildResponseObserverExpression()` and `readStreamingState()` |
| `test/unit/web-ai-chatgpt-response-fragments.test.mjs` | MODIFY | `test/unit/web-ai-chatgpt-response-fragments.test.mjs:1-6`, `test/unit/web-ai-chatgpt-response-fragments.test.mjs:8-59`, `test/unit/web-ai-chatgpt-response-fragments.test.mjs:61-90` | imports; new `ChatGPT streaming state` cases and DOM fakes |
| `test/unit/web-ai-chatgpt-response-observer.test.mjs` | MODIFY | `test/unit/web-ai-chatgpt-response-observer.test.mjs:1-7`, `test/unit/web-ai-chatgpt-response-observer.test.mjs:9-30` | observer expression selector-contract assertions |

## Proposed diffs

### 1. Shared stop selectors and response-scoped streaming predicate

In `web-ai/chatgpt-response-dom.mjs`, replace the current broad stop selector and add a serializable browser-context predicate. The exact test-id remains document-wide; only the fallback is composer-scoped.

Before:

```js
export const CHATGPT_STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]',
];
```

After:

```js
export const CHATGPT_STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'form button[aria-label*="Stop" i]:not([aria-label*="dictat" i]):not([aria-label*="voice" i]):not([aria-label*="read" i])',
];

/**
 * Browser-context helper. Returns whether the current ChatGPT response has
 * positive live-generation evidence.
 * @param {{ assistantSelectors: string[], stopSelectors: string[] }} options
 * @returns {boolean}
 */
export function readChatGptStreamingState({ assistantSelectors, stopSelectors }) {
    const isVisible = (/** @type {Element} */ node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const norm = (/** @type {unknown} */ value) =>
        String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const hasLiveProgress = (/** @type {ParentNode} */ scope) => {
        let nodes;
        try {
            nodes = scope.querySelectorAll('progress, [role="progressbar"]');
        } catch {
            return false;
        }
        return Array.from(nodes).some(node => {
            if (!isVisible(node)) return false;
            if (node instanceof HTMLProgressElement) {
                if (!node.hasAttribute('value')) return true;
                return Number.isFinite(node.value) && Number.isFinite(node.max)
                    ? node.value < node.max
                    : true;
            }
            const rawNow = node.getAttribute('aria-valuenow');
            if (rawNow == null) return true;
            const now = Number(rawNow);
            const rawMax = node.getAttribute('aria-valuemax');
            const max = rawMax != null && Number.isFinite(Number(rawMax))
                ? Number(rawMax)
                : 100;
            return Number.isFinite(now) ? now < max : true;
        });
    };
    for (const selector of stopSelectors) {
        let nodes;
        try {
            nodes = document.querySelectorAll(selector);
        } catch {
            continue;
        }
        if (Array.from(nodes).some(isVisible)) return true;
    }
    const activeAssistantSelectors = Array.isArray(assistantSelectors) && assistantSelectors.length
        ? assistantSelectors
        : [
            '[data-message-author-role="assistant"]',
            '[data-turn="assistant"]',
            'article[data-testid^="conversation-turn"]',
        ];
    const assistantSelector = activeAssistantSelectors.join(', ');
    let turns;
    try {
        turns = Array.from(document.querySelectorAll(assistantSelector));
    } catch {
        turns = [];
    }
    const topLevelTurns = turns.filter(node =>
        !turns.some(other => other !== node && other.contains(node)));
    const latestTurn = topLevelTurns.at(-1);
    if (latestTurn && hasLiveProgress(latestTurn)) return true;

    let panels;
    try {
        panels = document.querySelectorAll(
            'aside, [role="complementary"], [role="dialog"], [data-testid*="thinking" i], [data-testid*="reasoning" i], [class*="sidecar" i]',
        );
    } catch {
        return false;
    }
    for (const panel of Array.from(panels)) {
        if (!isVisible(panel)) continue;
        const metadata = norm([
            panel.getAttribute('aria-label'),
            panel.getAttribute('data-testid'),
            panel.getAttribute('class'),
        ].filter(Boolean).join(' '));
        const verifiedThinkingPanel = metadata.includes('thinking')
            || metadata.includes('reasoning')
            || metadata.includes('sidecar');
        if (!verifiedThinkingPanel) continue;
        const rect = panel.getBoundingClientRect();
        const rightSide = rect.left >= window.innerWidth * 0.35
            && rect.width >= 180
            && rect.height >= 120;
        if (!rightSide) continue;
        if (hasLiveProgress(panel)) return true;
        const visibleText = norm(panel.textContent);
        if (visibleText.includes('thought for')) continue;
        if (visibleText.includes('thinking')
            || visibleText.includes('reasoning')
            || visibleText.includes('pro thinking')) return true;
    }
    return false;
}
```

`hasAttribute('value')` is intentional for HTML `<progress>`: absent `value` means indeterminate, while the DOM `value` property alone would otherwise read as zero and lose that distinction. ARIA progress defaults `aria-valuemax` to 100, matching the upstream predicate.

### 2. Authoritative poller delegates to the shared predicate

In `web-ai/chatgpt.mjs`, extend the current response-DOM import:

Before:

```js
    CHATGPT_STOP_SELECTORS,
    readTopLevelAssistantTexts,
    readTopLevelAssistantTextsFromLocators,
```

After:

```js
    CHATGPT_STOP_SELECTORS,
    readChatGptStreamingState,
    readTopLevelAssistantTexts,
    readTopLevelAssistantTextsFromLocators,
```

Replace `isStreaming()` at current lines 909-965:

Before:

```js
async function isStreaming(page) {
    // document-wide stop/progress loops and geometry-led sidecar evaluation
}
```

After:

```js
async function isStreaming(page) {
    try {
        return Boolean(await page.evaluate(
            readChatGptStreamingState,
            {
                assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
                stopSelectors: CHATGPT_STOP_SELECTORS,
            },
        ));
    } catch {
        return false;
    }
}
```

This retains the current navigation-safe fail-open behavior of `isStreaming()` while deleting the duplicate page-global progress and sidecar implementation.

### 3. Observer usages consume the corrected selector contract

No alternate stop selector may be introduced in `chatgpt-response-observer.mjs`. Its current imports and both usages remain structurally the same:

```js
import {
    CHATGPT_ASSISTANT_SELECTORS,
    CHATGPT_STOP_SELECTORS,
    readTopLevelAssistantTexts,
} from './chatgpt-response-dom.mjs';
```

```js
const stopSelector = CHATGPT_STOP_SELECTORS.join(', ');
```

```js
for (const selector of CHATGPT_STOP_SELECTORS) {
    const first = page.locator?.(selector)?.first?.();
    if (typeof first?.isVisible === 'function'
        && await first.isVisible().catch(() => false)) return true;
}
```

The implementation edit here is a contract comment immediately above each usage, naming that the broad fallback is composer-scoped and exclusions must not be weakened. This makes the inherited G1 behavior explicit and prevents a later observer-only regression.

### 4. Focused tests

Extend `web-ai-chatgpt-response-fragments.test.mjs` imports with `CHATGPT_STOP_SELECTORS` and `readChatGptStreamingState`. Add these cases using DOM fakes that implement `querySelectorAll`, `getAttribute`, `hasAttribute`, `contains`, and `getBoundingClientRect`:

```js
describe('ChatGPT streaming state', () => {
    it('keeps the exact stop test id but ignores non-composer aria Stop controls', () => {
        expect(CHATGPT_STOP_SELECTORS[0]).toBe('button[data-testid="stop-button"]');
        expect(CHATGPT_STOP_SELECTORS[1]).toMatch(/^form button/);
        expect(CHATGPT_STOP_SELECTORS[1]).toContain('dictat');
        expect(CHATGPT_STOP_SELECTORS[1]).toContain('voice');
        expect(CHATGPT_STOP_SELECTORS[1]).toContain('read');
    });

    it('ignores page-global progress outside the latest assistant turn', () => {
        const state = withStreamingDocument({ globalProgress: progressNode({ value: 10, max: 100 }) }, () =>
            readChatGptStreamingState({
                assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
                stopSelectors: CHATGPT_STOP_SELECTORS,
            }));
        expect(state).toBe(false);
    });

    it('treats indeterminate and incomplete latest-turn progress as live', () => {
        expect(readStreamingFixture({ latestProgress: progressNode({ indeterminate: true }) })).toBe(true);
        expect(readStreamingFixture({ latestProgress: progressNode({ value: 40, max: 100 }) })).toBe(true);
    });

    it('treats completed determinate latest-turn progress as idle', () => {
        expect(readStreamingFixture({ latestProgress: progressNode({ value: 100, max: 100 }) })).toBe(false);
        expect(readStreamingFixture({ latestProgress: ariaProgressNode({ now: 5, max: 5 }) })).toBe(false);
    });

    it('requires sidecar metadata before right-side geometry can veto completion', () => {
        expect(readStreamingFixture({ panel: rightPanel({ text: 'Reasoning', metadata: '' }) })).toBe(false);
        expect(readStreamingFixture({ panel: rightPanel({ text: 'Reasoning', metadata: 'reasoning-sidecar' }) })).toBe(true);
    });
});
```

Extend the observer expression tests:

```js
it('embeds the composer-scoped Stop fallback exclusions', () => {
    const expr = buildResponseObserverExpression();
    expect(expr).toContain('form button');
    expect(expr).toContain('dictat');
    expect(expr).toContain('voice');
    expect(expr).toContain('read');
});
```

## Test plan

The repository uses Vitest for these unit files (`package.json` scripts and existing `import { describe, expect, it } from 'vitest'`), not direct `node --test` for this surface.

Run focused tests first:

```sh
npx vitest run test/unit/web-ai-chatgpt-response-fragments.test.mjs test/unit/web-ai-chatgpt-response-observer.test.mjs
```

Then run the existing broader unit entry point:

```sh
npm run test:unit
```

New focused test names:

- `keeps the exact stop test id but ignores non-composer aria Stop controls`
- `ignores page-global progress outside the latest assistant turn`
- `treats indeterminate and incomplete latest-turn progress as live`
- `treats completed determinate latest-turn progress as idle`
- `requires sidecar metadata before right-side geometry can veto completion`
- `embeds the composer-scoped Stop fallback exclusions`

## Accept criteria

- G1: exact `button[data-testid="stop-button"]` remains accepted anywhere; the aria fallback begins with `form button` and contains all three exclusions (`dictat`, `voice`, `read`). Poller, observer expression, and observer recovery import the same constants.
- G2: a visible page-shell progress bar outside the latest assistant turn does not make `isStreaming()` true; the same bar inside the latest assistant turn does.
- G3: HTML and ARIA determinate bars at or beyond max are idle; incomplete and indeterminate bars are live.
- G4: right-side dimensions alone never veto completion. Sidecar progress/text can veto only when aria-label, data-testid, or class metadata contains thinking/reasoning/sidecar.
- No new page-global `progress` or `[role="progressbar"]` lookup exists in `chatgpt.mjs`.
- Both focused test files and `npm run test:unit` pass.

### C-ACTIVATION-GROUNDING-01

| Conditional | Activation scenario | Observable proof that the branch fired |
| --- | --- | --- |
| Exact stop test-id | Mount a visible `button[data-testid="stop-button"]` outside a form. | `readChatGptStreamingState()` returns `true`. |
| Scoped aria Stop fallback | Mount a visible `form button[aria-label="Stop generating"]`; repeat outside a form. | Inside form returns `true`; outside form returns `false`. |
| Dictation/voice/read exclusion | Mount composer buttons labelled `Stop dictation`, `Stop voice`, and `Stop reading`. | Each fixture returns `false`; replacing label with `Stop generating` returns `true`. |
| Latest-turn progress scope | Mount one shell progress bar and two assistant turns, with progress only in the newest turn on the second run. | First run returns `false`; second returns `true`. |
| HTML determinate predicate | Mount visible `<progress value="100" max="100">`, then change value to 99. | First returns `false`; second returns `true`. |
| HTML indeterminate predicate | Mount visible `<progress>` with no `value` attribute. | Returns `true`. |
| ARIA determinate predicate | Mount `[role="progressbar"][aria-valuenow="100"]` with omitted max, then now 99. | Default-max completed case returns `false`; 99 returns `true`. |
| Verified sidecar metadata | Mount identical right-side panels with text `Reasoning`; only the second has `data-testid="reasoning-sidecar"`. | Unverified panel returns `false`; verified panel returns `true`. |
| Completed sidecar summary exclusion | Mount a verified sidecar whose text contains `Thought for 12s` and has no live progress. | Returns `false`, proving retained-summary text did not veto. |

## Risks / rollback

- DOM selector drift could hide a real composer Stop button. The exact test-id remains the primary signal; rollback is limited to reverting the shared fallback selector while retaining tests for non-generation controls.
- Some ChatGPT variants may not wrap the latest assistant response in current selectors. That would omit response-scoped progress, but stop detection remains active and WP3 requires positive completion proof, so failure is a timeout/defer rather than premature finalization. Add a selector only with a captured DOM fixture.
- Metadata verification may miss an unlabeled genuine sidecar. This is intentionally fail-neutral for streaming activity; WP3's scoped completion gate still fails closed. Roll back G4 independently by broadening only the metadata vocabulary, never by restoring geometry-only proof.
- `page.evaluate()` failure returns `false`, matching current navigation handling. Do not make it throw through the poll loop.
