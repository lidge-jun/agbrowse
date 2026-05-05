// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_EVAL_RUN_VARIANTS, normalizeEvalVariant, normalizeEvalVendor, createEvalError } from './types.mjs';

/**
 * @typedef {{
 *   id: string,
 *   vendor: string,
 *   variant: string,
 *   fixturePath: string,
 * }} ProviderFixture
 */

/**
 * @typedef {{
 *   vendor: string,
 *   variant?: string,
 *   htmlPath: string,
 *   fixturePath?: string,
 *   configPath?: string,
 *   [extra: string]: unknown,
 * }} FixtureConfigEntry
 */

/**
 * @typedef {{
 *   schemaVersion: 1,
 *   fixtures: FixtureConfigEntry[],
 *   configPath: string,
 *   [extra: string]: unknown,
 * }} FixtureConfig
 */

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function sha256File(filePath) {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * @param {string} fixtureDir
 * @param {string} relativeOrName
 * @returns {string}
 */
export function resolveFixturePath(fixtureDir, relativeOrName) {
    const root = path.resolve(fixtureDir);
    const resolved = path.resolve(root, relativeOrName);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw createEvalError('eval.fixture-path-traversal', 'fixture-load', 'fixture path escapes fixture directory', {
            fixtureDir,
            relativeOrName,
        });
    }
    return resolved;
}

/**
 * @param {string} fixtureDir
 * @param {string} relativeOrName
 * @returns {Promise<string>}
 */
export async function readFixtureHtml(fixtureDir, relativeOrName) {
    const filePath = resolveFixturePath(fixtureDir, relativeOrName);
    return fs.readFile(filePath, 'utf8');
}

/**
 * @param {{ fixtureDir?: string, vendor?: string, variants?: string[] }} [options]
 * @returns {Promise<ProviderFixture[]>}
 */
export async function discoverProviderFixtures({
    fixtureDir = 'test/fixtures/provider-dom',
    vendor = 'chatgpt',
    variants = DEFAULT_EVAL_RUN_VARIANTS,
} = {}) {
    const normalizedVendor = normalizeEvalVendor(vendor);
    const normalizedVariants = variants.map(normalizeEvalVariant);
    /** @type {ProviderFixture[]} */
    const fixtures = [];
    for (const variant of normalizedVariants) {
        const fileName = `${normalizedVendor}-${variant}.html`;
        const fixturePath = resolveFixturePath(fixtureDir, fileName);
        try {
            await fs.access(fixturePath);
            fixtures.push({
                id: `${normalizedVendor}-${variant}`,
                vendor: normalizedVendor,
                variant,
                fixturePath,
            });
        } catch {
            throw createEvalError('eval.fixture-missing', 'fixture-load', `missing eval fixture: ${fileName}`, {
                fixtureDir,
                vendor: normalizedVendor,
                variant,
            });
        }
    }
    return fixtures;
}

/**
 * @param {string} configPath
 * @returns {Promise<FixtureConfig>}
 */
export async function loadFixtureConfig(configPath) {
    const absolutePath = path.resolve(configPath);
    const raw = await fs.readFile(absolutePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.fixtures)) {
        throw createEvalError('eval.fixture-config-invalid', 'fixture-load', 'fixture config must use schemaVersion 1 and fixtures[]', {
            configPath,
        });
    }
    const baseDir = path.dirname(absolutePath);
    return {
        ...parsed,
        configPath: absolutePath,
        fixtures: parsed.fixtures.map((/** @type {FixtureConfigEntry} */ fixture) => {
            const vendor = normalizeEvalVendor(fixture.vendor);
            const htmlPath = path.resolve(baseDir, fixture.htmlPath);
            if (htmlPath !== baseDir && !htmlPath.startsWith(`${baseDir}${path.sep}`)) {
                throw createEvalError('eval.fixture-path-traversal', 'fixture-load', 'fixture config htmlPath escapes config directory', {
                    configPath,
                    htmlPath: fixture.htmlPath,
                });
            }
            return {
                ...fixture,
                vendor,
                variant: fixture.variant || 'baseline',
                fixturePath: htmlPath,
                configPath: absolutePath,
            };
        }),
    };
}
