// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { discoverProviderFixtures, loadFixtureConfig, sha256File } from './eval/fixtures.mjs';
import { collectMetricRegressions, DEFAULT_EVAL_THRESHOLDS, summarizeEvalResults } from './eval/metrics.mjs';
import { DEFAULT_EVAL_RUN_VARIANTS, EVAL_SCHEMA_VERSION, createEvalError, makeRatioMetric, normalizeEvalVendor, parseFixtureConcurrency, serializeEvalError } from './eval/types.mjs';
import { EVAL_TARGET_INTENTS, probeEvalTargetIntentFromHtml } from './eval/provider-targets.mjs';
import { assertScrubbedSafe } from './eval/scrub-dom.mjs';

/**
 * @typedef {{
 *   id?: string,
 *   vendor?: string,
 *   variant?: string,
 *   fixturePath?: string,
 *   scrub?: string[],
 *   mustContain?: string[],
 *   mustNotContain?: string[],
 * }} EvalFixture
 *
 * @typedef {{
 *   vendor?: string|null,
 *   variants?: string[],
 *   fixtures?: string,
 *   config?: string|null,
 *   concurrency?: number|null,
 *   maxFixtureConcurrency?: number|null,
 * }} EvalRunOptions
 */

const NETWORK_PATTERN = /\b(?:https?:|wss?:|ftp:|file:\/\/)|<(?:script|img|link|iframe|source)\b[^>]*(?:src|href)=["'](?:https?:|\/\/|file:\/\/)/i;

/** @param {EvalRunOptions} [options] */
export async function runWebAiEval(options = {}) {
    const startedAt = new Date().toISOString();
    const vendor = options.config ? null : normalizeEvalVendor(options.vendor || 'chatgpt');
    const concurrency = parseFixtureConcurrency(options.concurrency ?? options.maxFixtureConcurrency);
    const fixtureDir = options.fixtures || 'test/fixtures/provider-dom';
    const config = options.config ? await loadFixtureConfig(options.config) : null;
    const fixtures = config
        ? config.fixtures
        : await discoverProviderFixtures({
            fixtureDir,
            vendor: /** @type {string|undefined} */ (vendor),
            variants: options.variants || DEFAULT_EVAL_RUN_VARIANTS,
        });
    const results = await runBounded(fixtures.map((fixture, index) => ({ fixture, index })), concurrency, async ({ fixture, index }) => {
        return runOneFixture(fixture, { fixtureDir: config ? path.dirname(config.configPath) : fixtureDir, index });
    });
    results.sort((a, b) => a.inputIndex - b.inputIndex);
    const cleanResults = results.map(({ inputIndex: _inputIndex, ...result }) => result);
    const regressions = cleanResults.flatMap(collectMetricRegressions);
    const summary = summarizeEvalResults(cleanResults);
    const ok = summary.failCount === 0 && regressions.length === 0;
    const payload = {
        ok,
        status: ok ? 'pass' : 'fail',
        schemaVersion: EVAL_SCHEMA_VERSION,
        runId: makeRunId(startedAt, fixtures),
        gitCommit: await currentGitCommit(),
        startedAt,
        finishedAt: new Date().toISOString(),
        options: {
            vendor,
            fixtures: fixtureDir,
            config: options.config || null,
            variants: options.variants || DEFAULT_EVAL_RUN_VARIANTS,
            offline: true,
            javascriptEnabled: false,
            maxFixtureConcurrency: concurrency,
        },
        summary,
        results: cleanResults,
        regressions,
    };
    return payload;
}

/**
 * @param {EvalFixture} fixture
 * @param {{ fixtureDir?: string, index?: number }} [opts]
 */
export async function runOneFixture(fixture, { fixtureDir = 'test/fixtures/provider-dom', index = 0 } = {}) {
    const provider = normalizeEvalVendor(fixture.vendor);
    const fixturePath = path.resolve(fixture.fixturePath || path.join(fixtureDir, `${provider}-${fixture.variant || 'baseline'}.html`));
    const fixtureRoot = path.resolve(fixtureDir);
    if (!fixturePath.startsWith(`${fixtureRoot}${path.sep}`)) {
        throw createEvalError('eval.fixture-path-traversal', 'fixture-load', 'fixture path escapes fixture directory', { fixturePath, fixtureDir });
    }
    const html = await fs.readFile(fixturePath, 'utf8');
    const errors = [];
    if (NETWORK_PATTERN.test(html)) {
        errors.push(serializeEvalError(createEvalError('eval.network-blocked', 'fixture-safety', 'fixture contains external network-capable markup', {
            fixturePath,
        })));
    }
    try {
        assertScrubbedSafe(html, { forbiddenText: fixture.scrub || [] });
    } catch (error) {
        errors.push(serializeEvalError(error));
    }
    const probes = Object.fromEntries(EVAL_TARGET_INTENTS.map((intent) => [
        intent,
        probeEvalTargetIntentFromHtml(html, { provider, intent, variant: fixture.variant || 'baseline' }),
    ]));
    const resolvedCount = Object.values(probes).filter((probe) => probe.status === 'resolved').length;
    const requiredResolved = probes['composer.fill']?.status === 'resolved' && probes['send.click']?.status === 'resolved';
    const mustContainErrors = (fixture.mustContain || []).filter((text) => !html.includes(text)).map((text) => serializeEvalError(createEvalError(
        'eval.fixture-must-contain-missing',
        'fixture-assert',
        `fixture missing required marker: ${text}`,
        { text, fixturePath },
    )));
    const mustNotContainErrors = (fixture.mustNotContain || []).filter((text) => html.includes(text)).map((text) => serializeEvalError(createEvalError(
        'eval.fixture-isolation-leak',
        'fixture-assert',
        `fixture contains isolated marker from another fixture: ${text}`,
        { text, fixturePath },
    )));
    errors.push(...mustContainErrors, ...mustNotContainErrors);
    if (!requiredResolved) {
        errors.push(serializeEvalError(createEvalError('eval.target-resolution-failed', 'target-probe', 'required composer/send targets did not resolve', {
            probes,
        })));
    }
    const status = /** @type {'pass'|'fail'} */ (errors.length === 0 ? 'pass' : 'fail');
    const text = htmlToText(html);
    return {
        inputIndex: index,
        provider,
        variant: fixture.variant || inferVariant(fixturePath),
        fixturePath,
        fixtureSha256: await sha256File(fixturePath),
        snapshotId: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16),
        metrics: {
            targetResolution: makeRatioMetric(resolvedCount, EVAL_TARGET_INTENTS.length, DEFAULT_EVAL_THRESHOLDS.uploadOpen),
            composerFill: makeRatioMetric(probes['composer.fill']?.status === 'resolved' ? 1 : 0, 1, DEFAULT_EVAL_THRESHOLDS.composerFill),
            uploadOpen: makeRatioMetric(probes['upload.open']?.status === 'resolved' ? 1 : 0, 1, DEFAULT_EVAL_THRESHOLDS.uploadOpen),
            copyExactness: makeRatioMetric(probes['copy.click']?.status === 'resolved' ? 1 : 0, 1, DEFAULT_EVAL_THRESHOLDS.copyExactness),
            snapshotTokenEstimate: { value: estimateTokens(text), threshold: DEFAULT_EVAL_THRESHOLDS.snapshotTokenEstimateMax },
        },
        thresholds: DEFAULT_EVAL_THRESHOLDS,
        probes,
        status,
        errors,
    };
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number|null|undefined} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function runBounded(items, limit, worker) {
    const concurrency = parseFixtureConcurrency(limit);
    /** @type {R[]} */
    const results = new Array(items.length);
    let cursor = 0;
    async function loop() {
        while (cursor < items.length) {
            const current = cursor;
            cursor += 1;
            results[current] = await worker(items[current], current);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, loop));
    return results;
}

/** @param {string} html */
export function rejectNetworkFixtureHtml(html) {
    if (NETWORK_PATTERN.test(html)) {
        throw createEvalError('eval.network-blocked', 'fixture-safety', 'fixture contains external network-capable markup');
    }
    return true;
}

/** @param {string} filePath */
function inferVariant(filePath) {
    const base = path.basename(filePath, '.html');
    return base.split('-').slice(1).join('-') || 'baseline';
}

/** @param {string} html */
function htmlToText(html) {
    return String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {string} text */
function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
}

/**
 * @param {string} startedAt
 * @param {EvalFixture[]} fixtures
 */
function makeRunId(startedAt, fixtures) {
    return crypto.createHash('sha256').update(`${startedAt}:${fixtures.map((fixture) => fixture.id || fixture.fixturePath).join('|')}`).digest('hex').slice(0, 16);
}

/** @returns {Promise<string|null>} */
async function currentGitCommit() {
    try {
        const head = await fs.readFile('.git/HEAD', 'utf8');
        if (head.startsWith('ref:')) {
            const ref = head.slice(5).trim();
            return (await fs.readFile(path.join('.git', ref), 'utf8')).trim();
        }
        return head.trim();
    } catch {
        return null;
    }
}
