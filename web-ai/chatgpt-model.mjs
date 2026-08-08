// @ts-check
import { WebAiError } from './errors.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */
/** @typedef {'instant'|'thinking'|'pro'} ModelChoice */
/** @typedef {'medium'|'high'|'xhigh'} EffortChoice */
/** @typedef {'chat'|'work'} ChatGptSurface */
/** @typedef {'gpt-5.6-sol'|'gpt-5.5'|'o3'} FamilyChoice */
/** @typedef {{ label: string, retirementWarning?: string }} FamilyOptionConfig */
/** @typedef {{ label: string|null, changed: boolean, verified: boolean }} FamilySelectionEvidence */
/** @typedef {'chat'|'work'|'ambiguous'|'legacy'} ChatGptSurfaceDiscriminator */
/** @typedef {{ testIds: string[], labels: string[] }} ModelOptionConfig */
/** @typedef {{ triggerTestIds: string[], efforts: Readonly<Record<string, string>> }} EffortConfig */
/** @typedef {{ x: number, y: number, width: number, height: number }} BoundingBox */
/** @typedef {'already-selected'|'switched'|'switched-best-effort'|'unavailable'} ModelSelectionEvidenceStatus */
/**
 * @typedef {Object} BrowserModelSelectionEvidence
* @property {string|null} requestedModel
* @property {string|null} resolvedLabel
 * @property {ChatGptSurface|null} [surface]
 * @property {string|null} [familyLabel]
 * @property {string|null} [tierLabel]
* @property {ModelChoice|null} normalizedModel
 * @property {'select'} strategy
 * @property {ModelSelectionEvidenceStatus} status
 * @property {boolean} verified
 * @property {'chatgpt-model-picker'} source
 * @property {string} capturedAt
 */

export const CHATGPT_MODEL_SELECTOR_BUTTONS = [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Model selector"]',
    'button[aria-label*="model selector" i]',
];

const CHATGPT_COMPOSER_MODEL_PILL_SELECTORS = [
    'button[aria-haspopup="menu"]',
    'button.__composer-pill[aria-haspopup="menu"]',
    '[role="button"].__composer-pill[aria-haspopup="menu"]',
    'button.__composer-pill',
    '[role="button"].__composer-pill',
];

const CHATGPT_MODEL_MENU_ITEM_SELECTOR = '[data-testid^="model-switcher-gpt-"]';

// ── Canonical locale labels ─────────────────────────────────────────────────
// FOUR sets, not one: they serve different vocabularies and flattening them
// loses or invents matches.
//  · model rows      — menu rows per model choice (selection + verification)
//  · effort rows     — the thinking sub-menu
//  · observed pills  — pill text, NOT menu rows ("Standard Pro" ≠ "Pro Standard")
//  · selection alias — accepted as user input, never matched as button text
// Every consumer below derives from these; adding a locale must never mean
// editing five call sites.
/** @type {Readonly<Record<string, readonly string[]>>} */
const CHATGPT_MODEL_ROW_LABELS = Object.freeze({
    instant: Object.freeze(['Instant', '즉시', '即时']),
    thinking: Object.freeze(['Thinking', '思考']),
    pro: Object.freeze(['Pro', 'Pro Standard', 'Pro Extended', 'Pro 확장', '프로 확장', 'Pro 扩展']),
});
/** @type {Readonly<Record<string, readonly string[]>>} */
const CHATGPT_EFFORT_LABELS = Object.freeze({
    medium: Object.freeze(['Medium', '중간', '中等']),
    high: Object.freeze(['High', '높음', '高']),
    xhigh: Object.freeze(['Extra High', '매우 높음', '极高']),
});
/** @param {...string} keys @returns {string[]} */
const modelRowLabels = (...keys) => keys.flatMap((key) => [...(CHATGPT_MODEL_ROW_LABELS[key] || [])]);
/** @param {...string} keys @returns {string[]} */
const effortLabels = (...keys) => keys.flatMap((key) => [...(CHATGPT_EFFORT_LABELS[key] || [])]);
const THINKING_EFFORT_LABELS = effortLabels('medium', 'high', 'xhigh');

// ── Consumer projections ────────────────────────────────────────────────────
// Each consumer sees the slice of the canonical sets its OLD literal contained,
// plus that slice's locale variants. Spreading the full row set into every
// consumer would newly admit `Pro Standard`/`Pro Extended` as pill and
// menu-open evidence, which the four-set separation exists to prevent.
// Three consumers historically carried DIFFERENT exact-line vocabularies, and one
// shared projection cannot preserve all three: adding English `Thinking` to the
// pill/menu-open sets changed 446 verdicts in the audit differential. Each list
// below is its old literal PLUS only the locale variants of those same terms.
/** `modelChoiceFromText` — old: Instant/즉시, effort labels, Pro/Pro 확장/프로 확장. */
const CHOICE_FROM_TEXT_LABELS = Object.freeze({
    instant: Object.freeze(['Instant', '즉시', '即时']),
    thinking: Object.freeze([...THINKING_EFFORT_LABELS, '思考']),
    pro: Object.freeze(['Pro', 'Pro 확장', '프로 확장', 'Pro 扩展']),
});
/**
 * `isModelPillText` exact lines — old literal was English-only:
 * Instant / Medium / High / Extra High / Pro. Korean standalone pills were (and
 * remain) recognized by the anchored button pattern instead; promoting them to
 * exact LINES newly accepted multiline text such as "ChatGPT\n즉시", so only the
 * zh additions join the English set here.
 */
const PILL_EXACT_LABELS = Object.freeze([
    'Instant', 'Medium', 'High', 'Extra High', 'Pro',
    '即时', '中等', '高', '极高', '思考', 'Pro 扩展',
]);
/** `isSimplifiedIntelligenceMenuOpen` — old: en set plus the ko effort words. */
const MENU_OPEN_LABELS = Object.freeze([
    'Instant', '즉시', '即时',
    ...THINKING_EFFORT_LABELS,
    '思考',
    'Pro', 'Pro 扩展',
]);
/** @param {string} key @returns {string[]} */
const choiceFromTextLabels = (key) =>
    [...(/** @type {Record<string, readonly string[]>} */ (CHOICE_FROM_TEXT_LABELS)[key] || [])];

/**
 * Default label set required by `isSimplifiedIntelligenceMenuOpen`. Shared with
 * the test adapter so a production-only change cannot pass while the adapter
 * keeps returning the old list.
 * @returns {string[]}
 */
function simplifiedMenuOpenLabels() {
    return [...MENU_OPEN_LABELS];
}

/**
 * Per-choice matcher sources for the browser-context `matchesModelText`.
 * The SHAPE is preserved from the original literals: ASCII terms keep `\b`
 * boundaries (so "Fastball" and "Prologue" still miss), while CJK terms use
 * Han-script boundaries because `\b` is meaningless for them — that lets
 * "GPT-5.5即时" match while "超高" and a bare "高" inside "极高" do not.
 * Passed as an evaluate ARGUMENT, never closed over.
 */
export const CHATGPT_MODEL_TEXT_PATTERNS = Object.freeze({
    instant: '\\b(Instant|Fast)\\b|즉시|(?<!\\p{Script=Han})即时(?!\\p{Script=Han})',
    thinking: '\\b(Thinking|Think)\\b|중간|높음|매우 높음|(?<!\\p{Script=Han})(思考|中等|极高|高)(?!\\p{Script=Han})',
    pro: '\\b(Pro|Heavy)\\b|Pro 확장|프로 확장|(?<!\\p{Script=Han})Pro 扩展(?!\\p{Script=Han})',
});

/**
 * Read-only view of the locale-derived predicates, for equivalence testing.
 * The underlying functions stay private; this exposes only their verdicts so a
 * refactor of the canonical tables can be diffed against the old literals.
 */
export const __localeConsumersForTest = Object.freeze({
    /** @param {string} text */
    buttonText: (text) => CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text),
    /** @param {string} text @param {string} choice */
    modelText: (text, choice) => {
        const source = /** @type {Record<string, string>} */ (CHATGPT_MODEL_TEXT_PATTERNS)[choice];
        return source ? new RegExp(source, 'iu').test(text) : false;
    },
    /** @param {string} text */
    choiceFromText: (text) => modelChoiceFromText(text),
    /** @param {string} text */
    pillText: (text) => isModelPillText(text),
    /** @param {any} choice @param {string} text */
    legacyLabel: (choice, text) => legacyModelLabelPattern(choice).test(text),
    // Delegates to the SAME helper production uses, so a production-only edit
    // cannot pass while the adapter keeps returning the old list.
    /** @returns {string[]} */
    menuOpenLabels: () => simplifiedMenuOpenLabels(),
    /**
     * Drives the REAL production evaluate wrapper so a missing `localePatterns`
     * payload key fails behaviourally, not just structurally.
     * @param {any} page @param {any} model
     */
    effortTriggerBox: (page, model) => findEffortTriggerBoxNearModelRow(page, model),
});

export const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = new RegExp(
    `^(?:ChatGPT|Instant(?:\\s+5\\.5)?|GPT[-\\s]?\\d(?:\\.\\d+)?(?:\\s+(?:Instant|Fast|Thinking|Pro)(?:\\s+(?:Light|Standard|Extended|Heavy))?)?|`
    // Button TEXT vocabulary, which is narrower than the menu-row vocabulary:
    // `Pro Standard`/`Pro Extended` are menu rows and `Thinking` is a row label,
    // none of which ever appear as standalone button text. Only the effort
    // labels, the plain choice names, the observed pills and the locale variants
    // belong here.
    + [...new Set([
        ...THINKING_EFFORT_LABELS,
        'Instant', '즉시', '即时',
        'Pro', 'Pro 확장', '프로 확장', 'Pro 扩展',
        'Standard Pro', 'Extended Pro',
    ])].map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    + ')$', 'i');

export const CHATGPT_OBSERVED_PRO_PILL_LABELS = ['Pro', 'Standard Pro', 'Extended Pro'];
const CHATGPT_EFFORT_TRIGGER_SELECTORS = [
    '[data-testid="composer-intelligence-pro-thinking-effort-trigger"]',
    '[data-testid*="thinking-effort"]',
    '[data-testid*="reasoning-effort"]',
    '[data-testid*="effort"]',
    '[aria-label*="Effort" i]',
    '[aria-label*="Reasoning" i]',
    '[role="menuitem"][aria-label*="Effort" i]',
    '[role="menuitem"][aria-label*="Reasoning" i]',
];

/** @type {Readonly<Record<ModelChoice, ModelOptionConfig>>} */
export const CHATGPT_MODEL_OPTIONS = {
    instant: {
        testIds: ['model-switcher-gpt-5-5', 'model-switcher-gpt-5-3'],
        labels: modelRowLabels('instant'),
    },
    thinking: {
        testIds: ['model-switcher-gpt-5-5-thinking', 'model-switcher-gpt-5-5-thinking-thinking-effort'],
        labels: [...THINKING_EFFORT_LABELS, ...modelRowLabels('thinking')],
    },
    pro: {
        testIds: ['model-switcher-gpt-5-5-pro', 'model-switcher-gpt-5-5-pro-thinking-effort'],
        labels: [...modelRowLabels('pro'), 'Heavy'],
    },
};

/** @type {Readonly<Record<string, EffortConfig>>} */
export const CHATGPT_MODEL_EFFORT_OPTIONS = {
    thinking: {
        triggerTestIds: ['model-switcher-gpt-5-5-thinking-thinking-effort'],
        efforts: {
            medium: 'Medium',
            high: 'High',
            xhigh: 'Extra High',
        },
    },
    pro: {
        triggerTestIds: ['model-switcher-gpt-5-5-pro-thinking-effort'],
        efforts: {},
    },
};

/** @type {Readonly<Record<ModelChoice, { defaultLabels: readonly string[], efforts: Readonly<Record<string, readonly string[]>> }>>} */
const CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS = {
    instant: { defaultLabels: modelRowLabels('instant'), efforts: {} },
    thinking: {
        defaultLabels: effortLabels('medium'),
        efforts: {
            medium: effortLabels('medium'),
            high: effortLabels('high'),
            xhigh: effortLabels('xhigh'),
        },
    },
    pro: {
        defaultLabels: ['Pro'],
        efforts: {},
    },
};

/** @type {Readonly<Record<FamilyChoice, FamilyOptionConfig>>} */
export const CHATGPT_FAMILY_OPTIONS = Object.freeze({
    'gpt-5.6-sol': { label: 'GPT-5.6 Sol' },
    'gpt-5.5': { label: 'GPT-5.5' },
    o3: { label: 'o3' },
});

/** @type {Readonly<Record<string, FamilyChoice>>} */
const FAMILY_ALIASES = Object.freeze({
    'gpt-5.6-sol': 'gpt-5.6-sol',
    'gpt-5.5': 'gpt-5.5',
    o3: 'o3',
});

/** @type {Readonly<Record<string, ModelChoice>>} */
const MODEL_ALIASES = {
    instant: 'instant',
    fast: 'instant',
    'gpt-5-3': 'instant',
    'gpt-5.3': 'instant',
    thinking: 'thinking',
    think: 'thinking',
    'gpt-5-5-thinking': 'thinking',
    'gpt-5.5-thinking': 'thinking',
    pro: 'pro',
    'gpt-5-5-pro': 'pro',
    'gpt-5.5-pro': 'pro',
};

/** @type {Readonly<Record<string, EffortChoice>>} */
const EFFORT_ALIASES = {
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    'extra-high': 'xhigh',
    extra_high: 'xhigh',
    'extra high': 'xhigh',
    light: 'medium',
    low: 'medium',
    standard: 'medium',
    normal: 'medium',
    regular: 'medium',
    default: 'medium',
    extended: 'high',
    heavy: 'xhigh',
};

/** @type {ReadonlySet<string>} */
const PRO_UNENFORCED_LEGACY_EFFORTS = new Set([
    'standard', 'normal', 'regular', 'default', 'extended',
]);

export const CHATGPT_SURFACE_RADIO_SELECTOR = 'button[role="radio"]';
export const CHATGPT_CHAT_PICKER_TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]';
const CHATGPT_POWER_PICKER_ROOT_SELECTOR =
    '[role="menu"][data-state="open"]:has([role="menuitem"][aria-label="Power"])';
export const CHATGPT_OPEN_PICKER_CONTENT_SELECTOR = [
    '[role="menu"][data-state="open"] [data-testid="composer-intelligence-picker-content"]',
    CHATGPT_POWER_PICKER_ROOT_SELECTOR,
].join(', ');
export const CHATGPT_WORK_PICKER_MARKER_SELECTOR = [
    '[data-testid="composer-model-picker-slider-simple-view"]',
    '[data-testid="composer-model-picker-slider-advanced-view"]',
].join(', ');

/**
 * @param {unknown} model
 * @returns {ModelChoice | null}
 */
export function normalizeChatGptModelChoice(model) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    return MODEL_ALIASES[key] || null;
}

/**
 * @param {unknown} effort
 * @returns {EffortChoice | null}
 */
export function normalizeChatGptEffortChoice(effort) {
    const key = String(effort || '').trim().toLowerCase();
    if (!key) return null;
    return EFFORT_ALIASES[key] || null;
}

/**
 * @param {unknown} family
 * @returns {FamilyChoice|null}
 */
export function normalizeChatGptFamilyChoice(family) {
    const key = String(family || '').trim().toLowerCase();
    return key ? FAMILY_ALIASES[key] || null : null;
}

/**
 * @param {unknown} model
 * @param {unknown} effort
 * @returns {boolean}
 */
export function isChatGptEffortSupported(model, effort) {
    const requestedModel = normalizeChatGptModelChoice(model) || /** @type {string} */ (model);
    const effortKey = String(effort || '').trim().toLowerCase();
    const requestedEffort = normalizeChatGptEffortChoice(effort);
    if (requestedModel === 'thinking') return Boolean(requestedEffort);
    if (requestedModel === 'pro') return PRO_UNENFORCED_LEGACY_EFFORTS.has(effortKey);
    return false;
}

/**
 * @typedef {Object} SelectModelOptions
 * @property {string} [effort]
 * @property {string} [reasoningEffort]
 * @property {'chat'} [surface]
 * @property {string} [family]
 */

/**
 * @typedef {Object} SelectModelResult
 * @property {ModelChoice | string | null} requested
 * @property {ModelChoice | null} selected
 * @property {boolean} alreadySelected
 * @property {string | null} effort
 * @property {EffortChoice | null} requestedEffort
 * @property {string[]} usedFallbacks
 * @property {string[]} warnings
 * @property {BrowserModelSelectionEvidence} modelSelection
 */

/**
 * @param {Page} page
 * @param {unknown} model
 * @param {SelectModelOptions} [options]
 * @returns {Promise<SelectModelResult | null>}
 */
const MODEL_PILL_SETTLE_MS = 8_000;
const MODEL_SELECT_MAX_ATTEMPTS = 3;

/**
 * Wait for the ChatGPT model pill to mount before reading it. ChatGPT renders
 * the picker pill 1-4s after the page is interactive (later on a cold profile),
 * so a single read can miss it. Re-reads until evidence has a resolved choice
 * or the deadline elapses; never throws. (Mirrors Oracle #271 / 0.15.1.)
 * @param {any} page
 * @param {string|null} requested
 * @param {number} [deadlineMs]
 * @returns {Promise<any>}
 */
async function waitForModelPillEvidence(page, requested, deadlineMs = MODEL_PILL_SETTLE_MS) {
    const deadline = Date.now() + deadlineMs;
    let evidence = await readCheckedModelEvidence(page, requested);
    let attempts = 0;
    while (!evidence?.choice && Date.now() < deadline && attempts < 12) {
        attempts += 1;
        await page.waitForTimeout(400).catch(() => undefined);
        evidence = await readCheckedModelEvidence(page, requested);
    }
    return evidence;
}

export async function selectChatGptModel(page, model, options = {}) {
    const requestedFamily = normalizeChatGptFamilyChoice(options.family);
    if (options.family && !requestedFamily) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT family: ${options.family}`, evidence: { family: options.family } });
    }
    const requested = normalizeChatGptModelChoice(model);
    const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
    if (!requested) {
        if (model) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT model selection: ${model}`, evidence: { model } });
        if (!requestedEffort && !requestedFamily) return null;
    }
    if ((options.effort || options.reasoningEffort) && !requestedEffort) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT reasoning effort: ${options.effort || options.reasoningEffort}`, evidence: { effort: options.effort || options.reasoningEffort } });
    }
    // Surface guard runs after the zero-request early return: an unspecified
    // selection must stay zero-touch (respect current UI), while any real
    // model/effort/family request on Work/ambiguous hard-errors pre-mutation.
    await assertChatSurfaceForModelMutation(page);
    /** @type {string[]} */
    const usedFallbacks = [];
    /** @type {string[]} */
    const warnings = [];
    try {
        await openModelMenu(page, usedFallbacks);
    } catch (err) {
        if (!isSelectionUnavailable(err)) throw err;
        const warning = buildModelSelectionWarning(requested, requestedEffort, err);
        return {
            requested: requested || null,
            selected: null,
            alreadySelected: true,
            effort: null,
            requestedEffort: requestedEffort || null,
            usedFallbacks: [...usedFallbacks, 'model-selector-unavailable-current-model'],
            warnings: [warning],
           modelSelection: createModelSelectionEvidence({
               requestedModel: requested || String(model || '') || null,
               resolvedLabel: null,
                surface: 'chat',
                familyLabel: null,
                tierLabel: null,
               normalizedModel: null,
               status: 'unavailable',
               verified: false,
            }),
        };
    }
    /** @type {FamilySelectionEvidence | null} */
    let familyEvidence = null;
    if (requestedFamily) {
        try {
            familyEvidence = await selectChatGptFamily(page, requestedFamily);
            await openModelMenu(page, usedFallbacks);
        } catch (err) {
            if (!isSelectionUnavailable(err)) throw err;
            warnings.push(`family ${requestedFamily} was not enforced: ${errorMessage(err)}`);
        }
    } else {
        familyEvidence = await readVisibleChatGptFamilyEvidence(page);
    }
    let currentEvidence = await waitForModelPillEvidence(page, requested || null);
    let currentModel = currentEvidence?.choice || null;
    const targetModel = requested || currentModel;
    let modelChanged = false;
    if (!targetModel) {
        await closeModelMenu(page);
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: 'ChatGPT model must be selected before setting reasoning effort', evidence: { effort: requestedEffort } });
    }
    if (requested && currentModel !== requested) {
        // Bounded retry: ChatGPT occasionally drops the first option click (menu
        // re-render race), leaving the model unchanged. Re-click and re-verify up
        // to MODEL_SELECT_MAX_ATTEMPTS; a genuinely missing option still fails fast.
        let attempt = 0;
        while (currentModel !== requested && attempt < MODEL_SELECT_MAX_ATTEMPTS) {
            attempt += 1;
            const option = await findModelOption(page, requested);
            if (!option) {
                if (await isChatGptPowerPickerOpen(page)
                    && await selectChatGptPowerTierBySlider(page, requested, {
                        effort: requestedEffort || null,
                        usedFallbacks,
                    })) {
                    await page.waitForTimeout(400).catch(() => undefined);
                    currentEvidence = await readCheckedModelEvidence(page, requested);
                    currentModel = currentEvidence?.choice || null;
                    modelChanged = true;
                    continue;
                }
                throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT model option not found: ${requested}`, evidence: { requested } });
            }
            await option.click({ timeout: 5_000 });
            await page.waitForTimeout(750).catch(() => undefined);
            await openModelMenu(page, usedFallbacks);
            currentEvidence = await readCheckedModelEvidence(page, requested);
            currentModel = currentEvidence?.choice || null;
            modelChanged = true;
        }
        // Explicit model requested but unverified after retries — surface it.
        // Effort selection (below) still fails closed on mismatch.
        if (currentModel !== requested && !warnings.includes('model-selection-unverified')) {
            warnings.push('model-selection-unverified');
        }
    }
    /** @type {{ requested: string, selected: string|null, changed: boolean } | null} */
    let selectedEffort = null;
    if (requestedEffort) {
        // Pro has no effort control in 5.6 flat radio UI. Legacy Pro efforts
        // (standard/normal/regular/default/extended) resolve to effort=null + warning.
        const rawEffort = String(options.effort || options.reasoningEffort || '').trim().toLowerCase();
        if (targetModel === 'pro' && Object.keys(CHATGPT_MODEL_EFFORT_OPTIONS.pro?.efforts || {}).length === 0) {
            if (requested === 'pro' && PRO_UNENFORCED_LEGACY_EFFORTS.has(rawEffort)) {
                selectedEffort = { requested: requestedEffort, selected: null, changed: false };
                warnings.push(`reasoning-effort-unenforced: Pro has no effort control; selected Pro for legacy effort ${rawEffort}`);
            } else {
                throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort ${requestedEffort} is not supported for Pro`, evidence: { model: 'pro', effort: requestedEffort } });
            }
        } else {
        const simplifiedSelected = currentEvidence?.label
            ? effortChoiceFromSimplifiedText(currentEvidence.label, /** @type {string} */ (targetModel), requestedEffort)
            : null;
        // Power slider stops encode thinking effort (Medium/High/Extra High) in the
        // visible tier label. If the shell already reports that stop, treat the
        // effort as selected without requiring a detached Effort portal.
        const powerSliderEffortLabel = String(currentEvidence?.label || '')
            .split(/\r?\n/)[0]
            .replace(/,\s*\d+\s+of\s+\d+\.?$/i, '')
            .trim();
        const powerSliderEffort = targetModel === 'thinking'
            ? (
                effortChoiceFromSimplifiedText(powerSliderEffortLabel, 'thinking', requestedEffort)
                || effortChoiceFromSimplifiedText(currentEvidence?.label || '', 'thinking', requestedEffort)
            )
            : null;
        if (simplifiedSelected === requestedEffort || powerSliderEffort === requestedEffort) {
            selectedEffort = {
                requested: requestedEffort,
                selected: requestedEffort,
                changed: modelChanged || powerSliderEffort === requestedEffort,
            };
            usedFallbacks.push(simplifiedSelected === requestedEffort
                ? `${targetModel}-effort-simplified-direct`
                : `${targetModel}-effort-power-slider`);
        } else {
            try {
                selectedEffort = await selectChatGptEffort(page, /** @type {string} */ (targetModel), requestedEffort, usedFallbacks);
                await openModelMenu(page, usedFallbacks);
            } catch (err) {
                if (!isSelectionUnavailable(err)) throw err;
                usedFallbacks.push('reasoning-effort-unavailable-current-effort');
                warnings.push(`reasoning effort ${requestedEffort} was not enforced: ${errorMessage(err)}`);
                await closeModelMenu(page);
            }
        }
        }
    }
    const afterEvidence = await readCheckedModelEvidence(page, targetModel);
    const after = afterEvidence?.choice || null;
    let finalFamilyEvidence = familyEvidence;
    if (requestedFamily) {
        await openSimplifiedIntelligenceSubmenu(page, { forceFamily: true });
        finalFamilyEvidence = await readVisibleChatGptFamilyEvidence(page);
    }
    await closeModelMenu(page);
    const proConflict = requestedFamily === 'gpt-5.6-sol'
        ? await readActiveProComposerPill(page)
        : null;
    const expectedFamilyLabel = requestedFamily ? CHATGPT_FAMILY_OPTIONS[requestedFamily].label : null;
    if (requestedFamily && (!finalFamilyEvidence?.verified || finalFamilyEvidence.label !== expectedFamilyLabel)) {
        throw familyMismatch(requestedFamily, expectedFamilyLabel);
    }
    if (proConflict) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: 'chatgpt',
            retryHint: 'model-fallback',
            message: `ChatGPT family verification failed: requested ${requestedFamily}; active composer state is ${proConflict}`,
            evidence: { requestedFamily, expectedFamilyLabel, activeComposerLabel: proConflict },
        });
    }
    if (after !== targetModel) {
        usedFallbacks.push('model-verification-unavailable-current-model');
        warnings.push(`model ${targetModel} was not verified; current detected model is ${after || 'unknown'}`);
    }
    const verified = after === targetModel && (!requestedFamily || finalFamilyEvidence?.verified === true);
    return {
        requested: requested || targetModel,
        selected: after,
        alreadySelected: !modelChanged && !selectedEffort?.changed,
        effort: selectedEffort?.selected || null,
        requestedEffort: requestedEffort || null,
        usedFallbacks,
        warnings,
       modelSelection: createModelSelectionEvidence({
           requestedModel: requested || targetModel || null,
           resolvedLabel: afterEvidence?.label || after || null,
            surface: 'chat',
            familyLabel: finalFamilyEvidence?.label || null,
            tierLabel: afterEvidence?.label || after || null,
            normalizedModel: after,
            status: verified ? (modelChanged ? 'switched' : 'already-selected') : (modelChanged ? 'switched-best-effort' : 'unavailable'),
            verified,
        }),
    };
}

/**
 * @param {{
 *   requestedModel: string|null,
 *   resolvedLabel: string|null,
 *   surface: ChatGptSurface|null,
 *   familyLabel: string|null,
 *   tierLabel: string|null,
 *   normalizedModel: ModelChoice|null,
 *   status: ModelSelectionEvidenceStatus,
 *   verified: boolean,
 * }} input
 * @returns {BrowserModelSelectionEvidence}
 */
function createModelSelectionEvidence(input) {
    return {
        requestedModel: input.requestedModel,
        resolvedLabel: input.resolvedLabel,
        surface: input.surface,
        familyLabel: input.familyLabel,
        tierLabel: input.tierLabel,
        normalizedModel: input.normalizedModel,
        strategy: 'select',
        status: input.status,
        verified: input.verified,
        source: 'chatgpt-model-picker',
        capturedAt: new Date().toISOString(),
    };
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isSelectionUnavailable(err) {
    const error = /** @type {Partial<WebAiError>} */ (err);
    return error instanceof WebAiError
        && error.errorCode === 'provider.model-mismatch'
        && error.stage === 'provider-select-mode';
}

/**
 * @param {ModelChoice | null} requested
 * @param {EffortChoice | null} requestedEffort
 * @param {unknown} err
 * @returns {string}
 */
function buildModelSelectionWarning(requested, requestedEffort, err) {
    const modelText = requested
        ? `requested ${requested} was not enforced`
        : 'model selector unavailable';
    const effortText = requestedEffort
        ? `; requested effort ${requestedEffort} was not enforced`
        : '';
    return `${modelText}${effortText}, continuing with current ChatGPT model: ${errorMessage(err)}`;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
    return /** @type {{ message?: string }} */ (err)?.message || String(err);
}

/** @param {Page} page */
async function closeModelMenu(page) {
    for (let i = 0; i < 3; i += 1) {
        if (!(await isModelMenuOpen(page))) return;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
}

/**
 * Create a typed WebAiError for Chat-path commands encountering an active
 * Work surface or ambiguous state (04 contract: capability.unsupported,
 * provider-surface-preflight, retryHint switch-to-chat).
 *
 * @param {{ surface?: string, evidence?: unknown }} [context]
 * @returns {WebAiError}
 */
export function workSurfaceUnsupportedError(context = {}) {
    return new WebAiError({
        errorCode: 'capability.unsupported',
        stage: 'provider-surface-preflight',
        retryHint: 'switch-to-chat',
        vendor: 'chatgpt',
        message: 'Chat commands are not supported on the Work surface (detected: ' + (context.surface || 'unknown') + '). Switch to Chat or use web-ai work send / web_ai_work_send.',
        evidence: context.evidence,
    });
}

/**
 * Surface guard shared by Chat model-mutation entry points: active Work or
 * ambiguous surfaces hard-error with zero selector clicks. Dynamic import
 * avoids a static circular dependency with product-surfaces.mjs.
 * @param {Page} page
 */
async function assertChatSurfaceForModelMutation(page) {
    const { detectChatGptComposerSurface } = await import('./product-surfaces.mjs');
    const surfaceDetection = await detectChatGptComposerSurface(page);
    const conversation = surfaceDetection.evidence?.conversation;
    // Fail closed only when the URL says we ARE on a conversation but its mode
    // could not be established: mutating the model of an unclassifiable session
    // risks corrupting a Work conversation. Every unresolved reason that carries
    // a conversationId was reached AFTER a positive URL match, so ordinary
    // pages (and page doubles without a conversation URL) are never blocked.
    const conversationUnresolved = conversation?.state === 'unresolved'
        && Boolean(conversation.evidence?.conversationId);
    if (surfaceDetection.surface === 'work'
        || surfaceDetection.surface === 'ambiguous'
        || conversationUnresolved) {
        throw workSurfaceUnsupportedError({
            surface: surfaceDetection.surface || 'conversation-unresolved',
            evidence: surfaceDetection,
        });
    }
}

/**
 * Defense-in-depth: an open menu showing Work picker markers means the Work
 * picker mounted where the Chat picker was expected.
 * @param {Page} page
 */
async function assertOpenMenuIsNotWorkPicker(page) {
    // Current Chat Power reuses the old Work slider testids inside its own
    // open shell. Those markers alone are no longer Work-proof when the open
    // menu is the Chat Power shell or the Chat surface radio is active.
    if (await isChatGptPowerPickerOpen(page)) return;
    const chatRadio = page.locator(CHATGPT_SURFACE_RADIO_SELECTOR).filter({ hasText: /^Chat$/i }).first();
    if (typeof chatRadio?.getAttribute === 'function') {
        const chatChecked = await chatRadio.getAttribute('aria-checked').catch(() => null);
        const chatState = await chatRadio.getAttribute('data-state').catch(() => null);
        if (chatChecked === 'true' || chatState === 'on') return;
    }
    const workMarker = page.locator(CHATGPT_WORK_PICKER_MARKER_SELECTOR).first();
    if (await workMarker.isVisible().catch(() => false)) {
        throw workSurfaceUnsupportedError({
            surface: 'work',
            evidence: { workMarkerVisible: true },
        });
    }
}

/**
 * @param {Page} page
 * @param {string[]} usedFallbacks
 */
async function openModelMenu(page, usedFallbacks) {
    await assertChatSurfaceForModelMutation(page);
    if (await isModelMenuOpen(page)) {
        await assertOpenMenuIsNotWorkPicker(page);
        return;
    }
    const deadline = Date.now() + 8_000;
    let openAttempts = 0;
    while (Date.now() < deadline && openAttempts < 12) {
        openAttempts += 1;
        for (const selector of CHATGPT_MODEL_SELECTOR_BUTTONS) {
            const loc = page.locator(selector).first();
            if (!(await loc.isVisible().catch(() => false))) continue;
            await loc.click({ timeout: 5_000 });
            await page.waitForTimeout(400).catch(() => undefined);
            if (await isModelMenuOpen(page)) {
                await assertOpenMenuIsNotWorkPicker(page);
                return;
            }
        }
        const composerPill = await findComposerModelPill(page);
        if (composerPill) {
            usedFallbacks.push('composer-model-pill');
            await composerPill.click({ timeout: 5_000 });
            await page.waitForTimeout(400).catch(() => undefined);
            if (await isModelMenuOpen(page)) {
                await assertOpenMenuIsNotWorkPicker(page);
                return;
            }
        }
        await page.waitForTimeout(250).catch(() => undefined);
    }
    usedFallbacks.push('model-menu-text-button');
    const textButton = await findModelTextButton(page);
    if (textButton && await textButton.isVisible().catch(() => false)) {
        await textButton.click({ timeout: 5_000 });
        await page.waitForTimeout(400).catch(() => undefined);
        if (await isModelMenuOpen(page)) {
            await assertOpenMenuIsNotWorkPicker(page);
            return;
        }
    }
    throw new WebAiError({
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        vendor: 'chatgpt',
        retryHint: 'model-fallback',
        message: `ChatGPT model selector not found. Tried: ${[...CHATGPT_MODEL_SELECTOR_BUTTONS, ...CHATGPT_COMPOSER_MODEL_PILL_SELECTORS].join(', ')}`,
        selectorsTried: [...CHATGPT_MODEL_SELECTOR_BUTTONS, ...CHATGPT_COMPOSER_MODEL_PILL_SELECTORS],
    });
}

/**
 * @param {Page} page
 * @returns {Promise<Locator | null>}
 */
async function findComposerModelPill(page) {
    /** @type {Locator | null} */
    let standaloneEffort = null;
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = await loc.innerText({ timeout: 1_000 }).catch(() => '');
            const trimmed = text.trim();
            if (!isModelPillText(trimmed)) continue;
            if (isStandaloneEffortLabel(trimmed)) {
                if (!standaloneEffort) standaloneEffort = loc;
                continue;
            }
            return loc;
        }
    }
    return standaloneEffort || findModelTextButton(page);
}

/**
 * @param {Page} page
 * @returns {Promise<Locator | null>}
 */
async function findModelTextButton(page) {
    /** @type {Locator | null} */
    let standaloneEffort = null;
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (!isModelPillText(text)) continue;
        if (isStandaloneEffortLabel(text)) {
            if (!standaloneEffort) standaloneEffort = loc;
            continue;
        }
        return loc;
    }
    return standaloneEffort;
}

/**
 * Get the current Chat composer Intelligence picker content root.
 * @param {Page} page
 * @returns {Locator}
 */
function chatGptComposerMenuRoot(page) {
    return page.locator(CHATGPT_OPEN_PICKER_CONTENT_SELECTOR).last();
}

/**
 * The current Chat picker is a Power shell whose Model and Effort rows open
 * sibling portal menus. Keep this predicate root-owned so a Work menu or an
 * unrelated page menu cannot satisfy the Chat mutation contract.
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
async function isChatGptPowerPickerOpen(page) {
    const root = page.locator(CHATGPT_POWER_PICKER_ROOT_SELECTOR).last();
    if (!(await root.isVisible().catch(() => false))) return false;
    const power = root.locator('[role="menuitem"][aria-label="Power"]').first();
    if (!(await power.isVisible().catch(() => false))) return false;
    const triggers = await root.locator('[role="menuitem"][data-has-submenu]').all()
        .catch(() => /** @type {Locator[]} */ ([]));
    let hasModel = false;
    let hasEffort = false;
    for (const trigger of triggers) {
        if (!(await trigger.isVisible().catch(() => false))) continue;
        const text = (await trigger.innerText({ timeout: 500 }).catch(() => '')).trim();
        hasModel ||= menuTextHasExactLine(text, 'Model');
        hasEffort ||= menuTextHasExactLine(text, 'Effort');
    }
    return hasModel && hasEffort;
}

/**
 * Find a current Power-shell submenu trigger by its exact first line.
 * @param {Page} page
 * @param {'Model'|'Effort'} heading
 * @returns {Promise<Locator|null>}
 */
async function findPowerPickerSubmenuTrigger(page, heading) {
    if (!(await isChatGptPowerPickerOpen(page))) return null;
    const root = page.locator(CHATGPT_POWER_PICKER_ROOT_SELECTOR).last();
    const triggers = await root.locator('[role="menuitem"][data-has-submenu]').all()
        .catch(() => /** @type {Locator[]} */ ([]));
    for (const trigger of triggers) {
        if (!(await trigger.isVisible().catch(() => false))) continue;
        const text = (await trigger.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (menuTextHasExactLine(text, heading)) return trigger;
    }
    return null;
}

/**
 * @param {Page} page
 * @param {'Model'|'Effort'} heading
 * @returns {Promise<boolean>}
 */
async function openPowerPickerSubmenu(page, heading) {
    const trigger = await findPowerPickerSubmenuTrigger(page, heading);
    if (!trigger) return false;
    await trigger.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(300).catch(() => undefined);
    return true;
}

/**
 * Legacy fallback: find an open menu root that is controlled by the composer
 * form's trigger via `aria-controls`. Only used when the current Intelligence
 * picker content root is not visible (no-toggle legacy surface).
 * @param {Page} page
 * @returns {Promise<Locator | null>}
 */
async function chatGptLegacyMenuRootOpenedByComposer(page) {
    // Look for legacy testid-bearing menu rows in the page's open menus.
    const openMenus = await page.locator('[role="menu"]').all()
        .catch(() => /** @type {Locator[]} */ ([]));
    for (const menu of openMenus) {
        if (!(await menu.isVisible().catch(() => false))) continue;
        const hasModelRow = await menu.locator(CHATGPT_MODEL_MENU_ITEM_SELECTOR).count()
            .catch(() => 0);
        if (hasModelRow > 0) return menu;
    }
    return null;
}

/**
 * @param {Page} page
 * @param {ModelChoice} choice
 * @returns {Promise<Locator | null>}
 */

/**
 * Current Chat Power shell exposes Instant/Medium/High/Extra High/Pro on a
 * five-stop slider (aria-valuenow 0..4) rather than only as a detached radio
 * portal. Prefer the portal when present; otherwise drive the Power control.
 * @type {Readonly<Record<ModelChoice, number>>}
 */
const CHATGPT_POWER_TIER_INDEX = Object.freeze({
    instant: 0,
    thinking: 2,
    pro: 4,
});

/**
 * @param {string} text
 * @returns {ModelChoice|null}
 */
function modelChoiceFromPowerSimpleText(text) {
    const first = String(text || '').split(/\r?\n/)[0] || '';
    // "High, 3 of 5." / "Pro, 5 of 5."
    const label = first.replace(/,\s*\d+\s+of\s+\d+\.?$/i, '').trim();
    return modelChoiceFromPowerTierText(label) || modelChoiceFromText(label);
}

/**
 * @param {Page} page
 * @returns {Promise<{index:number|null, choice:ModelChoice|null, label:string|null}>}
 */
async function readChatGptPowerSliderState(page) {
    const simple = page.locator('[data-testid="composer-model-picker-slider-simple-view"]').first();
    const simpleText = typeof simple?.innerText === 'function'
        ? (await simple.innerText({ timeout: 500 }).catch(() => '')).trim()
        : '';
    const choiceFromSimple = modelChoiceFromPowerSimpleText(simpleText);
    const slider = page.locator(
        '[data-testid="composer-model-picker-slider-simple-view"] [role="slider"], [role="menu"][data-state="open"] [role="slider"]',
    ).first();
    const nowStr = typeof slider?.getAttribute === 'function'
        ? await slider.getAttribute('aria-valuenow').catch(() => null)
        : null;
    const index = nowStr != null && nowStr !== '' ? Number(nowStr) : null;
    if (choiceFromSimple) return { index: Number.isFinite(index) ? index : null, choice: choiceFromSimple, label: simpleText || choiceFromSimple };
    if (Number.isFinite(index)) {
        /** @type {ModelChoice[]} */
        const byIndex = ['instant', 'thinking', 'thinking', 'thinking', 'pro'];
        // 0 Instant, 1 Medium, 2 High, 3 Extra High, 4 Pro. Medium/High/xhigh all map to thinking.
        const mapped = byIndex[/** @type {number} */ (index)] || null;
        return { index: /** @type {number} */ (index), choice: mapped, label: simpleText || mapped };
    }
    const effortTrigger = await findPowerPickerSubmenuTrigger(page, 'Effort');
    if (effortTrigger) {
        const text = (await effortTrigger.innerText({ timeout: 500 }).catch(() => '')).trim();
        const choice = modelChoiceFromPowerTierText(text);
        if (choice) return { index: null, choice, label: text };
    }
    return { index: null, choice: null, label: simpleText || null };
}

/**
 * Resolve the public model choice to the nearest Power slider index.
 * thinking without an effort lands on High (index 2), the stable middle thinking tier.
 * @param {ModelChoice} choice
 * @param {EffortChoice|null} [effort]
 * @returns {number}
 */
function powerTierIndexForChoice(choice, effort = null) {
    if (choice === 'instant') return 0;
    if (choice === 'pro') return 4;
    if (effort === 'medium') return 1;
    if (effort === 'xhigh') return 3;
    if (effort === 'high') return 2;
    return 2;
}

/**
 * Drive the current Chat Power slider with keyboard arrows. Returns true when
 * the shell reports the requested model choice.
 * @param {Page} page
 * @param {ModelChoice} choice
 * @param {{effort?: EffortChoice|null, usedFallbacks?: string[]}} [options]
 * @returns {Promise<boolean>}
 */
async function selectChatGptPowerTierBySlider(page, choice, options = {}) {
    if (!(await isChatGptPowerPickerOpen(page))) return false;
    const effort = options.effort || null;
    const usedFallbacks = options.usedFallbacks || [];
    const targetIndex = powerTierIndexForChoice(choice, effort);
    const power = page.locator('[role="menuitem"][aria-label="Power"]').first();
    if (!(await power.isVisible().catch(() => false))) return false;
    await power.focus({ timeout: 1_000 }).catch(() => undefined);
    await power.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(150).catch(() => undefined);
    let stagnant = 0;
    let previousIndex = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const state = await readChatGptPowerSliderState(page);
        if (state.choice === choice) {
            // For thinking, also honor the requested effort stop when known.
            if (choice !== 'thinking' || effort == null || state.index == null || state.index === targetIndex) {
                usedFallbacks.push('chat-power-slider');
                return true;
            }
        }
        const currentIndex = state.index != null ? state.index : (
            state.choice === 'instant' ? 0
                : state.choice === 'pro' ? 4
                    : 2
        );
        if (currentIndex === targetIndex && state.choice === choice) {
            usedFallbacks.push('chat-power-slider');
            return true;
        }
        if (previousIndex != null && previousIndex === currentIndex) stagnant += 1;
        else stagnant = 0;
        previousIndex = currentIndex;
        if (stagnant >= 2) break;
        const key = currentIndex > targetIndex ? 'ArrowLeft' : 'ArrowRight';
        await page.keyboard.press(key).catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
    const finalState = await readChatGptPowerSliderState(page);
    if (finalState.choice === choice) {
        usedFallbacks.push('chat-power-slider');
        return true;
    }
    return false;
}

async function findModelOption(page, choice) {
    const option = CHATGPT_MODEL_OPTIONS[choice];
    // Current Power shell: prefer the Effort portal radios, then the Power slider.
    if (await isChatGptPowerPickerOpen(page)) {
        await openPowerPickerSubmenu(page, 'Effort');
        const powerChoice = await findOptionByExactLabels(page, [
            ...simplifiedDefaultLabels(choice),
            ...option.labels,
        ]);
        if (powerChoice && await isModelOptionCandidate(powerChoice, choice)) return powerChoice;
        // No detached radio portal: selection is performed by the Power slider path.
        return null;
    }
    // Current path: exact labels in composer-scoped menu root.
    const current = await findOptionByExactLabels(page, [
        ...simplifiedDefaultLabels(choice),
        ...option.labels,
    ]);
    if (current && await isModelOptionCandidate(current, choice)) return current;

    // Legacy one-row picker compatibility transition.
    await openSimplifiedIntelligenceSubmenu(page).catch(() => undefined);
    const legacyByLabel = await findOptionByExactLabels(page, option.labels);
    if (legacyByLabel && await isModelOptionCandidate(legacyByLabel, choice)) return legacyByLabel;

    // Legacy fallback: only a no-toggle composer's controlled menu may own testids.
    const legacyMenu = await chatGptLegacyMenuRootOpenedByComposer(page);
    if (legacyMenu) {
        for (const testId of option.testIds) {
            const loc = legacyMenu.locator(
                `[role="menuitemradio"][data-testid="${testId}"], [data-testid="${testId}"]`,
            ).first();
            if (!(await loc.isVisible().catch(() => false))) continue;
            if (await isModelOptionCandidate(loc, choice)) return loc;
        }
        // Legacy label-pattern fallback: match combined model row text like "GPT-5.5 Pro".
        for (const label of option.labels) {
            const candidates = legacyMenu.locator('[role="menuitemradio"], [role="menuitem"]')
                .filter({ hasText: legacyModelLabelPattern(choice) });
            const count = await candidates.count().catch(() => 0);
            for (let index = 0; index < count; index += 1) {
                const loc = candidates.nth(index);
                if (!(await loc.isVisible().catch(() => false))) continue;
                if (await isModelOptionCandidate(loc, choice)) return loc;
            }
        }
    }
    return null;
}

/**
 * Open the family submenu in the Intelligence picker. When `forceFamily` is
 * true, only `[data-has-submenu]` menu items are considered (used by family
 * selection). Otherwise, legacy one-row GPT-5.5 entry is also attempted.
 *
 * @param {Page} page
 * @param {{ forceFamily?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function openSimplifiedIntelligenceSubmenu(page, options = {}) {
    const forceFamily = options.forceFamily === true;
    if (!forceFamily && await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
    if (forceFamily && await isChatGptPowerPickerOpen(page)) {
        if (await openPowerPickerSubmenu(page, 'Model')) {
            await findOpenFamilySubmenu(page, familyLabels);
        }
        return;
    }
    let menu = chatGptComposerMenuRoot(page);
    if (!(await menu.isVisible().catch(() => false))) {
        menu = await chatGptLegacyMenuRootOpenedByComposer(page);
        if (!menu) return;
    }
    const candidateSelector = forceFamily
        ? '[role="menuitem"][data-has-submenu]'
        : '[role="menuitem"][data-has-submenu], [role="menuitem"], [role="button"], button';
    const candidates = menu.locator(candidateSelector);
    const count = await candidates.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
        const loc = candidates.nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (!familyLabels.some(label => menuTextHasExactLine(text, label))) continue;
        await loc.hover({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
        if (forceFamily
            ? Boolean(await findOpenFamilySubmenu(page, familyLabels))
            : await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
        await loc.focus({ timeout: 1_000 }).catch(() => undefined);
        await page.keyboard.press('ArrowRight').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
        if (forceFamily
            ? Boolean(await findOpenFamilySubmenu(page, familyLabels))
            : await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
        await loc.click({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
        if (forceFamily
            ? Boolean(await findOpenFamilySubmenu(page, familyLabels))
            : await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
    }
}

/**
 * @param {Locator} loc
 * @param {ModelChoice} choice
 * @returns {Promise<boolean>}
 */
async function isModelOptionCandidate(loc, choice) {
    const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
    if (!text) return false;
    if (isStandaloneEffortLabel(text)) return false;
    if (CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)
        && !menuTextHasExactLine(text, 'Pro')) return false;
    if (choice === 'pro' && isLegacyProModelLabel(text)) return false;
    return modelChoiceFromText(text) === choice;
}

/**
 * Select a family from the family submenu.
 * @param {Page} page
 * @param {FamilyChoice} family
 * @returns {Promise<FamilySelectionEvidence>}
 */
async function selectChatGptFamily(page, family) {
    const expected = CHATGPT_FAMILY_OPTIONS[family]?.label;
    if (!expected) throw familyMismatch(family, null);
    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
    await openSimplifiedIntelligenceSubmenu(page, { forceFamily: true });
    const before = await readVisibleChatGptFamilyEvidence(page);
    const submenu = await findOpenFamilySubmenu(page, familyLabels);
    if (!submenu) throw familyMismatch(family, expected);
    const rows = await submenu.locator('[role="menuitemradio"]').all()
        .catch(() => /** @type {Locator[]} */ ([]));
    let option = null;
    for (const row of rows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (menuTextHasExactLine(text, expected)) {
            option = row;
            break;
        }
    }
    if (!option) throw familyMismatch(family, expected);
    const changed = !(before?.verified && before.label === expected);
    if (changed) {
        await option.click({ timeout: 5_000 });
        await page.waitForTimeout(400).catch(() => undefined);
        await openSimplifiedIntelligenceSubmenu(page, { forceFamily: true });
    }
    const after = await readVisibleChatGptFamilyEvidence(page);
    if (!after?.verified || after.label !== expected) throw familyMismatch(family, expected);
    return { label: after.label, changed, verified: true };
}

/**
 * Find an open family submenu containing canonical family radio options.
 * @param {Page} page
 * @param {string[]} familyLabels
 * @returns {Promise<Locator | null>}
 */
async function findOpenFamilySubmenu(page, familyLabels) {
    const menus = await page.locator('[role="menu"][data-state="open"]').all()
        .catch(() => /** @type {Locator[]} */ ([]));
    for (let index = menus.length - 1; index >= 0; index -= 1) {
        const menu = menus[index];
        if (!(await menu.isVisible().catch(() => false))) continue;
        const rows = await menu.locator('[role="menuitemradio"]').all()
            .catch(() => /** @type {Locator[]} */ ([]));
        /** @type {string[]} */
        const visibleTexts = [];
        for (const row of rows) {
            if (!(await row.isVisible().catch(() => false))) continue;
            const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
            visibleTexts.push(text);
        }
        if (familyLabels.every(label => visibleTexts.some(text => menuTextHasExactLine(text, label)))) return menu;
    }
    return null;
}

/**
 * Read currently visible family evidence from the picker without mutation.
 * @param {Page} page
 * @returns {Promise<FamilySelectionEvidence | null>}
 */
async function readVisibleChatGptFamilyEvidence(page) {
    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
    const submenu = await findOpenFamilySubmenu(page, familyLabels);
    if (submenu) {
        const checkedRows = await submenu.locator(
            '[role="menuitemradio"][aria-checked="true"], '
            + '[role="menuitemradio"][data-state="checked"]',
        ).all().catch(() => /** @type {Locator[]} */ ([]));
        for (const row of checkedRows) {
            if (!(await hasConsistentCheckedState(row))) continue;
            const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
            const label = familyLabels.find(candidate => menuTextHasExactLine(text, candidate));
            if (label) return { label, changed: false, verified: true };
        }
    }
    const root = chatGptComposerMenuRoot(page);
    if (await root.isVisible().catch(() => false)) {
        const triggers = await root.locator('[role="menuitem"][data-has-submenu]').all()
            .catch(() => /** @type {Locator[]} */ ([]));
        for (const trigger of triggers) {
            const text = (await trigger.innerText({ timeout: 500 }).catch(() => '')).trim();
            const label = familyLabels.find(candidate => menuTextHasExactLine(text, candidate));
            if (label) return { label, changed: false, verified: false };
        }
    }
    return null;
}

/**
 * Read only exact, observed Pro labels from an active composer pill.
 * @param {Page} page
 * @returns {Promise<string|null>}
 */
async function readActiveProComposerPill(page) {
    const pills = await page.locator([
        'button.__composer-pill',
        '[role="button"].__composer-pill',
    ].join(', ')).all().catch(() => /** @type {Locator[]} */ ([]));
    for (const pill of pills) {
        if (!(await pill.isVisible().catch(() => false))) continue;
        const text = (await pill.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)) return text;
    }
    return null;
}

/**
 * @param {string|FamilyChoice} requested
 * @param {string|null} expected
 * @returns {WebAiError}
 */
function familyMismatch(requested, expected) {
    return new WebAiError({
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        vendor: 'chatgpt',
        retryHint: 'model-fallback',
        message: `ChatGPT family verification failed: requested ${requested}; expected ${expected || 'supported family'}`,
        evidence: { requestedFamily: requested, expectedFamilyLabel: expected || null },
    });
}

/**
 * Check that aria-checked and data-state are consistent on a row.
 * @param {Locator} row
 * @returns {Promise<boolean>}
 */
async function hasConsistentCheckedState(row) {
    const ariaChecked = await row.evaluateAll((els) => {
        const el = els[0];
        return el ? el.getAttribute('aria-checked') : null;
    }).catch(() => null);
    const dataState = await row.evaluateAll((els) => {
        const el = els[0];
        return el ? el.getAttribute('data-state') : null;
    }).catch(() => null);
    if (ariaChecked !== null && dataState !== null) {
        return ariaChecked === 'true' && dataState === 'checked';
    }
    return ariaChecked === 'true' || dataState === 'checked';
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {string} effort
 * @param {string[]} usedFallbacks
 * @returns {Promise<{ requested: string, selected: string|null, changed: boolean }>}
 */
async function selectChatGptEffort(page, model, effort, usedFallbacks) {
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    if (!config?.efforts?.[effort]) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort ${effort} is not available for ${model}`, evidence: { model, effort, supported: Object.keys(config?.efforts || {}) } });
    }
    await openEffortMenu(page, model, effort, usedFallbacks);
    const before = await readCheckedEffort(page, model, effort);
    if (before === effort) return { requested: effort, selected: before, changed: false };
    const option = await findEffortOption(page, model, effort);
    if (!option) {
        const label = config.efforts[effort];
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort option not found: ${model}/${effort}`, evidence: { model, effort, label } });
    }
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(500).catch(() => undefined);
    await openEffortMenu(page, model, effort, usedFallbacks);
    const after = await readCheckedEffort(page, model, effort);
    if (after !== effort) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort verification failed: expected ${effort}, got ${after || 'none'}`, evidence: { model, effort, got: after || null } });
    }
    return { requested: effort, selected: after, changed: true };
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {string} effort
 * @returns {Promise<Locator | null>}
 */
async function findEffortOption(page, model, effort) {
    const label = CHATGPT_MODEL_EFFORT_OPTIONS[model]?.efforts?.[effort];
    if (!label) return null;
    const simplified = await findOptionByExactLabels(page, simplifiedEffortLabels(model, effort));
    if (simplified) return simplified;
    const candidates = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: effortLabelPattern(label) });
    const modelSpecific = candidates.filter({ hasText: modelLabelPattern(/** @type {ModelChoice} */ (model), CHATGPT_MODEL_OPTIONS[/** @type {ModelChoice} */ (model)]?.labels?.[0] || '') }).last();
    if (await modelSpecific.isVisible().catch(() => false)) return modelSpecific;
    const option = candidates.last();
    return (await option.isVisible().catch(() => false)) ? option : null;
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {string} effort
 * @param {string[]} usedFallbacks
 */
async function openEffortMenu(page, model, effort, usedFallbacks) {
    if (await isEffortMenuOpen(page, model, { effort })) return;
    if (!(await isModelMenuOpen(page))) await openModelMenu(page, usedFallbacks);
    if (await isChatGptPowerPickerOpen(page)) {
        if (await openPowerPickerSubmenu(page, 'Effort')
            && await isEffortMenuOpen(page, model, { effort })) {
            usedFallbacks.push(`${model}-effort-power-submenu`);
            return;
        }
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: 'chatgpt',
            retryHint: 'model-fallback',
            message: `ChatGPT Power effort submenu did not expose ${model}/${effort}`,
            evidence: { model, effort, trigger: 'Effort' },
        });
    }
    const simplifiedDirect = await findOptionByExactLabels(page, simplifiedEffortLabels(model, effort));
    if (simplifiedDirect && await simplifiedDirect.isVisible().catch(() => false)) {
        usedFallbacks.push(`${model}-effort-simplified-direct`);
        return;
    }
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    const row = await findModelOption(page, /** @type {ModelChoice} */ (model));
    const rowBox = row ? await row.boundingBox().catch(() => null) : null;
    if (rowBox) {
        await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2).catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
    } else if (row) {
        await row.hover({ timeout: 2_000 }).catch(() => undefined);
    }
    for (const testId of config.triggerTestIds) {
        const trigger = page.locator(`[data-testid="${testId}"]`).first();
        if (!(await trigger.count().then(count => count > 0).catch(() => false))) continue;
        if (await trigger.isVisible().catch(() => false)) {
            await trigger.click({ timeout: 2_000 }).catch(() => undefined);
            await page.waitForTimeout(300).catch(() => undefined);
            if (await isEffortMenuOpen(page, model, { effort })) return;
            await dismissEffortMenuAndReopenModel(page, usedFallbacks);
        }
    }
    for (const selector of CHATGPT_EFFORT_TRIGGER_SELECTORS) {
        const trigger = page.locator(selector).last();
        if (!(await trigger.isVisible().catch(() => false))) continue;
        await trigger.click({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort, allowUnlabeled: false })) {
            usedFallbacks.push(`${model}-effort-generic-trigger`);
            return;
        }
        await dismissEffortMenuAndReopenModel(page, usedFallbacks);
    }
    const textTrigger = page.locator('button, [role="button"], [role="menuitem"]').filter({ hasText: /^(Effort|Reasoning effort)$/i }).last();
    if (await textTrigger.isVisible().catch(() => false)) {
        await textTrigger.click({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort, allowUnlabeled: false })) {
            usedFallbacks.push(`${model}-effort-text-trigger`);
            return;
        }
        await dismissEffortMenuAndReopenModel(page, usedFallbacks);
    }
    if (row) {
        await row.focus({ timeout: 1_000 }).catch(() => undefined);
        await page.keyboard.press('ArrowRight').catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort })) {
            usedFallbacks.push(`${model}-effort-keyboard-open`);
            return;
        }
    }
    const fallbackBox = await findEffortTriggerBoxNearModelRow(page, model);
    if (fallbackBox) {
        await page.mouse.move(fallbackBox.x + fallbackBox.width / 2, fallbackBox.y + fallbackBox.height / 2).catch(() => undefined);
        await page.waitForTimeout(100).catch(() => undefined);
        await page.mouse.click(fallbackBox.x + fallbackBox.width / 2, fallbackBox.y + fallbackBox.height / 2).catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort })) {
            usedFallbacks.push(`${model}-effort-row-button`);
            return;
        }
    }
    usedFallbacks.push(`${model}-effort-trigger`);
    throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort selector not found for ${model}`, selectorsTried: config.triggerTestIds.map(testId => `[data-testid="${testId}"]`), evidence: { model } });
}

/**
 * @param {Page} page
 * @param {string[]} usedFallbacks
 */
async function dismissEffortMenuAndReopenModel(page, usedFallbacks) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200).catch(() => undefined);
    await openModelMenu(page, usedFallbacks);
}

/**
 * @param {Page} page
 * @param {string} model
 * @returns {Promise<BoundingBox | null>}
 */
async function findEffortTriggerBoxNearModelRow(page, model) {
    const labels = CHATGPT_MODEL_OPTIONS[/** @type {ModelChoice} */ (model)]?.labels || [];
    return page.evaluate(({ expectedLabels, modelChoice, triggerSelectors, localePatterns }) => {
        const rows = Array.from(document.querySelectorAll('[role="menuitemradio"][data-testid^="model-switcher-"], [role="menuitemradio"]'));
        const row = rows.find((candidate) => {
            const text = (/** @type {HTMLElement} */ (candidate).innerText || candidate.textContent || '').trim();
            return matchesModelText(text, modelChoice, expectedLabels);
        });
        if (!row) return null;
        const rowRect = row.getBoundingClientRect();
        const selectorButtons = Array.from(document.querySelectorAll(triggerSelectors.join(',')));
        const textButtons = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"]'))
            .filter(candidate => /^(Effort|Reasoning effort)$/i.test((/** @type {HTMLElement} */ (candidate).innerText || candidate.textContent || '').trim()));
        const effortButtons = [...selectorButtons, ...textButtons];
        const button = effortButtons.find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const rowCenterY = rowRect.y + rowRect.height / 2;
            return rect.width > 0 && rect.height > 0 && rowCenterY >= rect.y && rowCenterY <= rect.y + rect.height;
        });
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        /**
         * @param {string} text
         * @param {string} choice
         * @param {string[]} labelsForChoice
         */
        function matchesModelText(text, choice, labelsForChoice) {
            // `localePatterns` arrives through the evaluate options; this function
            // is serialized, so it must not reference a module constant.
            const source = localePatterns
                ? /** @type {Record<string, string>} */ (localePatterns)[choice]
                : undefined;
            if (source) return new RegExp(source, 'iu').test(text);
            return labelsForChoice.some(label => new RegExp(`(^|\\s)${label}\\b`, 'i').test(text));
        }
    }, {
        expectedLabels: labels,
        modelChoice: model,
        triggerSelectors: CHATGPT_EFFORT_TRIGGER_SELECTORS,
        localePatterns: CHATGPT_MODEL_TEXT_PATTERNS,
    }).catch(() => null);
}

/**
 * @param {Page} page
 * @param {string} model
 * @returns {Promise<EffortChoice | null>}
 */
async function readCheckedEffort(page, model, preferredEffort = null) {
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    const checkedRows = await page.locator('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]')
        .all()
        .catch(() => /** @type {Locator[]} */ ([]));
    for (const row of checkedRows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        const simplified = effortChoiceFromSimplifiedText(text, model, preferredEffort);
        if (simplified) return simplified;
    }
    for (const [effort, label] of Object.entries(config?.efforts || {})) {
        const checked = await page.locator(`[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]`)
            .filter({ hasText: effortLabelPattern(label) })
            .last()
            .isVisible()
            .catch(() => false);
        if (checked) return /** @type {EffortChoice} */ (effort);
    }
    const active = await readActiveEffortPill(page);
    for (const [effort, label] of Object.entries(config?.efforts || {})) {
        if (effortLabelPattern(label).test(active)) return /** @type {EffortChoice} */ (effort);
    }
    return null;
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {{ allowUnlabeled?: boolean, effort?: string | null }} [options]
 * @returns {Promise<boolean>}
 */
async function isEffortMenuOpen(page, model, options = {}) {
    const allowUnlabeled = options.allowUnlabeled !== false;
    const requestedEffort = options.effort || null;
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    if (!config) return false;
    if (await isSimplifiedIntelligenceMenuOpen(page, model, requestedEffort)) return true;
    const labels = Object.values(config.efforts);
    const requiredLabels = requiredEffortMenuLabels(model, requestedEffort);
    const unexpectedLabels = Object.entries(CHATGPT_MODEL_EFFORT_OPTIONS)
        .filter(([choice]) => choice !== model)
        .flatMap(([, option]) => Object.values(option.efforts))
        .filter(label => !labels.includes(label));
    return page.locator('[role="menu"]').evaluateAll((menus, { expectedLabels, requiredLabels, unexpectedLabels, modelChoice, allowUnlabeled }) => {
        return menus.some(menu => {
            const text = /** @type {HTMLElement} */ (menu).innerText || menu.textContent || '';
            if (!menuTextMatchesModel(text, modelChoice, allowUnlabeled)) return false;
            const unexpectedMatches = unexpectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (unexpectedMatches.length > 0) return false;
            const requiredMatches = requiredLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (requiredMatches.length < requiredLabels.length) return false;
            const matches = expectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            const minimumMatches = requiredLabels.length || (expectedLabels.length <= 2 ? expectedLabels.length : Math.min(3, expectedLabels.length));
            return matches.length >= minimumMatches;
        });
        /**
         * @param {string} text
         * @param {string} choice
         * @param {boolean} permitUnlabeled
         */
        function menuTextMatchesModel(text, choice, permitUnlabeled) {
            const hasThinking = /\b(Thinking|Think)\b/i.test(text);
            const hasPro = /\bPro\b/i.test(text);
            if (!hasThinking && !hasPro) return permitUnlabeled;
            if (choice === 'thinking') return hasThinking && !hasPro;
            if (choice === 'pro') return hasPro && !hasThinking;
            return true;
        }
    }, { expectedLabels: labels, requiredLabels, unexpectedLabels, modelChoice: model, allowUnlabeled }).catch(() => false);
}

/**
 * @param {string} model
 * @param {string | null} [effort]
 * @returns {string[]}
 */
function requiredEffortMenuLabels(model, effort) {
    const efforts = CHATGPT_MODEL_EFFORT_OPTIONS[model]?.efforts || {};
    if (model === 'thinking') {
        // Canonical effort keys: medium, high, xhigh.
        const allLabels = [...new Set(Object.values(efforts).filter(Boolean))];
        if (effort && efforts[effort]) return [...new Set([efforts[effort], ...allLabels].filter(Boolean))];
        return allLabels;
    }
    if (model === 'pro') return Object.values(efforts);
    if (effort && efforts[effort]) return [efforts[effort]];
    return Object.values(efforts);
}

/**
 * @param {Page} page
 * @param {ModelChoice | null} [expectedModel]
 * @returns {Promise<ModelChoice | null>}
 */
async function readCheckedModel(page, expectedModel = null) {
    const evidence = await readCheckedModelEvidence(page, expectedModel);
    return evidence?.choice || null;
}

/**
 * @param {Page} page
 * @param {ModelChoice | null} [expectedModel]
 * @returns {Promise<{ choice: ModelChoice, label: string } | null>}
 */
async function readCheckedModelEvidence(page, expectedModel = null) {
    const powerPickerOpen = await isChatGptPowerPickerOpen(page);
    if (powerPickerOpen) {
        const sliderState = await readChatGptPowerSliderState(page);
        if (sliderState.choice) {
            return { choice: sliderState.choice, label: sliderState.label || String(sliderState.choice) };
        }
        const effortTrigger = await findPowerPickerSubmenuTrigger(page, 'Effort');
        if (effortTrigger) {
            const text = (await effortTrigger.innerText({ timeout: 500 }).catch(() => '')).trim();
            const choice = modelChoiceFromPowerTierText(text);
            if (choice) return { choice, label: text || String(choice) };
        }
        const openMenus = await page.locator('[role="menu"][data-state="open"]').all()
            .catch(() => /** @type {Locator[]} */ ([]));
        for (let index = openMenus.length - 1; index >= 0; index -= 1) {
            const menu = openMenus[index];
            if (!(await isPowerEffortPortalMenu(menu))) continue;
            const checkedRows = await menu.locator(
                '[role="menuitemradio"][aria-checked="true"], '
                + '[role="menuitemradio"][data-state="checked"]',
            ).all().catch(() => /** @type {Locator[]} */ ([]));
            for (const row of checkedRows) {
                if (!(await row.isVisible().catch(() => false))) continue;
                if (!(await hasConsistentCheckedState(row))) continue;
                const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
                const choice = modelChoiceFromPowerTierText(text);
                if (choice) return { choice, label: text || String(choice) };
            }
        }
        return null;
    }
    for (const [choice, option] of Object.entries(CHATGPT_MODEL_OPTIONS)) {
        for (const testId of option.testIds) {
            const row = page.locator(`[role="menuitemradio"][data-testid="${testId}"][aria-checked="true"], [data-testid="${testId}"][aria-checked="true"]`).first();
            const checked = await row.isVisible().catch(() => false);
            if (checked) {
                const label = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
                return { choice: /** @type {ModelChoice} */ (choice), label: label || String(choice) };
            }
        }
    }
    const checkedRows = await page.locator('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]').all().catch(() => /** @type {Locator[]} */ ([]));
    for (const row of checkedRows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (isStandaloneEffortLabel(text)) continue;
        const choice = modelChoiceFromText(text);
        if (choice) return { choice, label: text || String(choice) };
    }
    const active = await readActiveModelPill(page, { allowStandaloneHeavy: expectedModel === 'pro' });
    const choice = modelChoiceFromText(active);
    return choice ? { choice, label: active || String(choice) } : null;
}

/**
 * Map the current Power submenu's checked tier to the public model axis.
 * @param {string} text
 * @returns {ModelChoice|null}
 */
function modelChoiceFromPowerTierText(text) {
    if (menuTextHasAnyExactLine(text, simplifiedDefaultLabels('instant'))) return 'instant';
    if (menuTextHasAnyExactLine(text, [
        ...simplifiedDefaultLabels('thinking'),
        ...Object.values(CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS.thinking.efforts).flat(),
    ])) return 'thinking';
    if (menuTextHasAnyExactLine(text, simplifiedDefaultLabels('pro'))) return 'pro';
    return null;
}

/**
 * @param {Page} page
 * @param {{ allowStandaloneHeavy?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function readActiveModelPill(page, options = {}) {
    const allowStandaloneHeavy = options.allowStandaloneHeavy === true;
    let standaloneHeavy = '';
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
            if (!isModelPillText(text)) continue;
            if (isStandaloneEffortLabel(text)) {
                if (allowStandaloneHeavy && /^Heavy$/i.test(text) && !standaloneHeavy) standaloneHeavy = text;
                continue;
            }
            return text;
        }
    }
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (!isModelPillText(text)) continue;
        if (isStandaloneEffortLabel(text)) {
            if (allowStandaloneHeavy && /^Heavy$/i.test(text) && !standaloneHeavy) standaloneHeavy = text;
            continue;
        }
        return text;
    }
    return standaloneHeavy;
}

/**
 * @param {Page} page
 * @returns {Promise<string>}
 */
async function readActiveEffortPill(page) {
    const labels = [...new Set([
        ...Object.values(CHATGPT_MODEL_EFFORT_OPTIONS).flatMap(option => Object.values(option.efforts)),
        ...Object.values(CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS).flatMap(option => Object.values(option.efforts).flat()),
    ])];
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
            if (labels.some(label => effortLabelPattern(label).test(text))) return text;
        }
    }
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (labels.some(label => effortLabelPattern(label).test(text))) return text;
    }
    return '';
}

/**
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
async function isModelMenuOpen(page) {
    // Current path: composer Intelligence picker content root is open.
    if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return true;
    // Legacy fallback: testid-based menu rows inside a composer-controlled menu root.
    const legacyMenu = await chatGptLegacyMenuRootOpenedByComposer(page);
    if (legacyMenu) {
        const legacyOpen = await legacyMenu.locator(CHATGPT_MODEL_MENU_ITEM_SELECTOR)
            .filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN })
            .evaluateAll((items) => items.some(item => {
                const text = (/** @type {HTMLElement} */ (item).innerText || item.textContent || '').trim();
                const testId = item.getAttribute?.('data-testid') || '';
                if (!text) return false;
                if (testId.includes('effort') && /^(Light|Standard|Extended|Heavy|Standard Pro|Extended Pro)$/i.test(text)) return false;
                return true;
            }))
            .catch(() => false);
        if (legacyOpen) return true;
    }
    return false;
}

/**
 * @param {ModelChoice} choice
 * @param {string} label
 * @returns {RegExp}
 */
function modelLabelPattern(choice, label) {
    const labels = CHATGPT_MODEL_OPTIONS[choice]?.labels || [label];
    return exactMenuLinePattern(labels);
}

/**
 * @param {string} label
 * @returns {RegExp}
 */
function effortLabelPattern(label) {
    return exactMenuLinePattern([label]);
}

/**
 * @param {string} text
 * @returns {ModelChoice | null}
 */
function modelChoiceFromText(text) {
    if (menuTextHasAnyExactLine(text, choiceFromTextLabels('instant'))) return 'instant';
    if (isLegacyProModelLabel(text)) return null;
    if (menuTextHasAnyExactLine(text, choiceFromTextLabels('thinking'))) return 'thinking';
    if (menuTextHasAnyExactLine(text, choiceFromTextLabels('pro'))) return 'pro';
    // Legacy combined labels remain a fallback after current exact rows.
    if (/\b(Thinking|Think)\b/i.test(text)) return 'thinking';
    if (/\b(Pro|Pro Standard|Pro Extended|Standard Pro|Extended Pro|Heavy)\b|Pro 확장|프로 확장/i.test(text)) return 'pro';
    return null;
}

/**
 * @param {Page} page
 * @param {readonly string[]} labels
 * @returns {Promise<Locator | null>}
 */
async function findOptionByExactLabels(page, labels) {
    let menu = chatGptComposerMenuRoot(page);
    if (await menu.isVisible().catch(() => false)) {
        const owned = await findExactOptionInMenu(menu, labels);
        if (owned) return owned;
        if (await isChatGptPowerPickerOpen(page)) {
            const openMenus = await page.locator('[role="menu"][data-state="open"]').all()
                .catch(() => /** @type {Locator[]} */ ([]));
            for (let index = openMenus.length - 1; index >= 0; index -= 1) {
                if (!(await isPowerEffortPortalMenu(openMenus[index]))) continue;
                const portalOption = await findExactOptionInMenu(openMenus[index], labels);
                if (portalOption) return portalOption;
            }
            return null;
        }
    }
    menu = await chatGptLegacyMenuRootOpenedByComposer(page);
    if (!menu) menu = page;
    return findExactOptionInMenu(menu, labels);
}

/**
 * @param {Locator|Page} menu
 * @param {readonly string[]} labels
 * @returns {Promise<Locator|null>}
 */
async function findExactOptionInMenu(menu, labels) {
    for (const label of labels) {
        const candidates = await menu.locator('[role="menuitemradio"], [role="menuitem"]').all().catch(() => /** @type {Locator[]} */ ([]));
        for (const loc of candidates) {
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
            if (menuTextHasExactLine(text, label)) return loc;
        }
    }
    return null;
}

/**
 * Verify the sibling portal is the current five-row Power effort menu before
 * selecting from it. Establishing the shell alone is not enough because other
 * page menus can be open at the same time.
 * @param {Locator} menu
 * @returns {Promise<boolean>}
 */
async function isPowerEffortPortalMenu(menu) {
    if (!(await menu.isVisible().catch(() => false))) return false;
    const rows = await menu.locator('[role="menuitemradio"]').all()
        .catch(() => /** @type {Locator[]} */ ([]));
    /** @type {string[]} */
    const observed = [];
    for (const row of rows) {
        if (!(await row.isVisible().catch(() => false))) continue;
        observed.push((await row.innerText({ timeout: 500 }).catch(() => '')).trim());
    }
    const expected = ['Instant', 'Medium', 'High', 'Extra High', 'Pro'];
    return expected.every(label => observed.some(text => menuTextHasExactLine(text, label)));
}

/**
 * @param {Page} page
 * @param {ModelChoice | string | null} model
 * @param {string | null} effort
 * @returns {Promise<boolean>}
 */
async function isSimplifiedIntelligenceMenuOpen(page, model, effort) {
    const requiredLabels = effort && model
        ? simplifiedEffortLabels(model, effort)
        : simplifiedMenuOpenLabels();
    if (requiredLabels.length === 0) return false;
    const menu = chatGptComposerMenuRoot(page);
    const visible = await menu.isVisible().catch(() => false);
    if (!visible) return false;
    if (!model && !effort && await isChatGptPowerPickerOpen(page)) return true;
    if (await isChatGptPowerPickerOpen(page)) {
        const openMenus = await page.locator('[role="menu"][data-state="open"]').all()
            .catch(() => /** @type {Locator[]} */ ([]));
        for (let index = openMenus.length - 1; index >= 0; index -= 1) {
            if (!(await isPowerEffortPortalMenu(openMenus[index]))) continue;
            const rows = await openMenus[index].locator('[role="menuitemradio"]').all()
                .catch(() => /** @type {Locator[]} */ ([]));
            for (const row of rows) {
                const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
                if (requiredLabels.some(label => menuTextHasExactLine(text, label))) return true;
            }
        }
        return false;
    }
    const rows = await menu.locator('[role="menuitemradio"]').all()
        .catch(() => /** @type {Locator[]} */ ([]));
    for (const row of rows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (requiredLabels.some(label => menuTextHasExactLine(text, label))) return true;
    }
    return false;
}

/**
 * @param {ModelChoice | string} model
 * @returns {readonly string[]}
 */
function simplifiedDefaultLabels(model) {
    return CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS[/** @type {ModelChoice} */ (model)]?.defaultLabels || [];
}

/**
 * @param {ModelChoice | string} model
 * @param {string} effort
 * @returns {readonly string[]}
 */
function simplifiedEffortLabels(model, effort) {
    return CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS[/** @type {ModelChoice} */ (model)]?.efforts?.[effort] || [];
}

/**
 * @param {string} text
 * @param {string} model
 * @returns {EffortChoice | null}
 */
function effortChoiceFromSimplifiedText(text, model, preferredEffort = null) {
    const options = CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS[/** @type {ModelChoice} */ (model)]?.efforts || {};
    const preferredLabels = preferredEffort ? options[preferredEffort] || [] : [];
    if (preferredLabels.some(label => menuTextHasExactLine(text, label))) return /** @type {EffortChoice} */ (preferredEffort);
    for (const [effort, labels] of Object.entries(options)) {
        if (labels.some(label => menuTextHasExactLine(text, label))) return /** @type {EffortChoice} */ (effort);
    }
    return null;
}

/**
 * @param {string} text
 * @param {string} label
 * @returns {boolean}
 */
function menuTextHasExactLine(text, label) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => normalizeModelPickerText(line))
        .includes(normalizeModelPickerText(label));
}

/**
 * @param {string} text
 * @param {readonly string[]} labels
 * @returns {boolean}
 */
function menuTextHasAnyExactLine(text, labels) {
    return labels.some(label => menuTextHasExactLine(text, label));
}

/**
 * Build a RegExp that matches any of the given labels as an exact line.
 * @param {string[]} labels
 * @returns {RegExp}
 */
function exactMenuLinePattern(labels) {
    const alternatives = labels.map(escapeRegExp).join('|');
    return new RegExp(`(?:^|\\r?\\n)\\s*(?:${alternatives})\\s*(?=\\r?\\n|$)`, 'i');
}

/**
 * Legacy word-boundary pattern for matching combined model row text
 * (e.g., "GPT-5.5 Pro") in old picker UIs.
 * @param {ModelChoice} choice
 * @returns {RegExp}
 */
function legacyModelLabelPattern(choice) {
    // Combined-row fallback used when no testId is present. ASCII boundaries are
    // preserved exactly; the zh variants ride the same Han-boundary rule as the
    // per-choice matcher so `GPT-5.5思考` resolves like `GPT-5.5 Thinking`.
    /** @param {string[]} labels @returns {string} */
    const HAN = (labels) => `(?<!\\p{Script=Han})(${labels.join('|')})(?!\\p{Script=Han})`;
    if (choice === 'instant') return new RegExp(`\\b(Instant|Fast)\\b|즉시|${HAN(['即时'])}`, 'iu');
    if (choice === 'thinking') {
        return new RegExp(`\\b(Thinking|Think|Medium|High|Extra High)\\b|중간|높음|매우 높음|${HAN(['思考', '中等', '极高', '高'])}`, 'iu');
    }
    if (choice === 'pro') return new RegExp(`\\b(Pro|Heavy|Pro Standard|Pro Extended)\\b|Pro 확장|프로 확장|${HAN(['Pro 扩展'])}`, 'iu');
    return /(?!)/;
}

/**
 * @param {unknown} text
 * @returns {string}
 */
function normalizeModelPickerText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Reject legacy explicit GPT-5.x Pro model rows without blocking current Pro labels.
 * @param {unknown} text
 * @returns {boolean}
 */
function isLegacyProModelLabel(text) {
    const normalized = normalizeModelPickerText(text);
    return [
        /^gpt 5 pro$/,
        /^gpt 5 0 pro$/,
        /^gpt 5 1 pro$/,
        /^gpt 5 2 pro$/,
        /^gpt 5 3 pro$/,
        /^gpt 5 4 pro$/,
    ].some(pattern => pattern.test(normalized));
}

/** @param {string} text @returns {boolean} */
function isModelPillText(text) {
    return menuTextHasAnyExactLine(text, [...PILL_EXACT_LABELS])
        || CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text)
        || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)
        || isStandaloneEffortLabel(text);
}

/** @param {unknown} text @returns {boolean} */
function isStandaloneEffortLabel(text) {
    // Legacy split-pill/submenu labels only. Current Medium/High/Extra High/Pro
    // are selectable tier rows and must not be filtered here.
    return /^(Light|Standard|Extended|Heavy)$/i.test(String(text || '').trim());
}

/** @param {unknown} value @returns {string} */
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @typedef {Object} CapabilityProbeOptions
 * @property {string} [family]
 * @property {string} [effort]
 * @property {string} [reasoningEffort]
 */

/**
 * Report whether the requested family can be selected right now, WITHOUT
 * selecting it. A probe that changed the selection would be answering a
 * different question than the one the caller asked (#87).
 *
 * Label equality alone is not enough: a hidden or disabled row left in the DOM
 * would let the probe answer `ok` while the real selection fails.
 *
 * @param {Page} page
 * @param {FamilyChoice} family
 * @returns {Promise<boolean>}
 */
async function isChatGptFamilyOptionAvailable(page, family) {
    const expected = CHATGPT_FAMILY_OPTIONS[family]?.label;
    if (!expected) return false;
    const familyLabels = Object.values(CHATGPT_FAMILY_OPTIONS).map(option => option.label);
    await openSimplifiedIntelligenceSubmenu(page, { forceFamily: true }).catch(() => undefined);
    const submenu = await findOpenFamilySubmenu(page, familyLabels);
    if (!submenu) return false;
    const rows = await submenu.locator('[role="menuitemradio"]').all().catch(() => /** @type {Locator[]} */ ([]));
    for (const row of rows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (!menuTextHasExactLine(text, expected)) continue;
        if (typeof row.isVisible === 'function' && !(await row.isVisible().catch(() => false))) continue;
        if (typeof row.isEnabled === 'function' && !(await row.isEnabled().catch(() => false))) continue;
        return true;
    }
    return false;
}

/**
 * @typedef {Object} CapabilityProbeResult
 * @property {'ok'|'warn'|'fail'|'unknown'} state
 * @property {Record<string, unknown>} evidence
 * @property {string} next
 */

/**
 * @param {Page} page
 * @param {unknown} model
 * @param {CapabilityProbeOptions} [options]
 * @returns {Promise<CapabilityProbeResult>}
 */
export async function chatGptModelCapabilityProbe(page, model, options = {}) {
    const requested = normalizeChatGptModelChoice(model);
    const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
    const requestedFamily = normalizeChatGptFamilyChoice(options.family);
    // Unsupported aliases fail before the menu opens. A caller reads `ok` as
    // "this request can be enforced", so an alias we cannot select must never
    // reach the browser (#87).
    if (options.family && !requestedFamily) {
        return { state: 'fail', evidence: { requested: requested || null, effort: null, family: options.family }, next: 'model-fallback' };
    }
    // An explicitly named model that we cannot resolve fails regardless of the
    // family, otherwise a valid family would mask an invalid model — the same
    // silent drop #87 exists to stop, moved to the model axis.
    if (model && !requested) {
        return { state: 'fail', evidence: { requested: model, family: requestedFamily || null }, next: 'model-fallback' };
    }
    if (!model && !(options.effort || options.reasoningEffort) && !options.family) {
        return { state: 'unknown', evidence: { requested: null, effort: null, family: null }, next: 'send' };
    }
    if (!requested && !requestedFamily) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    if ((options.effort || options.reasoningEffort) && !requestedEffort) return { state: 'fail', evidence: { requested: requested || null, effort: options.effort || options.reasoningEffort, family: requestedFamily || null }, next: 'model-fallback' };
    // Effort support is keyed by the model axis. Without a model the effort
    // applies to whatever tier is currently selected, which this probe cannot
    // confirm, so the compatibility check only runs when a model was named.
    if (requested && requestedEffort && !isChatGptEffortSupported(requested, requestedEffort)) {
        return { state: 'fail', evidence: { requested, effort: requestedEffort, family: requestedFamily || null }, next: 'model-fallback' };
    }
    /** @type {string[]} */
    const usedFallbacks = [];
    try {
        await openModelMenu(page, usedFallbacks);
    } catch {
        return { state: 'fail', evidence: { requested, menuOpenFailed: true, usedFallbacks }, next: 'model-fallback' };
    }
    const option = requested ? await findModelOption(page, requested).catch(() => null) : null;
    // Family availability is independent of the model row: both axes have to be
    // reachable before `ok` can mean "the whole request can be enforced".
    let familyAvailable = true;
    if (requestedFamily) {
        familyAvailable = await isChatGptFamilyOptionAvailable(page, requestedFamily).catch(() => false);
    }
    /** @type {Locator | null} */
    let effortOption = null;
    if (option && requestedEffort) {
        try {
            await openEffortMenu(page, requested, requestedEffort, usedFallbacks);
            effortOption = await findEffortOption(page, requested, requestedEffort);
        } catch {
            effortOption = null;
        }
    }
    let menuClosed = false;
    try {
        await closeModelMenu(page);
        menuClosed = !(await isModelMenuOpen(page));
    } catch {
        menuClosed = false;
    }
    const selectable = (requested ? Boolean(option) : true)
        && (!requestedEffort || !requested || Boolean(effortOption))
        && familyAvailable;
    // An effort without a model targets the tier that happens to be selected.
    // This probe never selects the family, so it cannot prove that the resulting
    // tier accepts the effort — reporting `ok` would recreate the illusion #87
    // was about.
    const unprovenEffortTier = Boolean(requestedEffort) && !requested;
    const state = selectable
        ? (menuClosed && !unprovenEffortTier ? 'ok' : 'warn')
        : 'fail';
    return {
        state,
        evidence: {
            requested: requested || null,
            effort: requestedEffort || null,
            family: requestedFamily || null,
            menuClosed,
            ...(unprovenEffortTier ? { effortTierUnproven: true } : {}),
            usedFallbacks,
        },
        next: state === 'ok' ? 'send' : 'model-fallback',
    };
}
