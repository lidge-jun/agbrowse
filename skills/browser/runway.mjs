// @ts-check

import { parseArgs } from 'node:util';
import { runRunwayPollCli } from './runway-monitor.mjs';
import {
    RUNWAY_SURFACES,
    SURFACE_ALIASES,
    COMMON_SELECTORS,
    SURFACE_SELECTORS,
    BLOCKED_ACTIONS,
    RUNWAY_MODEL_CARD_LABELS,
    RUNWAY_CUSTOM_BASE_MODEL_LABELS,
    buildRunwaySafety,
} from './runway-selectors.mjs';
import { navigateRunwaySurface } from './runway-url.mjs';

export {
    RUNWAY_SURFACES,
    SURFACE_ALIASES,
    COMMON_SELECTORS,
    SURFACE_SELECTORS,
    BLOCKED_ACTIONS,
    RUNWAY_MODEL_CARD_LABELS,
    RUNWAY_CUSTOM_BASE_MODEL_LABELS,
    buildRunwaySafety,
};

const DEFAULT_WAIT_TIMEOUT_MS = 15000;

/** @typedef {import('./runway-selectors.mjs').RunwaySurface} RunwaySurface */
/** @typedef {import('./runway-selectors.mjs').RunwaySelector} RunwaySelector */

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
        modelCatalog: {
            source: 'live Chrome smoke 2026-05-29',
            apps: RUNWAY_MODEL_CARD_LABELS,
            customToolsBaseModels: RUNWAY_CUSTOM_BASE_MODEL_LABELS,
        },
        surfaces,
        safety: buildRunwaySafety(0),
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
    if (lowerUrl.includes('/recents')) return 'recents';
    if (lowerUrl.includes('workflow')) return 'workflow';
    if (lowerText.includes('describe your creation or search apps')) return 'apps';
    if (lowerText.includes('view generation cost') || lowerText.includes('audio settings')) return 'custom-tools';
    if (lowerText.includes('characters')) return 'characters';
    if (lowerText.includes('recents')) return 'recents';
    if (lowerText.includes('agent')) return 'agent';
    return 'unknown';
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

            // Plan type extraction
            const creditText = text('[data-testid="credit-info-button"]') || '';
            let planType = 'unknown';
            if (/unlimited/i.test(creditText) || /unlimited/i.test(visibleText.slice(0, 500))) planType = 'Unlimited';
            else if (/standard/i.test(creditText)) planType = 'Standard';
            else if (/free/i.test(creditText)) planType = 'Free';

            // Credits extraction
            const creditsMatch = visibleText.match(/(\d[\d,]*)\s*credits?\s*(?:remaining|left)/i)
                || creditText.match(/(\d[\d,]*)/);
            const credits = creditsMatch ? Number(creditsMatch[1].replace(/,/g, '')) : null;

            // Workspace name
            const workspaceEl = document.querySelector('[data-testid="workspace-name"], [class*="workspace"] [class*="name"]');
            const workspaceName = workspaceEl ? normalize(workspaceEl.textContent || '') : null;

            // Model detection
            const modelSelectEl = document.querySelector('[data-testid="select-base-model"]');
            const selectedModel = modelSelectEl ? normalize(modelSelectEl.textContent || '') : null;
            const modelCatalog = Array.from(document.querySelectorAll('button[aria-label]'))
                .map((button) => normalize(button.getAttribute('aria-label') || ''))
                .filter((label) => / - (?:Video|Image|Video \+ Audio|Character Animation|Image to Video|Upscale Image|Image to Image)$/i.test(label))
                .filter((label, index, all) => label && all.indexOf(label) === index)
                .slice(0, 100);
            const visibleModelOptions = Array.from(document.querySelectorAll(
                '[role="option"], [role="menuitem"], [role="listbox"] button, [class*="dropdown"] button, [class*="model-list"] button, [class*="ModelList"] button'
            ))
                .map((item) => normalize(item.textContent || item.getAttribute('aria-label') || ''))
                .filter((label) => /seedance|wan|kling|gen-|veo|flux|gpt image|nano banana|grok imagine|seedream/i.test(label))
                .filter((label, index, all) => label && all.indexOf(label) === index)
                .slice(0, 100);

            // Generation mode (Explore vs Credits)
            const exploreActive = Boolean(
                document.querySelector('[data-testid="explore-credits-toggle"] [aria-pressed="true"]:first-child')
                || document.querySelector('button[aria-pressed="true"]:has(> span:only-child)')
            );
            const hasExploreText = /\bexplore\b/i.test(visibleText.slice(0, 2000));
            const hasCreditsText = /\bcredits?\s*mode\b/i.test(visibleText.slice(0, 2000));
            let generationMode = 'unknown';
            if (exploreActive || (hasExploreText && !hasCreditsText)) generationMode = 'Explore';
            else if (hasCreditsText) generationMode = 'Credits';
            else if (/unlimited/i.test(visibleText.slice(0, 2000)) && !/view generation cost/i.test(visibleText.slice(0, 2000))) {
                generationMode = 'Explore';
            }

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
                plan: {
                    type: planType,
                    credits,
                },
                workspace: {
                    name: workspaceName,
                },
                model: {
                    selected: selectedModel,
                    catalog: modelCatalog,
                    visibleOptions: visibleModelOptions,
                },
                generation: {
                    mode: generationMode,
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
        plan: dom.plan || { type: 'unknown', credits: null },
        workspace: dom.workspace || { name: null },
        model: dom.model || { selected: null },
        generation: dom.generation || { mode: 'unknown' },
        textSample: dom.textSample,
        safety: buildRunwaySafety(0),
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
        plan: { type: 'unknown', credits: null },
        workspace: { name: null },
        model: { selected: null, catalog: [], visibleOptions: [] },
        generation: { mode: 'unknown' },
    };
}

/**
 * @param {any} page
 * @param {{ limit?: number, type?: string }} [options]
 */
export async function inspectRunwayRecents(page, options = {}) {
    const limit = Number(options.limit) || 20;
    const filterType = String(options.type || 'all').toLowerCase();
    const errors = [];

    let dom = { assets: /** @type {any[]} */ ([]), totalVisible: 0 };
    try {
        dom = await page.evaluate((/** @type {{ limit: number }} */ opts) => {
            /** @param {unknown} value */
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

            const cards = Array.from(document.querySelectorAll(
                '[data-testid="asset-card"], [class*="asset-card"], [class*="AssetCard"], [class*="gallery"] [class*="item"], [class*="recent"] [class*="card"]'
            ));
            const assets = cards.slice(0, opts.limit).map((card, index) => {
                const img = card.querySelector('img');
                const video = card.querySelector('video, source');
                const link = card.querySelector('a[download], a[href*="download"]');
                const label = normalize(card.textContent || '');
                const thumbnail = img?.getAttribute('src') || video?.getAttribute('poster') || null;
                const isVideo = Boolean(video) || /video|\.mp4/i.test(label);
                const isImage = !isVideo && (Boolean(img) || /image|\.png|\.jpe?g/i.test(label));
                return {
                    index,
                    type: isVideo ? 'video' : isImage ? 'image' : 'unknown',
                    label: label.slice(0, 200),
                    thumbnail,
                    downloadUrl: link?.getAttribute('href') || null,
                };
            });
            return { assets, totalVisible: cards.length };
        }, { limit });
    } catch (error) {
        errors.push(`recents-evaluate: ${error instanceof Error ? error.message : String(error)}`);
    }

    let assets = dom.assets || [];
    if (filterType !== 'all') {
        assets = assets.filter((/** @type {any} */ a) => a.type === filterType);
    }

    return {
        ok: errors.length === 0,
        vendor: 'runway',
        command: 'recents',
        totalVisible: dom.totalVisible,
        count: assets.length,
        assets,
        errors,
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

Commands (read-only, Level 0):
  selectors [--surface apps|custom-tools|recents|all] [--json]
      Print the captured selector contract from the Runway devlog.
  status [--surface auto|apps|custom-tools] [--json]
      Inspect the current Runway tab: plan, model, mode, quota. Read-only.
  open --surface apps|custom-tools|recents [--json] [--timeout ms]
      Navigate the current agbrowse tab to a supported Runway surface, then inspect.
  preflight --surface apps|custom-tools [--json] [--timeout ms]
      Alias for open + status. It never submits a generation.
  poll [--timeout 600000] [--interval 5000] [--queue-limit 2] [--after-count N] [--expected-item TEXT] [--json]
      Poll the current Runway tab for queue/completion signals. Read-only.
  recents [--limit 20] [--type image|video|all] [--json]
      Parse asset cards from the Recents surface.

Commands (mutation, Level 1 — requires --allow-mutation):
  setup --prompt TEXT [--model NAME] [--mode video|image] [--duration N]
      [--ratio 16:9] [--resolution 1080p] [--seed-image PATH]
      [--end-image PATH] [--reference-images PATH...] [--explore] [--json]
      Set up generation parameters in the UI without clicking Generate.
  upload --file PATH [--json]
      Upload a file to Runway via browser file input.

Commands (submit, Level 2 — requires --allow-submit):
  generate --prompt TEXT [--model NAME] [--mode video|image] [--duration N]
      [--ratio 16:9] [--resolution 1080p] [--seed-image PATH]
      [--output PATH] [--timeout 600000] [--interval 5000] [--explore] [--json]
      Full generation: setup + Generate click + poll + optional download.
  multishot --shots "scene1" "scene2" "scene3" [--duration N] [--ratio 16:9]
      [--first-scene-image PATH] [--explore] [--output PATH] [--json]
      OR: --story "narrative prompt" [--duration N] [--explore] [--output PATH]
      Multi-scene video generation (3-5 connected scenes).
  product-ad --prompt TEXT [--product-url URL] [--duration N]
      [--output PATH] [--json]
      Product marketing video generation.
  sequence --story TEXT | --shots "beat1" "beat2" [--target-duration 120]
      [--shot-duration 10] [--seed-image PATH] [--explore] [--output PATH] [--json]
      Custom Tools continuity chain: last frame of each clip seeds the next clip.
  download [--index 0] [--output PATH] [--json]
      Download the most recent generated asset.
  screenshot [--output PATH]
      Screenshot the current Runway tab.

Safety Levels:
  Level 0: Read-only (default). No mutation or submission; never click Generate.
  Level 1: --allow-mutation. Prompt input, model selection, file upload.
  Level 2: --allow-submit. Generate button click allowed.`;
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
        `plan: ${result.plan?.type || 'unknown'}`,
        `credits: ${result.plan?.credits ?? 'n/a'}`,
        `workspace: ${result.workspace?.name || 'n/a'}`,
        `model: ${result.model?.selected || 'n/a'}`,
        `modelsVisible: ${result.model?.catalog?.length || result.model?.visibleOptions?.length || 0}`,
        `generationMode: ${result.generation?.mode || 'unknown'}`,
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
    if (command === 'recents') {
        const { values } = parseArgs({
            args: args.slice(1),
            options: {
                limit: { type: 'string', default: '20' },
                type: { type: 'string', default: 'all' },
                json: { type: 'boolean', default: false },
            },
            strict: false,
        });
        const page = await deps.getPage();
        const currentUrl = typeof page.url === 'function' ? page.url() : '';
        if (!/recents/i.test(currentUrl)) {
            const resolved = await navigateRunwaySurface(page, 'recents', {
                timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
                discoverTeam: true,
            });
            void resolved;
            try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ok */ }
        }
        const result = await inspectRunwayRecents(page, {
            limit: Number(values.limit) || 20,
            type: String(values.type || 'all'),
        });
        emit(deps, values.json ? JSON.stringify(result, null, 2) : formatRunwayRecents(result));
        return;
    }
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
        if (!target?.url) throw new Error(`Runway ${surface} is surface-only; open/preflight supports apps|custom-tools|recents`);
        const page = await deps.getPage();
        /** @type {string[]} */
        const warnings = [];
        const resolved = await navigateRunwaySurface(page, surface, {
            timeoutMs: Number(values.timeout || DEFAULT_WAIT_TIMEOUT_MS),
            discoverTeam: true,
        });
        warnings.push(...resolved.warnings);
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

    // Phase 2+ commands — delegate to specialized modules
    if (command === 'setup' || command === 'generate') {
        const { runRunwayGenerateCli } = await import('./runway-generate.mjs');
        return runRunwayGenerateCli(command, args.slice(1), deps);
    }
    if (command === 'upload') {
        const { runRunwayUploadCli } = await import('./runway-generate.mjs');
        return runRunwayUploadCli(args.slice(1), deps);
    }
    if (command === 'download' || command === 'screenshot') {
        const { runRunwayDownloadCli } = await import('./runway-download.mjs');
        return runRunwayDownloadCli(command, args.slice(1), deps);
    }
    if (command === 'multishot') {
        const { runRunwayMultishotCli } = await import('./runway-multishot.mjs');
        return runRunwayMultishotCli(args.slice(1), deps);
    }
    if (command === 'product-ad') {
        const { runRunwayProductAdCli } = await import('./runway-product-ad.mjs');
        return runRunwayProductAdCli(args.slice(1), deps);
    }
    if (command === 'sequence') {
        const { runRunwaySequenceCli } = await import('./runway-sequence.mjs');
        return runRunwaySequenceCli(args.slice(1), deps);
    }
    throw new Error(`${formatRunwayUsage()}\n\nUnknown runway command: ${command}`);
}

/**
 * @param {any} result
 */
function formatRunwayRecents(result) {
    const lines = [
        'Runway recents',
        `totalVisible: ${result.totalVisible}`,
        `returned: ${result.count}`,
    ];
    for (const asset of result.assets) {
        lines.push(`  [${asset.index}] ${asset.type}: ${asset.label.slice(0, 100)}`);
    }
    if (result.errors?.length) lines.push(`errors: ${result.errors.join('; ')}`);
    return lines.join('\n');
}
