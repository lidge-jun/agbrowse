// @ts-check
import { promises as fs } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import fg from 'fast-glob';
import { DEFAULT_EXCLUDES, DEFAULT_MAX_FILE_SIZE_BYTES } from './constants.mjs';
import { estimateTokens } from './token-estimator.mjs';
import { languageFromPath } from './renderer.mjs';
import { WebAiError } from '../errors.mjs';

/**
 * @typedef {{
 *   contextFromFiles?: any,
 *   contextExclude?: string[],
 *   contextFile?: string,
 *   cwd?: string,
 *   maxFileSize?: number,
 *   strict?: boolean,
 * }} FileSelectorInput
 */

/**
 * @param {FileSelectorInput} [input]
 */
export async function buildContextPack(input = {}) {
    const cwd = resolve(input.cwd || process.cwd());
    const patterns = await collectPatterns(input);
    if (patterns.include.length === 0) {
        throw new WebAiError({
            errorCode: 'context.over-budget',
            stage: 'context-preflight',
            retryHint: 'reduce-files',
            message: 'context files required. Pass --context-from-files or --context-file.',
        });
    }

    const exclude = [...DEFAULT_EXCLUDES, ...patterns.exclude, ...(input.contextExclude || [])];
    const paths = await expandContextPaths(patterns.include, exclude, cwd);
    const maxFileSize = Number(input.maxFileSize || DEFAULT_MAX_FILE_SIZE_BYTES);
    const files = [];
    const excluded = [];
    const warnings = [];

    for (const path of paths) {
        const selected = await readContextFile(path, cwd, maxFileSize, Boolean(input.strict));
        if (selected.ok) files.push(selected.file);
        else excluded.push(selected.excluded);
    }

    if (files.length === 0) warnings.push('no context files included');
    return { files, excluded, warnings };
}

/**
 * @param {FileSelectorInput} [input]
 */
export async function collectPatterns(input = {}) {
    const include = normalizeList(input.contextFromFiles);
    const exclude = [];
    for (const value of [...include]) {
        if (value.startsWith('!')) {
            exclude.push(value.slice(1));
            include.splice(include.indexOf(value), 1);
        }
    }

    if (input.contextFile) {
        const content = await fs.readFile(resolve(input.cwd || process.cwd(), input.contextFile), 'utf8');
        const parsed = parseContextFile(content);
        include.push(...parsed.include);
        exclude.push(...parsed.exclude);
    }

    return { include: unique(include), exclude: unique(exclude) };
}

/**
 * @param {string[]} [includePatterns]
 * @param {string[]} [excludePatterns]
 * @param {string} [cwd]
 */
export async function expandContextPaths(includePatterns = [], excludePatterns = [], cwd = process.cwd()) {
    const literals = [];
    const globs = [];

    for (const pattern of includePatterns) {
        const absolute = resolve(cwd, pattern);
        const stat = await fs.lstat(absolute).catch(() => null);
        if (stat) {
            if (stat.isSymbolicLink()) throw new WebAiError({
                errorCode: 'context.symlink-rejected',
                stage: 'context-preflight',
                retryHint: 'path-list',
                message: `context path is a symlink and is not allowed: ${pattern}`,
                evidence: { pattern },
            });
            if (stat.isDirectory()) globs.push(`${toPosix(relative(cwd, absolute))}/**/*`);
            else if (stat.isFile()) literals.push(absolute);
            else throw new WebAiError({
                errorCode: 'context.symlink-rejected',
                stage: 'context-preflight',
                retryHint: 'path-list',
                message: `context path is not a regular file or directory: ${pattern}`,
                evidence: { pattern },
            });
            continue;
        }
        if (looksLikeGlob(pattern)) globs.push(pattern);
        else throw new WebAiError({
            errorCode: 'context.symlink-rejected',
            stage: 'context-preflight',
            retryHint: 'path-list',
            message: `context path not found: ${pattern}`,
            evidence: { pattern },
        });
    }

    const globbed = globs.length
        ? await fg(globs, {
            cwd,
            absolute: true,
            onlyFiles: true,
            followSymbolicLinks: false,
            ignore: excludePatterns,
            dot: true,
        })
        : [];

    return unique([...literals, ...globbed])
        .map(path => resolve(path))
        .sort((a, b) => toPosix(relative(cwd, a)).localeCompare(toPosix(relative(cwd, b))));
}

/**
 * @typedef {{ ok: true, file: { path: string, relativePath: string, sizeBytes: number, estimatedTokens: number, language: string, content: string } } | { ok: false, excluded: { path: string, relativePath: string, reason: string, sizeBytes?: number } }} ReadContextFileResult
 */

/**
 * @param {string} path
 * @param {string} [cwd]
 * @param {number} [maxFileSize]
 * @param {boolean} [strict]
 * @returns {Promise<ReadContextFileResult>}
 */
export async function readContextFile(path, cwd = process.cwd(), maxFileSize = DEFAULT_MAX_FILE_SIZE_BYTES, strict = false) {
    const stat = await fs.lstat(path);
    const relativePath = toPosix(relative(cwd, path));
    if (stat.isSymbolicLink()) {
        return excluded(path, relativePath, 'symlink-not-allowed');
    }
    if (!stat.isFile()) {
        return excluded(path, relativePath, 'not-a-regular-file');
    }
    if (stat.size > maxFileSize) {
        if (strict) throw new WebAiError({
            errorCode: 'context.over-budget',
            stage: 'context-preflight',
            retryHint: 'reduce-files',
            message: `context file exceeds max size: ${relativePath} (${stat.size}/${maxFileSize} bytes)`,
            evidence: { relativePath, size: stat.size, max: maxFileSize },
        });
        return excluded(path, relativePath, 'max-file-size-exceeded', stat.size);
    }

    const buffer = await fs.readFile(path);
    if (isBinaryLike(buffer)) return excluded(path, relativePath, 'binary-or-non-text', stat.size);

    const content = buffer.toString('utf8');
    return {
        ok: true,
        file: {
            path,
            relativePath,
            sizeBytes: stat.size,
            estimatedTokens: estimateTokens(content, 1),
            language: languageFromPath(relativePath),
            content,
        },
    };
}

/** @param {string} content */
function parseContextFile(content) {
    /** @type {string[]} */
    const include = [];
    /** @type {string[]} */
    const exclude = [];
    const trimmed = String(content || '').trim();
    if (!trimmed) return { include, exclude };
    if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        include.push(...normalizeList(parsed.include || parsed.files || parsed.contextFromFiles));
        exclude.push(...normalizeList(parsed.exclude || parsed.contextExclude));
        return { include, exclude };
    }
    for (const line of trimmed.split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith('#')) continue;
        if (value.startsWith('!')) exclude.push(value.slice(1));
        else include.push(value);
    }
    return { include, exclude };
}

/**
 * @param {string} path
 * @param {string} relativePath
 * @param {string} reason
 * @param {number} [sizeBytes]
 * @returns {{ ok: false, excluded: { path: string, relativePath: string, reason: string, sizeBytes?: number } }}
 */
function excluded(path, relativePath, reason, sizeBytes) {
    return { ok: false, excluded: { path, relativePath, reason, ...(sizeBytes ? { sizeBytes } : {}) } };
}

/** @param {unknown} value */
function normalizeList(value) {
    if (!value) return [];
    return (Array.isArray(value) ? value : [value])
        .flatMap(item => String(item || '').split(','))
        .map(item => item.trim())
        .filter(Boolean);
}

/** @param {string[]} values */
function unique(values) {
    return [...new Set(values)];
}

function looksLikeGlob(value = '') {
    return /[*?[\]{}()!]/.test(value);
}

function toPosix(value = '') {
    return String(value).split(sep).join('/');
}

/** @param {Buffer} buffer */
function isBinaryLike(buffer) {
    if (buffer.includes(0)) return true;
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
    return sample.includes('\uFFFD');
}
