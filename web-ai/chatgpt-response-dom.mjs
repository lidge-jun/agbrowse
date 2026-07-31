// @ts-check

export const CHATGPT_ASSISTANT_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    'article[data-testid^="conversation-turn"]',
];

export const CHATGPT_STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'form button[aria-label*="Stop" i]:not([aria-label*="dictat" i]):not([aria-label*="voice" i]):not([aria-label*="read" i])',
];

export const CHATGPT_TURN_SELECTORS = [
    'article[data-testid^="conversation-turn"]',
    'div[data-testid^="conversation-turn"]',
    'section[data-testid^="conversation-turn"]',
];

/**
 * Browser-context helper. Reports whether the latest assistant turn follows the
 * latest user turn.
 *
 * Returns a VERDICT, not a boolean. "Cannot verify" and "verified ordered" are
 * different facts, and collapsing them is what let a stalled DOM read pass the
 * ordering gate as if it had been checked.
 *
 * This helper never reports `'unknown'` — a browser callback cannot describe its
 * own failure to run. Only the Node-side wrapper's catch produces that value.
 *
 * @typedef {'ordered'|'stale'|'unverifiable'} ChatGptTurnOrderingInPage
 * @param {string[]} selectors
 * @returns {ChatGptTurnOrderingInPage}
 */
export function readAssistantTurnOrderingInPage(selectors) {
    const turns = Array.from(document.querySelectorAll(selectors.join(', ')));
    const roleOf = (/** @type {Element} */ turn) => turn.getAttribute('data-message-author-role')
        || turn.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
    const lastAssistantTurn = turns.findLast((turn) => roleOf(turn) === 'assistant');
    const lastUserTurn = turns.findLast((turn) => roleOf(turn) === 'user');
    // No user turn: ordering cannot be checked, but this is a legitimate state
    // (system-initiated conversations), not a failed observation.
    if (!lastUserTurn) return 'unverifiable';
    // No assistant turn yet — the outer poll handles that through `latest`.
    if (!lastAssistantTurn) return 'stale';
    return lastUserTurn.compareDocumentPosition(lastAssistantTurn) & Node.DOCUMENT_POSITION_FOLLOWING
        ? 'ordered'
        : 'stale';
}

/**
 * Node-side probe: is a composer-scoped stop button visible within `scope`?
 *
 * Visibility is REQUIRED — a present-but-hidden stop node is not generation
 * evidence. This is the same semantic the main ChatGPT poll path uses, and it
 * is the shared predicate every ChatGPT surface must consult so page-wide
 * "any Stop-labelled button" matches (dictation, voice, read-aloud, sidebar)
 * can never be mistaken for streaming.
 *
 * EVERY match is inspected, not just the first: ChatGPT can render a hidden
 * stop node ahead of the live one, and a `.first()`-only probe would report
 * idle mid-generation (premature completion in the multi-turn poll loop).
 *
 * @param {any} scope Playwright-like locator root (a page, or a `main` region locator).
 * @returns {Promise<boolean>}
 */
export async function anyStopButtonVisible(scope) {
    if (!scope || typeof scope.locator !== 'function') return false;
    for (const selector of CHATGPT_STOP_SELECTORS) {
        const locator = scope.locator(selector);
        if (!locator) continue;
        if (typeof locator.all === 'function') {
            const nodes = await locator.all().catch(() => []);
            for (const node of nodes) {
                if (typeof node?.isVisible === 'function'
                    && await node.isVisible().catch(() => false)) return true;
            }
            if (nodes.length) continue;
            // An empty `all()` with a visible `first()` only happens on partial
            // locator doubles; with a real Playwright locator `first()` is not
            // visible when there are no matches, so this costs nothing and keeps
            // those doubles working.
            const firstOfEmpty = locator.first?.();
            if (typeof firstOfEmpty?.isVisible === 'function'
                && await firstOfEmpty.isVisible().catch(() => false)) return true;
            continue;
        }
        // Fallback for locator shapes without `all()`: walk by index.
        const total = typeof locator.count === 'function'
            ? await locator.count().catch(() => 0)
            : 0;
        for (let i = 0; i < total; i += 1) {
            const node = locator.nth?.(i);
            if (typeof node?.isVisible === 'function'
                && await node.isVisible().catch(() => false)) return true;
        }
        if (total === 0) {
            const first = locator.first?.();
            if (typeof first?.isVisible === 'function'
                && await first.isVisible().catch(() => false)) return true;
        }
    }
    return false;
}

/**
 * Narrow a page to its main conversation region when it exposes one.
 *
 * Sidebar history titles poison page-wide text and control matching (live
 * 2026-07-10: a conversation named "SMOKE_C3_THINKING_OK" matched
 * getByText('Thinking') and pinned the Work classifier to running forever).
 *
 * With a real Playwright page this always returns the `main` locator (which
 * matches zero elements when the page has no `<main>`, so probes scoped to it
 * fail closed). The page fallback exists for locator-less test doubles.
 *
 * @param {any} page
 * @returns {any} the `main` locator when available, else the page itself
 */
export function scopeToMainRegion(page) {
    const main = page?.locator?.('main');
    return (main && typeof main.locator === 'function') ? main : page;
}

/**
 * Resolve role-verified, top-level assistant turns in document order.
 * Browser-context helper; callers that serialize another helper may pass this
 * function's source and reconstruct it inside page.evaluate.
 * @param {string[]} selectors
 * @returns {Element[]}
 */
export function resolveTopLevelAssistantTurns(selectors) {
    const activeSelectors = Array.isArray(selectors) && selectors.length
        ? selectors
        : [
            '[data-message-author-role="assistant"]',
            '[data-turn="assistant"]',
            'article[data-testid^="conversation-turn"]',
        ];
    const roleSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-turn="assistant"]',
    ];
    const roleNodes = [];
    for (const selector of roleSelectors) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
            if (!roleNodes.includes(node)) roleNodes.push(node);
        }
    }
    const turns = [];
    for (const roleNode of roleNodes) {
        const wrapperSelectors = activeSelectors.filter(selector => !roleSelectors.includes(selector));
        const candidate = wrapperSelectors.length && typeof roleNode.closest === 'function'
            ? roleNode.closest(wrapperSelectors.join(', ')) || roleNode
            : roleNode;
        if (turns.some(turn => turn === candidate || turn.contains(candidate))) continue;
        for (let i = turns.length - 1; i >= 0; i--) {
            if (candidate.contains(turns[i])) turns.splice(i, 1);
        }
        turns.push(candidate);
    }
    return turns;
}

/**
 * Browser-context helper. Returns whether the current ChatGPT response has
 * positive live-generation evidence.
 *
 * Returns a STRENGTH, not a boolean: a visible stop button and a mounted sidecar
 * that merely still reads "Thinking" are not the same evidence, and treating them
 * alike lets a stale sidecar hang the poll loop forever.
 *
 * @typedef {'strong'|'weak'|'none'|'unknown'} ChatGptActivityStrength
 * @typedef {{ strength: ChatGptActivityStrength, evidence: string }} ChatGptActivityState
 * @param {{ assistantSelectors: string[], stopSelectors: string[], resolverSource?: string }} options
 * @returns {ChatGptActivityState}
 */
export function readChatGptStreamingState({ assistantSelectors, stopSelectors, resolverSource }) {
    // Body-local: page.evaluate serializes this body, not the module.
    const UNIT = '(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)';
    const NUMERIC = `\\d+(?:\\.\\d+)?\\s*${UNIT}`;
    // Whole-label completed-reasoning summary, ported from upstream 86d1fb2b with
    // 57d4a7af's optional trailing "Edit". Anchoring is what keeps a growing trace
    // like "Thought for 2s: Searching…" from being mistaken for completion.
    const COMPLETED_SUMMARY = new RegExp(
        '^(?:(?:reasoning|pro thinking)\\s*)?thought for '
        + `(?:${NUMERIC}(?:\\s+${NUMERIC})*|(?:a|an) [a-z]+(?: [a-z]+){0,2})`
        + '(?: edit)?$',
    );
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
        if (Array.from(nodes).some(isVisible)) return { strength: 'strong', evidence: 'stop-button' };
    }

    let assistantNodes = [];
    try {
        const resolver = resolverSource
            ? (0, eval)(`(${resolverSource})`)
            : resolveTopLevelAssistantTurns;
        assistantNodes = resolver(assistantSelectors);
    } catch { /* selector drift fails closed */ }
    const latestAssistant = assistantNodes.at(-1);
    if (latestAssistant) {
        if (hasLiveProgress(latestAssistant)) return { strength: 'strong', evidence: 'turn-progress' };
    }

    let panels;
    try {
        panels = document.querySelectorAll(
            'aside, [role="complementary"], [role="dialog"], [data-testid*="thinking" i], [data-testid*="reasoning" i], [class*="sidecar" i]',
        );
    } catch {
        return { strength: 'none', evidence: '' };
    }
    /** @type {ChatGptActivityState|null} */
    let weakVerdict = null;
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
        // Strong evidence wins immediately; a weak hit is recorded and the scan
        // continues, so a later panel with live progress is not masked.
        if (hasLiveProgress(panel)) return { strength: 'strong', evidence: 'panel-progress' };
        const visibleText = norm(panel.textContent);
        if (COMPLETED_SUMMARY.test(visibleText)) continue;
        // A trace that still mentions "thought for" is GROWING, hence live.
        if (visibleText.includes('thought for ')) {
            weakVerdict = weakVerdict || { strength: 'weak', evidence: 'panel-trace' };
            continue;
        }
        if (visibleText.includes('thinking')
            || visibleText.includes('reasoning')
            || visibleText.includes('pro thinking')) {
            weakVerdict = weakVerdict || { strength: 'weak', evidence: 'panel-text' };
        }
    }
    return weakVerdict || { strength: 'none', evidence: '' };
}

/**
 * Back-compatible boolean view of an activity verdict.
 *
 * `'unknown'` reads as INACTIVE here. That is safe only because both consumers
 * of this boolean view — timeout recovery and the copy fallback — gate their
 * success on independent terminal evidence (`isResponseFinished`). It is not
 * safe because the deadline has passed.
 *
 * @param {ChatGptActivityState|boolean|null|undefined} state
 * @returns {boolean}
 */
export function isActiveState(state) {
    if (typeof state === 'boolean') return state;
    return Boolean(state && state.strength !== 'none' && state.strength !== 'unknown');
}

/**
 * @typedef {object} ChatGptAssistantSnapshot
 * @property {string} text
 * @property {string|null} messageId
 * @property {string|null} turnId
 * @property {number} turnIndex
 */

/**
 * A snapshot carrying its provenance and a shared document-order coordinate.
 * Produced only by `readAssistantSnapshotSources`, where both sources are read in
 * ONE pass so `domOrder` is comparable across them.
 * @typedef {ChatGptAssistantSnapshot & { source: 'wrapped'|'wrapperless', domOrder: number }} ChatGptCorrelatedSnapshot
 */

/**
 * Browser-context. Single acquisition for both snapshot sources, sharing one
 * document-order coordinate space.
 *
 * Wrapperless markdown only qualifies when it DOM-FOLLOWS the latest user node:
 * without a turn index that is the only way to tell a new answer from an old one
 * or from the user's own echo, so anything else is dropped rather than
 * optimistically accepted.
 *
 * Declares every constant and helper in its own body: `page.evaluate` serializes
 * the body, not the module.
 *
 * @param {{ assistantSelectors: string[], resolverSource?: string, userSelectors?: string[], markdownSelectors?: string[] }} options
 * `ok` distinguishes a SUCCESSFUL empty acquisition from a failure: a caller must
 * never fall back to a legacy reader after a successful empty read, or it will
 * count whatever that reader happens to find.
 *
 * @returns {{ ok: true, wrapped: ChatGptCorrelatedSnapshot[], wrapperless: ChatGptCorrelatedSnapshot[] }}
 */
export function readAssistantSnapshotSources({ assistantSelectors, resolverSource, userSelectors, markdownSelectors }) {
    const USER_SELECTORS = (userSelectors && userSelectors.length) ? userSelectors : [
        '[data-message-author-role="user"]',
        '[data-turn="user"]',
    ];
    const MARKDOWN_SELECTORS = (markdownSelectors && markdownSelectors.length) ? markdownSelectors : [
        '.markdown',
        '[data-message-content]',
    ];
    const WRAPPER_SELECTORS = [
        '[data-message-author-role]',
        '[data-turn]',
        'article[data-testid^="conversation-turn"]',
    ];

    const FOLLOWING = document?.defaultView?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
    const isVisible = (/** @type {any} */ node) => {
        const rect = node.getBoundingClientRect?.();
        return Boolean(rect) && rect.width > 0 && rect.height > 0;
    };
    const orderNodes = (/** @type {any[]} */ nodes) => {
        const unique = Array.from(new Set(nodes));
        unique.sort((a, b) => (a.compareDocumentPosition(b) & FOLLOWING) ? -1 : 1);
        return unique;
    };
    const textOf = (/** @type {any} */ node) => String(node.innerText || node.textContent || '').trim();
    const describe = (/** @type {any} */ node) => {
        const messageNode = node.matches?.('[data-message-id]') ? node : node.querySelector?.('[data-message-id]');
        const turnNode = node.matches?.('[data-testid^="conversation-turn"]')
            ? node
            : node.querySelector?.('[data-testid^="conversation-turn"]');
        return {
            text: textOf(node),
            messageId: messageNode?.getAttribute?.('data-message-id') || null,
            turnId: turnNode?.getAttribute?.('data-testid') || null,
        };
    };

    /** @type {any[]} */
    let wrappedNodes = [];
    try {
        const resolver = resolverSource ? (0, eval)(`(${resolverSource})`) : null;
        wrappedNodes = resolver ? (resolver(assistantSelectors) || []) : [];
    } catch { wrappedNodes = []; }

    const userNodes = orderNodes(USER_SELECTORS.flatMap(
        (selector) => Array.from(document.querySelectorAll(selector))));
    const latestUser = userNodes[userNodes.length - 1] || null;

    const wrapperlessNodes = orderNodes(MARKDOWN_SELECTORS.flatMap(
        (selector) => Array.from(document.querySelectorAll(selector))))
        .filter((node) => isVisible(node))
        .filter((node) => !node.closest?.(WRAPPER_SELECTORS.join(', ')))
        .filter((node) => Boolean(latestUser)
            && (latestUser.compareDocumentPosition(node) & FOLLOWING) !== 0)
        .filter((node) => textOf(node));

    const order = new Map(orderNodes([...wrappedNodes, ...wrapperlessNodes])
        .map((node, index) => [node, index]));

    return {
        ok: true,
        wrapped: wrappedNodes.map((/** @type {any} */ node, /** @type {number} */ turnIndex) => ({
            ...describe(node), turnIndex, source: 'wrapped', domOrder: order.get(node) ?? turnIndex,
        })),
        wrapperless: wrapperlessNodes.map((/** @type {any} */ node) => ({
            ...describe(node), turnIndex: -1, source: 'wrapperless', domOrder: order.get(node) ?? 0,
        })),
    };
}

/**
 * Browser-context helper. Keep the body serialization-safe for page.evaluate.
 * @param {string[]|{ selectors: string[], resolverSource?: string }} input
 * @returns {ChatGptAssistantSnapshot[]}
 */
export function readTopLevelAssistantSnapshots(input) {
    const selectors = Array.isArray(input) ? input : input?.selectors;
    const resolverSource = Array.isArray(input) ? '' : input?.resolverSource;
    const resolver = resolverSource
        ? (0, eval)(`(${resolverSource})`)
        : resolveTopLevelAssistantTurns;
    return resolver(selectors).map((node, turnIndex) => {
        const messageNode = node.matches?.('[data-message-id]')
            ? node
            : node.querySelector?.('[data-message-id]');
        const turnNode = node.matches?.('[data-testid^="conversation-turn"]')
            ? node
            : node.querySelector?.('[data-testid^="conversation-turn"]');
        return {
            text: String((/** @type {any} */ (node)).innerText || node.textContent || '').trim(),
            messageId: messageNode?.getAttribute?.('data-message-id') || null,
            turnId: turnNode?.getAttribute?.('data-testid') || null,
            turnIndex,
        };
    }).filter(snapshot => Boolean(snapshot.text));
}

/**
 * Browser-context helper. Keep this self-contained so Playwright can serialize
 * it into page.evaluate without relying on module closures.
 * @param {string[]} selectors
 * @returns {string[]}
 */
export function readTopLevelAssistantTexts(selectors) {
    return readTopLevelAssistantSnapshots(selectors).map(snapshot => snapshot.text);
}

/**
 * Fallback path for environments where page.evaluate fails but Playwright
 * locators still work. It applies the same descendant de-duplication rule as
 * readTopLevelAssistantTexts().
 * @param {any} page
 * @param {string[]} selectors
 * @returns {Promise<string[]>}
 */
export async function readTopLevelAssistantTextsFromLocators(page, selectors = CHATGPT_ASSISTANT_SELECTORS) {
    for (const selector of selectors) {
        const locators = await page.locator(selector).all().catch(() => []);
        const texts = [];
        for (const locator of locators) {
            let text = '';
            if (typeof locator.evaluate === 'function') {
                text = await locator.evaluate((/** @type {any} */ node, /** @type {string} */ activeSelector) => {
                    const matched = Array.from(document.querySelectorAll(activeSelector));
                    const nested = matched.some(other =>
                        other !== node && typeof other.contains === 'function' && other.contains(node));
                    if (nested) return '';
                    return String(node.innerText || node.textContent || '').trim();
                }, selector).catch(() => '');
            } else {
                text = await locator.innerText().catch(() => '');
            }
            text = String(text || '').trim();
            if (text) texts.push(text);
        }
        if (texts.length) return texts;
    }
    return [];
}
