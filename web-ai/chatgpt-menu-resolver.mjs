// @ts-check
// Composer menu resolution for ChatGPT tool/connector selection (issue #81).
//
// SERIALIZATION CONTRACT: `snapshotOpenMenus` and `resolveComposerMenuItem` are
// passed to `page.evaluate`, which serializes a function BODY and not its module
// bindings. Both functions therefore declare every constant they use inside
// themselves. Do not lift those literals to module scope — a shared constant
// resolves to `ReferenceError` inside the page and silently disables ownership
// detection while every in-process test stays green.

export const MENU_CONTAINER_SELECTOR = '[role="menu"], .popover';
export const MENU_ITEM_SELECTOR = [
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '.popover .__menu-item',
    '.popover [tabindex="0"][data-fill]',
].join(', ');
export const MENU_OPEN_TEXT_PATTERN = /사진 및 파일 추가|최근 파일|이미지 만들기|심층 리서치|웹 검색|더 보기|Add photos|Create image|Deep research|Web search|More/i;

/**
 * @typedef {'aria-controls'|'appeared-on-open'|'menu-text'} MenuOwnership
 * @typedef {{ token: number, seen: Element[] }} MenuEpoch
 * @typedef {{ index: number, checked: string|null, ownership: MenuOwnership, reason?: string }} ResolvedMenuItem
 * @typedef {{ index: -1, reason: 'no-open-menu'|'no-owned-menu'|'label-not-found'|'ambiguous', checked?: null, ownership?: MenuOwnership }} UnresolvedMenuItem
 */

/**
 * Browser-context. Record the currently VISIBLE menu containers in a page-local
 * registry so the post-click resolution can tell which container appeared
 * because we clicked the composer's plus button.
 *
 * Nothing is written to the DOM: the registry lives on `window`, so it cannot
 * leak into a snapshot, survive an error, or be lost to a React re-render of an
 * unrelated node. References are released by the next snapshot or a navigation.
 *
 * `isVisible` exists only so in-process tests can supply a predicate: jsdom has
 * no layout, so the default rect test would record nothing. Production calls go
 * through `page.evaluate` with the selector alone and use the rect default —
 * the same predicate `resolveComposerMenuItem` applies, so the snapshot and the
 * resolution always agree on what "visible" means.
 *
 * @param {{ containerSelector: string, isVisible?: (node: any) => boolean }} options
 * @returns {{ ok: true, token: number, count: number }}
 */
export function snapshotOpenMenus({ containerSelector, isVisible }) {
    const visible = typeof isVisible === 'function'
        ? isVisible
        : (/** @type {Element} */ node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
    const scope = /** @type {Window & { __agbrowseComposerMenuEpoch?: MenuEpoch }} */ (window);
    const store = scope.__agbrowseComposerMenuEpoch
        || (scope.__agbrowseComposerMenuEpoch = { token: 0, seen: [] });
    store.token += 1;
    store.seen = [];
    for (const node of Array.from(document.querySelectorAll(containerSelector))) {
        if (!visible(node)) continue;
        store.seen.push(node);
    }
    return { ok: true, token: store.token, count: store.seen.length };
}

/**
 * Browser-context. Resolve the composer-menu row matching one of `labels`,
 * returning its index within document order of `itemSelector` matches.
 *
 * Ownership is POSITIVE EVIDENCE ONLY. A container qualifies when the composer's
 * plus button owns it via aria-controls, when it appeared after our plus click
 * (registry token), or when it carries composer-menu text. An unowned popover is
 * never a candidate, even when it is the only one holding the requested label,
 * and a tie inside one ownership tier fails closed rather than guessing.
 *
 * @param {{ containerSelector: string, itemSelector: string, plusSelectors: string[], labels: string[], menuTextPattern: { source: string, flags: string }, token?: number|null, ownedContainerId?: string|null, isVisible?: (node: any) => boolean }} options
 * @returns {ResolvedMenuItem|UnresolvedMenuItem}
 */
export function resolveComposerMenuItem({
    containerSelector, itemSelector, plusSelectors, labels, menuTextPattern, token, ownedContainerId, isVisible,
}) {
    /** @type {Record<string, number>} */
    const OWNERSHIP_RANK = { 'aria-controls': 3, 'appeared-on-open': 2, 'menu-text': 1 };
    const visible = typeof isVisible === 'function'
        ? isVisible
        : (/** @type {Element} */ node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
    const norm = (/** @type {unknown} */ value) => String(value || '')
        .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const textOf = (/** @type {Element} */ node) => {
        const element = /** @type {HTMLElement} */ (node);
        return element.innerText || element.textContent || '';
    };
    const wanted = labels.map(norm).filter(Boolean);
    const re = new RegExp(menuTextPattern.source, menuTextPattern.flags);

    const ownedByPlus = new Set();
    for (const selector of plusSelectors) {
        for (const button of Array.from(document.querySelectorAll(selector))) {
            if (!visible(button)) continue;
            const id = button.getAttribute('aria-controls');
            const target = id && document.getElementById(id);
            if (target && visible(target)) ownedByPlus.add(target);
        }
    }
    // Exactly ONE extra container may be conferred ownership: the one the caller
    // OBSERVED a triggering row control (its aria-controls target). A selector
    // would admit every row on the page — including an unrelated row pointing at
    // an unrelated popover — and re-open the wrong-click hole.
    if (ownedContainerId) {
        const owned = document.getElementById(ownedContainerId);
        if (owned && visible(owned)) ownedByPlus.add(owned);
    }

    const visibleContainers = Array.from(document.querySelectorAll(containerSelector)).filter(visible);
    if (visibleContainers.length === 0) return { index: -1, reason: 'no-open-menu' };

    const scope = /** @type {Window & { __agbrowseComposerMenuEpoch?: MenuEpoch }} */ (window);
    const store = scope.__agbrowseComposerMenuEpoch;
    // A snapshotted container that vanished was either closed (fine) or REPLACED
    // by a re-render (not fine — its replacement would read as "new"). We cannot
    // tell the two apart, so any disconnection disables the causal tier.
    const snapshotIntact = Boolean(token)
        && store != null
        && store.token === token
        && store.seen.every((node) => node.isConnected);

    /** @type {{ container: Element, ownership: MenuOwnership }[]} */
    const owned = [];
    for (const container of visibleContainers) {
        if (ownedByPlus.has(container)) { owned.push({ container, ownership: 'aria-controls' }); continue; }
        if (store && snapshotIntact && !store.seen.includes(container)) {
            owned.push({ container, ownership: 'appeared-on-open' });
            continue;
        }
        if (re.test(textOf(container))) owned.push({ container, ownership: 'menu-text' });
    }
    if (owned.length === 0) return { index: -1, reason: 'no-owned-menu' };
    if (wanted.length === 0) {
        let strongest = /** @type {MenuOwnership} */ ('menu-text');
        for (const entry of owned) {
            if (OWNERSHIP_RANK[entry.ownership] > OWNERSHIP_RANK[strongest]) strongest = entry.ownership;
        }
        return { index: -1, reason: 'label-not-found', checked: null, ownership: strongest };
    }

    const allItems = Array.from(document.querySelectorAll(itemSelector));
    // Deduplicate by NODE: nested containers (a .popover wrapping a [role="menu"])
    // both match the container selector and would otherwise report the same row
    // twice as a spurious ambiguity. Strongest ownership wins per node.
    /** @type {Map<Element, MenuOwnership>} */
    const byNode = new Map();
    for (const { container, ownership } of owned) {
        for (const item of Array.from(container.querySelectorAll(itemSelector))) {
            if (!visible(item)) continue;
            const text = norm(textOf(item));
            if (!text || !wanted.some((label) => text.includes(label))) continue;
            const existing = byNode.get(item);
            if (!existing || OWNERSHIP_RANK[ownership] > OWNERSHIP_RANK[existing]) byNode.set(item, ownership);
        }
    }
    if (byNode.size === 0) return { index: -1, reason: 'label-not-found' };

    for (const tier of ['aria-controls', 'appeared-on-open', 'menu-text']) {
        const tiered = [...byNode.entries()].filter(([, ownership]) => ownership === tier);
        if (tiered.length === 1) {
            const [item] = tiered[0];
            const index = allItems.indexOf(item);
            if (index < 0) return { index: -1, reason: 'label-not-found' };
            return {
                index,
                checked: item.getAttribute('aria-checked'),
                ownership: /** @type {MenuOwnership} */ (tier),
            };
        }
        if (tiered.length > 1) return { index: -1, reason: 'ambiguous' };
    }
    return { index: -1, reason: 'ambiguous' };
}
