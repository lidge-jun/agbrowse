// @ts-check
/// <reference types="playwright-core" />
import {
    invalidEffortError,
    modeUnavailableError,
    modelEntitlementError,
    modelMismatchError,
} from './errors.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */

/**
 * Canonical catalog derived from the checked-in authenticated observation.
 * `supportsThinking` is true only for models whose picker control was observed
 * in the checked-in English/Korean evidence. Sonar 2 is intentionally false:
 * its row is selectable, but it has no Thinking control.
 */
export const PERPLEXITY_MODEL_CATALOG = Object.freeze({
    best: Object.freeze({ alias: 'best', label: 'Best', locked: false, supportsThinking: true }),
    'sonar-2': Object.freeze({ alias: 'sonar-2', label: 'Sonar 2', locked: false, supportsThinking: false }),
    'gpt-5.6-terra': Object.freeze({ alias: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', locked: false, supportsThinking: true }),
    'gemini-3.1-pro': Object.freeze({ alias: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', locked: false, supportsThinking: true }),
    'claude-sonnet-5': Object.freeze({ alias: 'claude-sonnet-5', label: 'Claude Sonnet 5', locked: false, supportsThinking: true }),
    'glm-5.2': Object.freeze({ alias: 'glm-5.2', label: 'GLM 5.2', locked: false, supportsThinking: true, thinkingOnly: true }),
    'kimi-k2.6': Object.freeze({ alias: 'kimi-k2.6', label: 'Kimi K2.6', locked: false, supportsThinking: true }),
    'nemotron-3-ultra': Object.freeze({ alias: 'nemotron-3-ultra', label: 'Nemotron 3 Ultra', locked: false, supportsThinking: true, thinkingOnly: true }),
    'gpt-5.6-sol': Object.freeze({ alias: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', locked: true, supportsThinking: true }),
    'claude-opus-4.8': Object.freeze({ alias: 'claude-opus-4.8', label: 'Claude Opus 4.8', locked: true, supportsThinking: true }),
});

const MODEL_ALIASES = buildModelAliases();
const THINKING_ON = new Set(['on', 'extended', 'high', 'xhigh', 'heavy']);
const THINKING_OFF = new Set(['off', 'low', 'light', 'standard', 'normal', 'default']);
const MODEL_LABEL_RE = /^(?:Model|Best|Sonar 2|GPT-5\.6 Terra|Gemini 3\.1 Pro|Claude Sonnet 5|GLM[- ]5\.2|Kimi[- ]K2\.6|Nemotron[- ]3 Ultra|GPT-5\.6 Sol|Claude Opus 4\.8)(?:\s+(?:Thinking|사고))?$/i;
const THINKING_LABEL_RE = /^(?:Thinking|사고)$/i;

/**
 * @param {string} alias
 * @returns {(typeof PERPLEXITY_MODEL_CATALOG)[keyof typeof PERPLEXITY_MODEL_CATALOG]|null}
 */
function getCatalogEntry(alias) {
    if (!Object.prototype.hasOwnProperty.call(PERPLEXITY_MODEL_CATALOG, alias)) return null;
    return PERPLEXITY_MODEL_CATALOG[/** @type {keyof typeof PERPLEXITY_MODEL_CATALOG} */ (alias)];
}

/** @param {unknown} value @returns {string|null} */
export function normalizePerplexityModelChoice(value) {
    const key = normalizeToken(value);
    return key ? MODEL_ALIASES.get(key) || null : null;
}

/** @param {unknown} value @returns {'on'|'off'|null} */
export function normalizePerplexityEffort(value) {
    const key = normalizeToken(value);
    if (!key) return null;
    if (THINKING_ON.has(key)) return 'on';
    if (THINKING_OFF.has(key)) return 'off';
    return null;
}

/**
 * Validate before page acquisition so invalid requests cannot mutate browser state.
 * @param {unknown} model
 * @param {unknown} effort
 */
export function validatePerplexitySelectionRequest(model, effort) {
    const hasModel = typeof model === 'string' && model.trim() !== '';
    const hasEffort = typeof effort === 'string' && effort.trim() !== '';
    if (hasEffort && !hasModel) {
        throw modelMismatchError('perplexity', null, {
            reason: 'effort-requires-explicit-model',
            effort,
        });
    }
    const requestedModel = hasModel ? normalizePerplexityModelChoice(model) : null;
    const requestedThinking = hasEffort ? normalizePerplexityEffort(effort) : null;
    if (hasModel && !requestedModel) {
        throw modelMismatchError('perplexity', String(model), { reason: 'unsupported-model' });
    }
    if (hasEffort && !requestedThinking) {
        throw invalidEffortError('perplexity', String(effort), { model: requestedModel });
    }
    if (requestedModel && requestedThinking !== null && !getCatalogEntry(requestedModel)?.supportsThinking) {
        throw modeUnavailableError('perplexity', requestedModel, requestedThinking, {
            reason: 'thinking-control-unavailable',
        });
    }
    if (requestedModel && requestedThinking === 'off' && getCatalogEntry(requestedModel)?.thinkingOnly) {
        throw modeUnavailableError('perplexity', requestedModel, requestedThinking, {
            reason: 'thinking-only-model',
        });
    }
    return { requestedModel, requestedThinking };
}

/**
 * Select one exact observed model row and optionally set its adjacent Thinking switch.
 * Every read after a click reacquires the menu and row to avoid stale locators.
 * @param {Page} page
 * @param {{requestedModel:string|null, requestedThinking:'on'|'off'|null}} selectionRequest
 */
export async function selectPerplexityModel(page, { requestedModel, requestedThinking }) {
    if (!requestedModel) return null;
    const catalog = getCatalogEntry(requestedModel);
    if (!catalog) throw modelMismatchError('perplexity', requestedModel, { reason: 'unsupported-model' });

    let resolved = await openAndResolveRequestedModelRow(page, requestedModel);
    if (resolved.locked) {
        throw modelEntitlementError('perplexity', requestedModel, resolved.evidence);
    }
    if (!resolved.selected) {
        await resolved.row.click({ timeout: 5_000 });
        resolved = await reopenAndResolveSelectedModelRow(page, requestedModel);
    }

    let thinking = null;
    if (requestedThinking !== null) {
        const control = await resolveAdjacentThinkingControl(resolved.row, requestedModel);
        const desired = requestedThinking === 'on';
        if (control.checked !== desired) {
            await assertActionable(control.switch, requestedModel);
            await control.switch.click({ timeout: 5_000 });
            resolved = await reopenAndResolveSelectedModelRow(page, requestedModel);
        }
        const verifiedControl = await resolveAdjacentThinkingControl(resolved.row, requestedModel);
        if (verifiedControl.checked !== desired) {
            throw modeUnavailableError('perplexity', requestedModel, requestedThinking, {
                reason: 'thinking-postcondition-failed',
                observed: verifiedControl.checked,
            });
        }
        thinking = requestedThinking;
    } else {
        thinking = await readPerplexityThinkingStateWithoutMutation(resolved.row);
    }

    await verifySelectedModelRow(resolved.row, requestedModel);
    return {
        requestedModel,
        resolvedModel: requestedModel,
        resolvedLabel: resolved.label,
        locked: false,
        thinking,
        verified: true,
    };
}

/**
 * Non-mutating picker inspection used by status. It opens/closes the picker but
 * never clicks a model row or switch.
 * @param {Page} page
 */
export async function inspectPerplexityModels(page) {
    const before = await readClosedTriggerLabel(page);
    const { menu } = await openUniqueModelMenu(page);
    const rows = await inspectRows(menu);
    const selected = rows.filter(row => row.selected);
    if (selected.length !== 1) {
        await closeModelMenu(page);
        throw modelMismatchError('perplexity', null, { reason: 'selected-row-not-unique', selectedCount: selected.length });
    }
    const selectedRow = menu.locator('[role="menuitemradio"]').nth(selected[0].radioIndex);
    const liveThinking = await readPerplexityThinkingStateWithoutMutation(selectedRow);
    await closeModelMenu(page);
    const after = await readClosedTriggerLabel(page);
    if (before !== after) {
        throw modelMismatchError('perplexity', selected[0].alias, {
            reason: 'status-mutated-model', before, after,
        });
    }
    return rows.map(row => ({
        alias: row.alias,
        label: row.label,
        selected: row.selected,
        locked: row.locked,
        supportsThinking: row.alias ? getCatalogEntry(row.alias)?.supportsThinking ?? null : null,
        thinkingControlPresent: row.selected ? liveThinking !== null : null,
    }));
}

/** @param {Page} page @param {string} requestedModel */
async function openAndResolveRequestedModelRow(page, requestedModel) {
    const { menu } = await openUniqueModelMenu(page);
    return resolveRequestedRow(menu, requestedModel);
}

/** @param {Page} page @param {string} requestedModel */
async function reopenAndResolveSelectedModelRow(page, requestedModel) {
    const { menu } = await openUniqueModelMenu(page);
    const resolved = await resolveRequestedRow(menu, requestedModel);
    if (resolved.locked || !resolved.selected) {
        throw modelMismatchError('perplexity', requestedModel, {
            reason: 'selection-postcondition-failed',
            locked: resolved.locked,
            selected: resolved.selected,
        });
    }
    return resolved;
}

/** @param {Locator} menu @param {string} requestedModel */
async function resolveRequestedRow(menu, requestedModel) {
    const catalog = getCatalogEntry(requestedModel);
    if (!catalog) throw modelMismatchError('perplexity', requestedModel, { reason: 'unsupported-model' });
    const radios = menu.locator('[role="menuitemradio"]');
    const items = menu.locator('[role="menuitem"]');
    const radioMatches = await matchingRows(radios, requestedModel);
    const itemMatches = await matchingRows(items, requestedModel);
    if (radioMatches.length === 0 && itemMatches.length === 1) {
        const row = items.nth(itemMatches[0].index);
        const lockCount = await row.locator('use[href$="pplx-icon-lock"], use[xlink\\:href$="pplx-icon-lock"]').count().catch(() => 0);
        if (lockCount !== 1) {
            throw modelMismatchError('perplexity', requestedModel, { reason: 'non-radio-lock-state-unknown', lockCount });
        }
        return { row, alias: requestedModel, label: itemMatches[0].label, selected: false, locked: true, evidence: { role: 'menuitem', lockCount } };
    }
    if (radioMatches.length !== 1 || itemMatches.length !== 0) {
        throw modelMismatchError('perplexity', requestedModel, {
            reason: 'model-row-not-unique', radioCount: radioMatches.length, itemCount: itemMatches.length,
        });
    }
    const row = radios.nth(radioMatches[0].index);
    await assertActionable(row, requestedModel);
    const checked = await readChecked(row, 'model-row', requestedModel);
    return {
        row,
        alias: requestedModel,
        label: radioMatches[0].label || catalog.label,
        selected: checked,
        locked: false,
        evidence: { role: 'menuitemradio', checked },
    };
}

/** @param {Locator} rows @param {string} requestedModel */
async function matchingRows(rows, requestedModel) {
    const out = [];
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        if (!await row.isVisible().catch(() => false)) continue;
        const label = cleanModelRowLabel(await row.innerText().catch(() => ''));
        if (normalizePerplexityModelChoice(label) === requestedModel) out.push({ index, label });
    }
    return out;
}

/** @param {Locator} menu */
async function inspectRows(menu) {
    const out = [];
    let radioIndex = 0;
    for (const role of ['menuitemradio', 'menuitem']) {
        const rows = menu.locator(`[role="${role}"]`);
        const count = await rows.count();
        for (let i = 0; i < count; i += 1) {
            const row = rows.nth(i);
            if (!await row.isVisible().catch(() => false)) continue;
            const label = cleanModelRowLabel(await row.innerText().catch(() => ''));
            const alias = normalizePerplexityModelChoice(label);
            if (!alias) continue;
            const locked = role === 'menuitem';
            const selected = role === 'menuitemradio' ? await readChecked(row, 'model-row', alias) : false;
            out.push({ alias, label, locked, selected, radioIndex: role === 'menuitemradio' ? radioIndex : -1 });
            if (role === 'menuitemradio') radioIndex += 1;
        }
    }
    return out;
}

/** @param {Page} page */
async function openUniqueModelMenu(page) {
    let visibleMenus = await visibleLocatorIndices(page.locator('[role="menu"]'));
    /** @type {Locator|null} */ let trigger = null;
    if (visibleMenus.length === 0) {
        const candidates = typeof page.getByRole === 'function'
            ? page.getByRole('button', { name: MODEL_LABEL_RE })
            : page.locator('button').filter({ hasText: MODEL_LABEL_RE });
        const visibleTriggers = await visibleLocatorIndices(candidates);
        if (visibleTriggers.length !== 1) {
            throw modelMismatchError('perplexity', null, { reason: 'model-trigger-not-unique', count: visibleTriggers.length });
        }
        trigger = candidates.nth(visibleTriggers[0]);
        await trigger.click({ timeout: 5_000 });
        visibleMenus = await waitForUniqueVisible(page.locator('[role="menu"]'), 5_000);
    }
    if (visibleMenus.length !== 1) {
        throw modelMismatchError('perplexity', null, { reason: 'model-menu-not-unique', count: visibleMenus.length });
    }
    return { menu: page.locator('[role="menu"]').nth(visibleMenus[0]) };
}

/** @param {Page} page */
async function closeModelMenu(page) {
    const menus = page.locator('[role="menu"]');
    if ((await visibleLocatorIndices(menus)).length === 0) return;
    await page.keyboard.press('Escape');
    if ((await waitForClosedModelMenu(page, menus, 3_000)) === false) {
        throw modelMismatchError('perplexity', null, { reason: 'model-menu-close-unverified' });
    }
}

/** @param {Page} page */
async function readClosedTriggerLabel(page) {
    const candidates = typeof page.getByRole === 'function'
        ? page.getByRole('button', { name: MODEL_LABEL_RE })
        : page.locator('button').filter({ hasText: MODEL_LABEL_RE });
    const visible = await visibleLocatorIndices(candidates);
    if (visible.length !== 1) return null;
    return String(await candidates.nth(visible[0]).getAttribute('aria-label').catch(() => '') || await candidates.nth(visible[0]).innerText().catch(() => '')).trim();
}

/** @param {Locator} row @param {string} requestedModel */
async function resolveAdjacentThinkingControl(row, requestedModel) {
    const sibling = row.locator('xpath=following-sibling::*[1]');
    if (await sibling.count() !== 1 || !await sibling.isVisible().catch(() => false)) {
        throw modeUnavailableError('perplexity', requestedModel, null, { reason: 'thinking-sibling-missing' });
    }
    const role = await sibling.getAttribute('role');
    const text = String(await sibling.innerText().catch(() => '')).trim();
    if (role !== 'menuitemcheckbox' || !THINKING_LABEL_RE.test(text.replace(/\s+/g, ' '))) {
        throw modeUnavailableError('perplexity', requestedModel, null, { reason: 'thinking-sibling-mismatch', role, text });
    }
    const switches = sibling.locator('[role="switch"]');
    if (await switches.count() !== 1) {
        throw modeUnavailableError('perplexity', requestedModel, null, { reason: 'thinking-switch-not-unique', count: await switches.count() });
    }
    const switchLocator = switches.nth(0);
    return { switch: switchLocator, checked: await readChecked(switchLocator, 'thinking-switch', requestedModel) };
}

/** @param {Locator} row */
async function readPerplexityThinkingStateWithoutMutation(row) {
    try {
        const control = await resolveAdjacentThinkingControl(row, normalizePerplexityModelChoice(cleanModelRowLabel(await row.innerText().catch(() => ''))) || 'unknown');
        return control.checked ? 'on' : 'off';
    } catch (error) {
        if (error && typeof error === 'object' && /** @type {any} */ (error).errorCode === 'provider.mode-unavailable') return null;
        throw error;
    }
}

/** @param {Locator} row @param {string} requestedModel */
async function verifySelectedModelRow(row, requestedModel) {
    const alias = normalizePerplexityModelChoice(cleanModelRowLabel(await row.innerText().catch(() => '')));
    const checked = await readChecked(row, 'model-row', requestedModel);
    if (alias !== requestedModel || !checked) {
        throw modelMismatchError('perplexity', requestedModel, { reason: 'selected-row-verification-failed', alias, checked });
    }
}

/** @param {Locator} locator @param {string} requestedModel */
async function assertActionable(locator, requestedModel) {
    const visible = await locator.isVisible().catch(() => false);
    const disabledAttr = await locator.getAttribute('disabled');
    const ariaDisabled = await locator.getAttribute('aria-disabled');
    const blockedAncestor = await locator.evaluate((node) => Boolean(node.closest('[inert], [aria-disabled="true"], fieldset[disabled]'))).catch(() => true);
    if (!visible || disabledAttr !== null || ariaDisabled === 'true' || blockedAncestor) {
        throw modelMismatchError('perplexity', requestedModel, {
            reason: 'model-control-noninteractive', visible, disabled: disabledAttr !== null, ariaDisabled, blockedAncestor,
        });
    }
}

/** @param {Locator} locator @param {string} kind @param {string} requestedModel */
async function readChecked(locator, kind, requestedModel) {
    const aria = await locator.getAttribute('aria-checked');
    const state = await locator.getAttribute('data-state');
    if (!['true', 'false'].includes(String(aria)) || !['checked', 'unchecked'].includes(String(state))) {
        throw modelMismatchError('perplexity', requestedModel, { reason: `${kind}-state-invalid`, aria, state });
    }
    const checked = aria === 'true';
    if ((state === 'checked') !== checked) {
        throw modelMismatchError('perplexity', requestedModel, { reason: `${kind}-state-contradictory`, aria, state });
    }
    return checked;
}

/** @param {Locator} locator */
async function visibleLocatorIndices(locator) {
    const out = [];
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) if (await locator.nth(i).isVisible().catch(() => false)) out.push(i);
    return out;
}

/** @param {Locator} locator @param {number} timeoutMs */
async function waitForUniqueVisible(locator, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const visible = await visibleLocatorIndices(locator);
        if (visible.length === 1) return visible;
        if (visible.length > 1) return visible;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return visibleLocatorIndices(locator);
}

/** @param {Page} page @param {Locator} menus @param {number} timeoutMs */
async function waitForClosedModelMenu(page, menus, timeoutMs) {
    const openMenus = page.locator('[role="menu"][data-state="open"]');
    const closedMenus = page.locator('[role="menu"][data-state="closed"]');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const visible = await visibleLocatorIndices(menus);
        if (visible.length === 0) return true;
        const open = await visibleLocatorIndices(openMenus);
        const closed = await visibleLocatorIndices(closedMenus);
        if (visible.length === 1 && open.length === 0 && closed.length === 1) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
}

/** @param {unknown} value */
function normalizeToken(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/[_\s]+/g, '-').replace(/-+/g, '-');
}

function buildModelAliases() {
    const map = new Map();
    for (const [alias, entry] of Object.entries(PERPLEXITY_MODEL_CATALOG)) {
        for (const value of [alias, entry.label]) map.set(normalizeToken(value), alias);
    }
    map.set('terra', 'gpt-5.6-terra');
    map.set('sol', 'gpt-5.6-sol');
    map.set('sonar2', 'sonar-2');
    map.set('glm-5-2', 'glm-5.2');
    map.set('kimi-k2-6', 'kimi-k2.6');
    return map;
}

/** @param {string} text */
function cleanModelRowLabel(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    for (const entry of Object.values(PERPLEXITY_MODEL_CATALOG)) {
        if (normalized.toLowerCase().startsWith(entry.label.toLowerCase())) return entry.label;
    }
    return normalized;
}
