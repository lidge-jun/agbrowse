// @ts-check

import { parseArgs } from 'node:util';
import { runRunwayPollCli } from './runway-monitor.mjs';

const RUNWAY_BASE_URL = 'https://app.runwayml.com';
const DEFAULT_WAIT_TIMEOUT_MS = 15000;

/** @typedef {{ id: string, label: string, url: string | null, deepAutomation: boolean, purpose: string }} RunwaySurface */
/** @typedef {{ name: string, selector: string, locator: string, purpose: string, blocked?: boolean }} RunwaySelector */

/** @type {Readonly<Record<string, RunwaySurface>>} */
export const RUNWAY_SURFACES = Object.freeze({
    apps: {
        id: 'apps',
        label: 'Apps',
        url: `${RUNWAY_BASE_URL}/ai-tools/generate?mode=apps`,
        deepAutomation: true,
        purpose: 'Unlimited-relevant app/model catalog and starter surface',
    },
    'custom-tools': {
        id: 'custom-tools',
        label: 'Custom/tools',
        url: `${RUNWAY_BASE_URL}/ai-tools/generate?mode=tools`,
        deepAutomation: true,
        purpose: 'Unlimited-relevant generation form and parameter controls',
    },
    agent: {
        id: 'agent',
        label: 'Agent',
        url: null,
        deepAutomation: false,
        purpose: 'Surface-only conversational/outline flow',
    },
    recents: {
        id: 'recents',
        label: 'Recents',
        url: null,
        deepAutomation: false,
        purpose: 'Surface-only asset/job library',
    },
    workflow: {
        id: 'workflow',
        label: 'Workflow',
        url: null,
        deepAutomation: false,
        purpose: 'Surface-only node/canvas flow',
    },
    characters: {
        id: 'characters',
        label: 'Characters',
        url: null,
        deepAutomation: false,
        purpose: 'Surface-only catalog/input source',
    },
});

/** @type {Readonly<Record<string, string>>} */
const SURFACE_ALIASES = Object.freeze({
    app: 'apps',
    apps: 'apps',
    custom: 'custom-tools',
    tools: 'custom-tools',
    tool: 'custom-tools',
    'custom-tools': 'custom-tools',
    'custom/tools': 'custom-tools',
    agent: 'agent',
    recents: 'recents',
    sessions: 'recents',
    workflow: 'workflow',
    workflows: 'workflow',
    characters: 'characters',
    character: 'characters',
});

/** @type {readonly RunwaySelector[]} */
const COMMON_SELECTORS = Object.freeze([
    {
        name: 'left-sidebar',
        selector: '[data-testid="mira-app-sidebar"]',
        locator: 'page.locator(\'[data-testid="mira-app-sidebar"]\')',
        purpose: 'Runway main navigation container',
    },
    {
        name: 'unlimited-plan-indicator',
        selector: '[data-testid="credit-info-button"]',
        locator: 'page.locator(\'[data-testid="credit-info-button"]\')',
        purpose: 'Plan/quota preflight. Read only.',
    },
]);

/** @type {Readonly<Record<string, readonly RunwaySelector[]>>} */
const SURFACE_SELECTORS = Object.freeze({
    apps: Object.freeze([
        {
            name: 'apps-search',
            selector: 'input[placeholder="Describe your creation or search apps"]',
            locator: 'page.getByPlaceholder(\'Describe your creation or search apps\')',
            purpose: 'Apps search/input surface',
        },
        {
            name: 'models-tab',
            selector: 'role=tab[name="Models"]',
            locator: 'page.getByRole(\'tab\', { name: \'Models\' })',
            purpose: 'Models catalog tab',
        },
        {
            name: 'model-card',
            selector: 'role=button[name=/^Seedance 2\\.0 - Video$/]',
            locator: 'page.getByRole(\'button\', { name: /^Seedance 2\\.0 - Video$/ })',
            purpose: 'Representative Apps model card selector pattern',
        },
    ]),
    'custom-tools': Object.freeze([
        {
            name: 'prompt-editor',
            selector: 'div[aria-label="Prompt"]',
            locator: 'page.locator(\'div[aria-label="Prompt"]\')',
            purpose: 'Prompt editor for Custom/tools generation setup',
        },
        {
            name: 'file-input',
            selector: 'input[type="file"]',
            locator: 'page.locator(\'input[type="file"]\')',
            purpose: 'Asset upload input. Use only when upload is requested.',
        },
        {
            name: 'base-model-select',
            selector: '[data-testid="select-base-model"]',
            locator: 'page.locator(\'[data-testid="select-base-model"]\')',
            purpose: 'Video/image model selection control',
        },
        {
            name: 'related-apps',
            selector: '#related-apps-trigger',
            locator: 'page.locator(\'#related-apps-trigger\')',
            purpose: 'Helpful Apps relation picker',
        },
        {
            name: 'generation-cost',
            selector: 'role=button[name=/^View generation cost$/]',
            locator: 'page.getByRole(\'button\', { name: /^View generation cost$/ })',
            purpose: 'Cost preflight candidate. Read only.',
        },
        {
            name: 'generate',
            selector: 'role=button[name=/^Generate$/]',
            locator: 'page.getByRole(\'button\', { name: /^Generate$/ })',
            purpose: 'Submission selector. Never click during status/preflight.',
            blocked: true,
        },
    ]),
});

const BLOCKED_ACTIONS = Object.freeze([
    'Generate',
    'Run all',
    'payment',
    'destructive',
    'submit-like controls',
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} raw
 * @param {{ allowAuto?: boolean, allowAll?: boolean }} [options]
 * @returns {string}
 */
export function normalizeRunwaySurface(raw = 'auto', options = {}) {
    const value = clean(raw).toLowerCase();
    if (options.allowAuto && (!value || value === 'auto')) return 'auto';
    if (options.allowAll && (!value || value === 'all')) return 'all';
    const normalized = SURFACE_ALIASES[value];
    if (normalized) return normalized;
    const allowed = Object.keys(RUNWAY_SURFACES).join('|');
    throw new Error(`unknown Runway surface: ${raw}. Expected ${allowed}`);
}

/**
 * @param {string} [surface]
 */
export function buildRunwaySelectorContract(surface = 'all') {
    const requested = normalizeRunwaySurface(surface, { allowAll: true });
    const surfaces = requested === 'all'
        ? Object.fromEntries(Object.keys(RUNWAY_SURFACES).map(id => [id, {
            ...RUNWAY_SURFACES[id],
            selectors: SURFACE_SELECTORS[id] || [],
        }]))
        : {
            [requested]: {
                ...RUNWAY_SURFACES[requested],
                selectors: SURFACE_SELECTORS[requested] || [],
            },
        };
    return {
        ok: true,
        vendor: 'runway',
        source: 'devlog/_plan/260519_competitor_skill_trigger_research/16_runway_ui_selector_capture.md',
        focus: ['apps', 'custom-tools'],
        commonSelectors: COMMON_SELECTORS,
        surfaces,
        safety: buildRunwaySafety(),
    };
}

/**
 * @param {string} [url]
 * @param {string} [text]
 * @returns {string}
 */
export function detectRunwaySurface(url = '', text = '') {
    const lowerUrl = String(url || '').toLowerCase();
    const lowerText = String(text || '').toLowerCase();
    if (lowerUrl.includes('mode=apps')) return 'apps';
    if (lowerUrl.includes('mode=tools')) return 'custom-tools';
    if (lowerUrl.includes('workflow')) return 'workflow';
    if (lowerText.includes('describe your creation or search apps')) return 'apps';
    if (lowerText.includes('view generation cost') || lowerText.includes('audio settings')) return 'custom-tools';
    if (lowerText.includes('characters')) return 'characters';
    if (lowerText.includes('recents')) return 'recents';
    if (lowerText.includes('agent')) return 'agent';
    return 'unknown';
}

export function buildRunwaySafety() {
    return {
        mutationAllowed: false,
        blockedActions: BLOCKED_ACTIONS,
        note: 'Runway status/preflight/open commands never click Generate, Run all, payment, destructive, or submit-like controls.',
    };
}

/**
 * @param {any} page
 * @param {{ surface?: string }} [options]
 */
export async function inspectRunwayPage(page, options = {}) {
    const errors = [];
    let url = '';
    let title = '';
    try {
        url = typeof page.url === 'function' ? page.url() : '';
    } catch (error) {
        errors.push(`url: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        title = typeof page.title === 'function' ? await page.title() : '';
    } catch (error) {
        errors.push(`title: ${error instanceof Error ? error.message : String(error)}`);
    }

    let dom = defaultDomSummary();
    try {
        dom = await page.evaluate(() => {
            /** @param {unknown} value */
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            /** @param {string} selector */
            const q = (selector) => Boolean(document.querySelector(selector));
            /** @param {string} selector */
            const text = (selector) => normalize(document.querySelector(selector)?.textContent || '');
            const visibleText = normalize(document.body?.innerText || '');
            const buttonTexts = Array.from(document.querySelectorAll('button'))
                .map((button) => normalize(button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || ''))
                .filter(Boolean)
                .slice(0, 80);
            return {
                textSample: visibleText.slice(0, 1000),
                selectors: {
                    '[data-testid="mira-app-sidebar"]': q('[data-testid="mira-app-sidebar"]'),
                    '[data-testid="credit-info-button"]': q('[data-testid="credit-info-button"]'),
                    'input[placeholder="Describe your creation or search apps"]': q('input[placeholder="Describe your creation or search apps"]'),
                    'div[aria-label="Prompt"]': q('div[aria-label="Prompt"]'),
                    'input[type="file"]': q('input[type="file"]'),
                    '[data-testid="select-base-model"]': q('[data-testid="select-base-model"]'),
                    '#related-apps-trigger': q('#related-apps-trigger'),
                    'button[title="Click to rename"]': q('button[title="Click to rename"]'),
                },
                counts: {
                    buttons: document.querySelectorAll('button').length,
                    inputs: document.querySelectorAll('input').length,
                    fileInputs: document.querySelectorAll('input[type="file"]').length,
                    textareas: document.querySelectorAll('textarea').length,
                },
                quota: {
                    creditInfoText: text('[data-testid="credit-info-button"]') || null,
                    hasUnlimitedText: /unlimited/i.test(visibleText),
                    hasGenerationCostText: /view generation cost/i.test(visibleText),
                },
                auth: {
                    hasLoginText: /\blogin\b/i.test(visibleText),
                    hasSignUpText: /sign up/i.test(visibleText),
                },
                actions: {
                    hasGenerateButton: buttonTexts.some(label => /^generate$/i.test(label)),
                    hasRunAllButton: buttonTexts.some(label => /^run all$/i.test(label)),
                    buttonTexts,
                },
            };
        });
    } catch (error) {
        errors.push(`dom-evaluate: ${error instanceof Error ? error.message : String(error)}`);
    }

    const requested = normalizeRunwaySurface(options.surface || 'auto', { allowAuto: true });
    const detected = requested === 'auto' ? detectRunwaySurface(url, dom.textSample) : requested;
    const selectorEntries = Object.entries(dom.selectors || {});
    return {
        ok: errors.length === 0,
        vendor: 'runway',
        command: 'status',
        surfaceRequested: requested,
        surfaceDetected: detected,
        deepAutomationTarget: Boolean(RUNWAY_SURFACES[detected]?.deepAutomation),
        url,
        title,
        selectors: {
            present: Object.fromEntries(selectorEntries.filter(([, present]) => Boolean(present))),
            missing: selectorEntries.filter(([, present]) => !present).map(([selector]) => selector),
        },
        counts: dom.counts,
        quota: dom.quota,
        auth: {
            ...dom.auth,
            likelyGuest: /\/teams\/guest\//i.test(url) || Boolean(dom.auth?.hasLoginText && dom.auth?.hasSignUpText),
        },
        actions: dom.actions,
        textSample: dom.textSample,
        safety: buildRunwaySafety(),
        warnings: /** @type {string[]} */ ([]),
        errors,
    };
}

function defaultDomSummary() {
    return {
        textSample: '',
        selectors: {},
        counts: { buttons: 0, inputs: 0, fileInputs: 0, textareas: 0 },
        quota: { creditInfoText: null, hasUnlimitedText: false, hasGenerationCostText: false },
        auth: { hasLoginText: false, hasSignUpText: false },
        actions: { hasGenerateButton: false, hasRunAllButton: false, buttonTexts: [] },
    };
}

/**
 * @param {any} deps
 * @param {string} text
 */
function emit(deps, text) {
    if (typeof deps.write === 'function') deps.write(text);
    else console.log(text);
}

export function formatRunwayUsage() {
    return `agbrowse runway <command> [flags]

Commands:
  selectors [--surface apps|custom-tools|all] [--json]
      Print the captured selector contract from the Runway devlog.
  status [--surface auto|apps|custom-tools] [--json]
      Inspect the current Runway tab. Read-only.
  open --surface apps|custom-tools [--json] [--timeout ms]
      Navigate the current agbrowse tab to a supported Runway surface, then inspect.
  preflight --surface apps|custom-tools [--json] [--timeout ms]
      Alias for open + status. It does not submit a generation.
  poll [--timeout 600000] [--interval 5000] [--queue-limit 2] [--json]
      Poll the current Runway tab for queue/completion signals. Read-only.

Safety:
  Runway is a media task-runner surface, not web-ai. These commands never click
  Generate, Run all, payment, destructive, or submit-like controls.`;
}

/**
 * @param {any} result
 */
export function formatRunwayStatus(result) {
    const lines = [
        'Runway status',
        `surface: ${result.surfaceDetected} (requested: ${result.surfaceRequested})`,
        `deepAutomationTarget: ${result.deepAutomationTarget ? 'yes' : 'no'}`,
        `url: ${result.url || 'n/a'}`,
        `title: ${result.title || 'n/a'}`,
        `unlimitedHint: ${result.quota?.hasUnlimitedText ? 'yes' : 'no'}`,
        `generationCostHint: ${result.quota?.hasGenerationCostText ? 'yes' : 'no'}`,
        `guestHint: ${result.auth?.likelyGuest ? 'yes' : 'no'}`,
        `mutationAllowed: ${result.safety.mutationAllowed ? 'yes' : 'no'}`,
    ];
    const present = Object.keys(result.selectors?.present || {});
    if (present.length) lines.push(`selectorsPresent: ${present.join(', ')}`);
    if (result.selectors?.missing?.length) lines.push(`selectorsMissing: ${result.selectors.missing.join(', ')}`);
    if (result.warnings?.length) lines.push(`warnings: ${result.warnings.join('; ')}`);
    if (result.errors?.length) lines.push(`errors: ${result.errors.join('; ')}`);
    return lines.join('\n');
}

/**
 * @param {ReturnType<typeof buildRunwaySelectorContract>} contract
 */
function formatRunwaySelectors(contract) {
    const lines = [
        'Runway selector contract',
        `source: ${contract.source}`,
        `focus: ${contract.focus.join(', ')}`,
        `blocked: ${contract.safety.blockedActions.join(', ')}`,
        '',
        'common:',
        ...contract.commonSelectors.map(item => `  - ${item.name}: ${item.selector}`),
    ];
    for (const [surface, info] of Object.entries(contract.surfaces)) {
        lines.push('', `${surface}: ${info.purpose}`);
        for (const item of info.selectors || []) {
            lines.push(`  - ${item.name}: ${item.selector}${item.blocked ? ' [blocked]' : ''}`);
        }
    }
    return lines.join('\n');
}

/**
 * @param {string[]} args
 * @param {any} deps
 */
export async function runRunwayCli(args = [], deps = {}) {
    const command = args[0] || 'help';
    if (command === 'help' || command === '--help' || command === '-h') {
        emit(deps, formatRunwayUsage());
        return;
    }
    if (command === 'selectors') {
        const { values } = parseArgs({
            args: args.slice(1),
            options: {
                surface: { type: 'string', default: 'all' },
                json: { type: 'boolean', default: false },
            },
            strict: false,
        });
        const contract = buildRunwaySelectorContract(String(values.surface || 'all'));
        emit(deps, values.json ? JSON.stringify(contract, null, 2) : formatRunwaySelectors(contract));
        return;
    }
    if (command === 'status') {
        const { values } = parseArgs({
            args: args.slice(1),
            options: {
                surface: { type: 'string', default: 'auto' },
                json: { type: 'boolean', default: false },
            },
            strict: false,
        });
        const page = await deps.getPage();
        const result = await inspectRunwayPage(page, { surface: String(values.surface || 'auto') });
        emit(deps, values.json ? JSON.stringify(result, null, 2) : formatRunwayStatus(result));
        return;
    }
    if (command === 'poll') return runRunwayPollCli(args.slice(1), deps);
    if (command === 'open' || command === 'preflight') {
        const { values } = parseArgs({
            args: args.slice(1),
            options: {
                surface: { type: 'string', default: 'custom-tools' },
                json: { type: 'boolean', default: false },
                timeout: { type: 'string', default: String(DEFAULT_WAIT_TIMEOUT_MS) },
            },
            strict: false,
        });
        const surface = normalizeRunwaySurface(String(values.surface || 'custom-tools'));
        const target = RUNWAY_SURFACES[surface];
        if (!target?.url) throw new Error(`Runway ${surface} is surface-only; open/preflight supports apps|custom-tools`);
        const page = await deps.getPage();
        /** @type {string[]} */
        const warnings = [];
        await page.goto(target.url, {
            waitUntil: 'domcontentloaded',
            timeout: Number(values.timeout || DEFAULT_WAIT_TIMEOUT_MS),
        });
        try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch (error) {
            warnings.push(`networkidle wait skipped after DOMContentLoaded: ${error instanceof Error ? error.message : String(error)}`);
        }
        const result = await inspectRunwayPage(page, { surface });
        result.command = command;
        result.warnings = warnings;
        emit(deps, values.json ? JSON.stringify(result, null, 2) : formatRunwayStatus(result));
        return;
    }
    throw new Error(`${formatRunwayUsage()}\n\nUnknown runway command: ${command}`);
}
