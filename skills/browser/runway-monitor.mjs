// @ts-check

import { parseArgs } from 'node:util';

export const DEFAULT_RUNWAY_POLL_TIMEOUT_MS = 600000;
export const DEFAULT_RUNWAY_POLL_INTERVAL_MS = 5000;
export const DEFAULT_RUNWAY_QUEUE_LIMIT = 2;

/**
 * @param {unknown} value
 * @returns {string}
 */
function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {string} label
 * @returns {boolean}
 */
function isOutputLabel(label) {
    return /\.(?:mp4|png|jpe?g)\b/i.test(label)
        || /\/(?:result|task_artifact|video-previews)\b/i.test(label)
        || /\b(?:use frame|reuse settings|see full prompt)\b/i.test(label);
}

/**
 * @param {string} label
 * @returns {boolean}
 */
function isActiveLabel(label) {
    return /\b(?:generating|queued|processing|loading animation)\b/i.test(label)
        || /^(?:[1-9]?\d|100)\s*%$/.test(label);
}

function defaultCompletionDomSummary() {
    return {
        textSample: '',
        outputItemCount: 0,
        outputLabels: [],
        activeLabels: [],
        progressTexts: [],
        queueGateText: null,
        readyText: null,
        hasGenerateButton: false,
        generateDisabled: false,
    };
}

/**
 * @param {any} page
 * @param {{ queueLimit?: number, afterCount?: number | null, expectedItem?: string | null }} [options]
 */
export async function inspectRunwayCompletionState(page, options = {}) {
    const queueLimit = positiveInt(options.queueLimit, DEFAULT_RUNWAY_QUEUE_LIMIT);
    const afterCount = Number.isFinite(options.afterCount) ? Number(options.afterCount) : null;
    const expectedItem = clean(options.expectedItem || '');
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

    const isRunwayTab = /(?:^|\.)runwayml\.com\b/i.test(url);

    let dom = defaultCompletionDomSummary();
    try {
        dom = await page.evaluate(() => {
            /** @param {unknown} value */
            const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
            const visibleText = normalize(document.body?.innerText || '');
            const labelElements = Array.from(document.querySelectorAll('button, [aria-label], [title], img, video, [draggable="true"]'));
            const visibleLabels = labelElements
                .map(element => normalize(
                    element.textContent
                    || element.getAttribute('aria-label')
                    || element.getAttribute('title')
                    || element.getAttribute('alt')
                    || '',
                ))
                .filter(Boolean)
                .slice(0, 300);
            const sourceLabels = Array.from(document.querySelectorAll('img[src], video[src], source[src]'))
                .map(element => normalize(element.getAttribute('src') || ''))
                .filter(Boolean)
                .slice(0, 300);
            const outputLabels = [...visibleLabels, ...sourceLabels];
            const outputPattern = /\.(?:mp4|png|jpe?g)\b|\/(?:result|task_artifact|video-previews)\b|\b(?:use frame|reuse settings|see full prompt)\b/i;
            const activePattern = /\b(?:generating|queued|processing|loading animation)\b/i;
            const buttonLabels = Array.from(document.querySelectorAll('button')).map(button => ({
                text: normalize(button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || ''),
                disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true'),
            }));
            return {
                textSample: visibleText.slice(0, 1200),
                outputItemCount: outputLabels.filter(label => outputPattern.test(label)).length,
                outputLabels: outputLabels.filter(label => outputPattern.test(label)).slice(0, 40),
                activeLabels: visibleLabels.filter(label => activePattern.test(label)).slice(0, 40),
                progressTexts: Array.from(new Set(visibleText.match(/\b(?:[1-9]?\d|100)\s*%\b/g) || [])).slice(0, 20),
                queueGateText: /you're on a roll|please wait for your last generation|switch to credits mode/i.test(visibleText)
                    ? 'You are on a roll / wait for last generation / Credits Mode'
                    : null,
                readyText: /you're ready to generate/i.test(visibleText) ? 'You are ready to generate.' : null,
                hasGenerateButton: buttonLabels.some(row => /^generate$/i.test(row.text)),
                generateDisabled: buttonLabels.some(row => /^generate$/i.test(row.text) && row.disabled),
            };
        });
    } catch (error) {
        errors.push(`completion-evaluate: ${error instanceof Error ? error.message : String(error)}`);
    }

    const outputLabels = Array.isArray(dom.outputLabels) ? dom.outputLabels.map(clean).filter(isOutputLabel) : [];
    const activeLabels = Array.isArray(dom.activeLabels) ? dom.activeLabels.map(clean).filter(isActiveLabel) : [];
    const progressTexts = Array.isArray(dom.progressTexts) ? dom.progressTexts.map(clean).filter(Boolean) : [];
    const activeCountEstimate = Math.min(queueLimit, Math.max(activeLabels.length, progressTexts.length));
    const queueFull = isRunwayTab && (Boolean(dom.queueGateText) || activeCountEstimate >= queueLimit);
    const outputItemCount = Number.isFinite(Number(dom.outputItemCount)) ? Number(dom.outputItemCount) : outputLabels.length;
    const expectedItemVisible = expectedItem
        ? outputLabels.some(label => label.includes(expectedItem)) || clean(dom.textSample).includes(expectedItem)
        : null;
    const acceptedAfterBaseline = afterCount === null ? null : outputItemCount > afterCount;
    const state = !isRunwayTab ? 'not_runway' : queueFull ? 'queue_full' : activeCountEstimate > 0 ? 'active' : 'idle';
    const terminal = state !== 'active';
    const completionSignal = state === 'not_runway'
        ? 'not-runway-tab'
        : state === 'queue_full'
        ? 'queue-gate'
        : terminal
            ? 'no-active-generation-signals'
            : 'active-generation-signals';

    return {
        ok: errors.length === 0,
        vendor: 'runway',
        command: 'poll',
        url,
        title,
        isRunwayTab,
        state,
        terminal,
        completionSignal,
        queue: {
            limit: queueLimit,
            activeCountEstimate,
            full: queueFull,
            gateText: dom.queueGateText || null,
            readyText: dom.readyText || null,
        },
        submitEvidence: {
            afterCount,
            outputItemCount,
            acceptedAfterBaseline,
            expectedItem: expectedItem || null,
            expectedItemVisible,
        },
        controls: {
            hasGenerateButton: Boolean(dom.hasGenerateButton),
            generateDisabled: Boolean(dom.generateDisabled),
        },
        activeLabels,
        outputLabels,
        textSample: clean(dom.textSample).slice(0, 1200),
        errors,
    };
}

/**
 * @param {any} page
 * @param {{ timeoutMs?: number, intervalMs?: number, queueLimit?: number, afterCount?: number | null, expectedItem?: string | null, sleep?: (ms: number) => Promise<void> }} [options]
 */
export async function waitForRunwayCompletion(page, options = {}) {
    const timeoutMs = positiveInt(options.timeoutMs, DEFAULT_RUNWAY_POLL_TIMEOUT_MS);
    const intervalMs = positiveInt(options.intervalMs, DEFAULT_RUNWAY_POLL_INTERVAL_MS);
    const startedAt = Date.now();
    const sleep = options.sleep || defaultSleep;
    let polls = 0;
    /** @type {Awaited<ReturnType<typeof inspectRunwayCompletionState>> | null} */
    let state = null;
    while (Date.now() - startedAt <= timeoutMs) {
        polls += 1;
        state = await inspectRunwayCompletionState(page, options);
        if (state.terminal) break;
        await sleep(intervalMs);
    }
    const waitedMs = Date.now() - startedAt;
    return {
        ...(state || await inspectRunwayCompletionState(page, options)),
        timeoutMs,
        intervalMs,
        waitedMs,
        polls,
        timedOut: Boolean(state && !state.terminal && waitedMs >= timeoutMs),
    };
}

/**
 * @param {any} result
 */
export function formatRunwayPoll(result) {
    return [
        'Runway poll',
        `state: ${result.state}`,
        `terminal: ${result.terminal ? 'yes' : 'no'}`,
        `completionSignal: ${result.completionSignal}`,
        `queue: ${result.queue.activeCountEstimate}/${result.queue.limit}${result.queue.full ? ' full' : ''}`,
        `outputItemCount: ${result.submitEvidence.outputItemCount}`,
        `acceptedAfterBaseline: ${result.submitEvidence.acceptedAfterBaseline === null ? 'n/a' : result.submitEvidence.acceptedAfterBaseline ? 'yes' : 'no'}`,
        `polls: ${result.polls}`,
        `waitedMs: ${result.waitedMs}`,
        `timedOut: ${result.timedOut ? 'yes' : 'no'}`,
        result.queue.gateText ? `queueGate: ${result.queue.gateText}` : null,
        result.errors?.length ? `errors: ${result.errors.join('; ')}` : null,
    ].filter(Boolean).join('\n');
}

/**
 * @param {string[]} args
 * @param {any} deps
 */
export async function runRunwayPollCli(args = [], deps = {}) {
    const { values } = parseArgs({
        args,
        options: {
            timeout: { type: 'string', default: String(DEFAULT_RUNWAY_POLL_TIMEOUT_MS) },
            interval: { type: 'string', default: String(DEFAULT_RUNWAY_POLL_INTERVAL_MS) },
            'queue-limit': { type: 'string', default: String(DEFAULT_RUNWAY_QUEUE_LIMIT) },
            'after-count': { type: 'string' },
            'expected-item': { type: 'string' },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });
    const page = await deps.getPage();
    const result = await waitForRunwayCompletion(page, {
        timeoutMs: positiveInt(values.timeout, DEFAULT_RUNWAY_POLL_TIMEOUT_MS),
        intervalMs: positiveInt(values.interval, DEFAULT_RUNWAY_POLL_INTERVAL_MS),
        queueLimit: positiveInt(values['queue-limit'], DEFAULT_RUNWAY_QUEUE_LIMIT),
        afterCount: values['after-count'] === undefined ? null : Number.parseInt(String(values['after-count']), 10),
        expectedItem: values['expected-item'] ? String(values['expected-item']) : null,
        sleep: deps.sleep,
    });
    const text = values.json ? JSON.stringify(result, null, 2) : formatRunwayPoll(result);
    if (typeof deps.write === 'function') deps.write(text);
    else console.log(text);
}
