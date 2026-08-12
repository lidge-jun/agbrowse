import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { selectChatGptComposerTools } from '../../web-ai/chatgpt-tools.mjs';
import {
    MENU_CONTAINER_SELECTOR,
    MENU_ITEM_SELECTOR,
} from '../../web-ai/chatgpt-menu-resolver.mjs';

/**
 * Public-path harness: a jsdom document behind a Playwright-shaped page, so
 * these tests exercise selectChatGptComposerTools exactly as production calls
 * it — including page.evaluate transport of the resolver functions.
 *
 * jsdom has no layout, so `isVisible` is modelled by a `data-test-hidden`
 * attribute and injected into both serialized functions.
 */
function makePage(html, { onClick = () => {} } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const { document } = dom.window;
    const isVisible = (node) => !node.hasAttribute('data-test-hidden');
    const clicks = [];

    // The resolver reads globals; give it this document for the duration.
    const withGlobals = (fn) => {
        const prior = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
        globalThis.window = dom.window;
        globalThis.document = document;
        globalThis.HTMLElement = dom.window.HTMLElement;
        try {
            return fn();
        } finally {
            Object.assign(globalThis, prior);
        }
    };

    const locatorFor = (selector) => {
        const nodes = () => Array.from(document.querySelectorAll(selector));
        const handle = (element) => ({
            isVisible: async () => Boolean(element) && isVisible(element),
            click: async () => {
                if (!element) throw new Error('no element');
                clicks.push(element.textContent.trim());
                onClick(element, document);
            },
            hover: async () => undefined,
            boundingBox: async () => (element ? { x: 0, y: 0, width: 10, height: 10 } : null),
            innerText: async () => element?.textContent || '',
            getAttribute: async (name) => element?.getAttribute(name) ?? null,
        });
        return {
            first: () => handle(nodes()[0]),
            nth: (index) => handle(nodes()[index]),
            all: async () => nodes().map(handle),
            count: async () => nodes().length,
        };
    };

    return {
        clicks,
        document,
        page: {
            locator: locatorFor,
            evaluate: async (fn, arg) => withGlobals(() => fn({ ...arg, isVisible })),
            waitForTimeout: async () => undefined,
            keyboard: { press: async () => undefined, down: async () => undefined, up: async () => undefined },
            mouse: { click: async () => undefined },
        },
    };
}

const plus = '<button data-testid="composer-plus-btn">Add</button>';
const row = (label) => `<div class="__menu-item" tabindex="0" data-fill><span>${label}</span></div>`;

afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
});

describe('ChatGPT composer menu selection flow (issue #81)', () => {
    it('selects a connector from the popover the plus click opened', async () => {
        const harness = makePage(`<form>${plus}</form>`, {
            onClick: (element, document) => {
                if (!element.matches('[data-testid="composer-plus-btn"]')) return;
                document.body.insertAdjacentHTML('beforeend', `<div class="popover">${row('GitHub')}</div>`);
            },
        });

        const result = await selectChatGptComposerTools(harness.page, { plugins: ['github'] });

        expect(result.selectedPlugins).toEqual(['github']);
        expect(result.warnings).toEqual([]);
        expect(result.usedFallbacks).not.toContain('composer-plus-shortcut');
        expect(harness.clicks).toContain('GitHub');
    });

    it('reaches a connector that lives behind the More submenu', async () => {
        // Regression: an ownership probe that asked for the connector label
        // would report "menu not open" for this menu and re-click plus forever.
        const harness = makePage(`<form>${plus}</form>`, {
            onClick: (element, document) => {
                if (element.matches('[data-testid="composer-plus-btn"]')) {
                    document.body.insertAdjacentHTML('beforeend', `<div class="popover">${row('More')}</div>`);
                    return;
                }
                if (element.textContent.includes('More')) {
                    // Portaled sibling submenu root, not a descendant.
                    document.body.insertAdjacentHTML('beforeend', `<div class="popover">${row('GitHub')}</div>`);
                }
            },
        });

        const result = await selectChatGptComposerTools(harness.page, { plugins: ['github'] });

        expect(result.selectedPlugins).toEqual(['github']);
        expect(harness.clicks.filter(text => text === 'Add')).toHaveLength(1);
        expect(harness.clicks).toContain('GitHub');
    });

    it('does not let a popover opened by a previous selection be clicked', async () => {
        // Reviewer reproduction: selecting a tool closes the composer menu and
        // an unrelated popover appears. A surviving epoch would hand it the
        // causal ownership tier and click its row.
        const harness = makePage(`<form>${plus}</form>`, {
            onClick: (element, document) => {
                if (element.matches('[data-testid="composer-plus-btn"]')) {
                    const existing = document.querySelector('.popover');
                    if (!existing) {
                        document.body.insertAdjacentHTML('beforeend',
                            `<div class="popover" id="composer-menu">${row('Web search')}</div>`);
                    }
                    return;
                }
                if (element.textContent.includes('Web search')) {
                    document.querySelector('#composer-menu')?.remove();
                    document.body.insertAdjacentHTML('beforeend',
                        `<div class="popover" id="unrelated">${row('GitHub')}</div>`);
                }
            },
        });

        const result = await selectChatGptComposerTools(harness.page, {
            tools: ['web-search'],
            plugins: ['github'],
        });

        expect(result.selectedTools).toEqual(['web-search']);
        expect(result.selectedPlugins).toEqual([]);
        expect(result.warnings).toContain('composer plugin not selected: github');
        expect(harness.clicks).not.toContain('GitHub');
    });

    it('does not grant causal ownership when the plus button never activates', async () => {
        // Every plus click fails; only the blind keyboard shortcut runs. The
        // unrelated popover must appear AFTER the snapshot — otherwise it is
        // recorded as pre-existing and the test cannot detect a shortcut path
        // that wrongly mints causal ownership.
        const harness = makePage('<div class="composer"></div>');
        harness.page.locator = ((original) => (selector) => {
            const locator = original(selector);
            if (selector.includes('composer-plus-btn') || selector.includes('aria-label')) {
                return { ...locator, first: () => ({ isVisible: async () => false }) };
            }
            return locator;
        })(harness.page.locator);
        harness.page.keyboard = {
            press: async () => {
                if (harness.document.querySelector('.popover')) return;
                harness.document.body.insertAdjacentHTML('beforeend', `<div class="popover">${row('GitHub')}</div>`);
            },
            down: async () => undefined,
            up: async () => undefined,
        };

        const result = await selectChatGptComposerTools(harness.page, { plugins: ['github'] });

        expect(result.selectedPlugins).toEqual([]);
        expect(result.warnings).toContain('composer plugin not selected: github');
        expect(result.usedFallbacks).toContain('composer-plus-shortcut');
        expect(harness.clicks).not.toContain('GitHub');
    });

    it('exposes the resolver selectors it indexes against', () => {
        expect(MENU_CONTAINER_SELECTOR).toContain('.popover');
        expect(MENU_ITEM_SELECTOR).toContain('.popover .__menu-item');
    });

    it('transports the observed More control id into the resolver payload (G81b)', async () => {
        // Guards the PRODUCTION path: deleting `ownedContainerId` from the
        // evaluate payload, or dropping the argument at the forwarding call,
        // makes the feature inert while resolver-level tests stay green.
        const payloads = [];
        const harness = makePage(`<form>${plus}</form>`, {
            onClick: (element, document) => {
                if (element.matches('[data-testid="composer-plus-btn"]')) {
                    document.body.insertAdjacentHTML('beforeend',
                        '<div class="popover" id="composer-menu">'
                        + '<div class="__menu-item" tabindex="0" data-fill aria-controls="submenu-x"><span>More</span></div>'
                        + '</div>');
                    return;
                }
                if (element.textContent.includes('More')) {
                    document.body.insertAdjacentHTML('beforeend',
                        `<div class="popover" id="submenu-x">${row('GitHub')}</div>`);
                }
            },
        });
        const originalEvaluate = harness.page.evaluate;
        harness.page.evaluate = async (fn, arg) => {
            if (arg && 'ownedContainerId' in arg) payloads.push(arg.ownedContainerId);
            else if (arg && 'labels' in arg) payloads.push('MISSING-KEY');
            return originalEvaluate(fn, arg);
        };

        await selectChatGptComposerTools(harness.page, { plugins: ['github'] });

        // At least one resolution after the More row was observed must carry its
        // aria-controls target, and none may report the key as absent.
        expect(payloads).not.toContain('MISSING-KEY');
        expect(payloads).toContain('submenu-x');
    });

    it('expands More from an already-open menu into a portaled submenu', async () => {
        // The composer menu is already up, so there is no plus-click epoch.
        // The More expansion must mint its own, or the portaled submenu has no
        // attributable ownership and the connector is unreachable.
        const harness = makePage(`<form>${plus}</form><div class="popover" id="composer-menu">${row('More')}</div>`, {
            onClick: (element, document) => {
                if (element.textContent.includes('More')) {
                    document.body.insertAdjacentHTML('beforeend', `<div class="popover" id="portaled">${row('GitHub')}</div>`);
                }
            },
        });

        const result = await selectChatGptComposerTools(harness.page, { plugins: ['github'] });

        expect(result.selectedPlugins).toEqual(['github']);
        expect(harness.clicks).not.toContain('Add');
        expect(harness.clicks).toContain('GitHub');
    });

    it('does not claim a popover that merely appeared during the More hover', async () => {
        // Hover is not a confirmed cause: a popover opening for an unrelated
        // reason inside the hover window must not inherit causal ownership.
        const harness = makePage(`<form>${plus}</form><div class="popover" id="composer-menu">${row('More')}</div>`);
        const originalLocator = harness.page.locator;
        harness.page.locator = (selector) => {
            const locator = originalLocator(selector);
            return {
                ...locator,
                nth: (index) => {
                    const handle = locator.nth(index);
                    return {
                        ...handle,
                        hover: async () => {
                            // Hover succeeds but opens nothing of ours; an
                            // unrelated connector popover shows up instead.
                            if (harness.document.querySelector('#unrelated')) return;
                            harness.document.body.insertAdjacentHTML('beforeend',
                                `<div class="popover" id="unrelated">${row('GitHub')}</div>`);
                        },
                    };
                },
            };
        };

        const result = await selectChatGptComposerTools(harness.page, { plugins: ['github'] });

        expect(result.selectedPlugins).toEqual([]);
        expect(result.warnings).toContain('composer plugin not selected: github');
        expect(harness.clicks).not.toContain('GitHub');
    });

    it('treats an evaluate that RESOLVES null as "no verdict" instead of crashing', async () => {
        // A rejected evaluate was already normalized; one that resolves null was
        // not, so the bare null reached `result.reason` and threw
        // "Cannot read properties of null". Any page whose evaluate cannot
        // serialize this call hits it -- the fake-ChatGPT integration fixture
        // did, on the ordinary tool-selection path.
        const page = {
            locator: () => ({
                first: () => ({
                    isVisible: async () => true,
                    click: async () => undefined,
                    boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }),
                    hover: async () => undefined,
                    getAttribute: async () => null,
                }),
                nth: () => ({ isVisible: async () => false }),
                all: async () => [],
                count: async () => 0,
            }),
            evaluate: async () => null,
            waitForTimeout: async () => undefined,
            keyboard: { press: async () => undefined, down: async () => undefined, up: async () => undefined },
            mouse: { click: async () => undefined },
        };

        const result = await selectChatGptComposerTools(page, { plugins: ['github'] });

        expect(result.selectedPlugins).toEqual([]);
        expect(result.warnings).toContain('composer plugin not selected: github');
    });
});
