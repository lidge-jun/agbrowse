// @ts-check
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebAiError } from '../errors.mjs';
import { estimateTokens } from './token-estimator.mjs';

export const CONTEXT_TRANSFORM_MODES = /** @type {const} */ (['raw', 'repomix']);

/**
 * @typedef {{
 *   path: string,
 *   relativePath: string,
 *   sizeBytes: number,
 *   estimatedTokens: number,
 *   language: string,
 *   content: string,
 * }} TransformContextFile
 */

/**
 * @param {unknown} [mode]
 * @returns {'raw'|'repomix'}
 */
export function normalizeContextTransformMode(mode) {
    const supplied = mode == null ? 'raw' : String(mode).trim();
    const normalized = supplied.toLowerCase();
    if (normalized === 'raw' || normalized === 'repomix') return normalized;
    throw new WebAiError({
        errorCode: 'context.transform-invalid',
        stage: 'context-transform',
        retryHint: 'use-supported-transform',
        message: `unsupported context transform: ${supplied}. Supported values: ${CONTEXT_TRANSFORM_MODES.join(', ')}`,
        evidence: {
            supplied: mode,
            supported: [...CONTEXT_TRANSFORM_MODES],
        },
    });
}

/**
 * @param {TransformContextFile[]} files
 * @param {{ mode?: unknown, cwd?: string }} [options]
 * @returns {Promise<TransformContextFile[]>}
 */
export async function transformContextFiles(files, options = {}) {
    const mode = normalizeContextTransformMode(options.mode);
    if (mode === 'raw') return files;

    const cwd = resolve(options.cwd || process.cwd());
    const rawFiles = files.map(file => ({
        path: file.relativePath,
        content: file.content,
    }));

    try {
        const requireFromCwd = createRequire(join(cwd, 'package.json'));
        const repomixEntry = requireFromCwd.resolve('repomix');
        const repomix = await import(pathToFileURL(repomixEntry).href);
        assertRepomixApi(repomix);

        const config = await repomix.mergeConfigs(cwd, {}, {
            output: {
                compress: true,
            },
        });
        await repomix.setLogLevel(-1);
        const processedFiles = await repomix.processFiles(rawFiles, config, () => {});
        return mapProcessedFiles(files, processedFiles);
    } catch (cause) {
        const reason = errorMessage(cause);
        throw new WebAiError({
            errorCode: 'context.transform-failed',
            stage: 'context-transform',
            retryHint: 'install-compatible-repomix',
            message: `repomix context transform requires a project-local Repomix installation compatible with the current Node runtime: ${reason}`,
            evidence: {
                mode,
                cwd,
                reason,
            },
            cause,
        });
    }
}

/** @param {Record<string, unknown>} repomix */
function assertRepomixApi(repomix) {
    const required = ['mergeConfigs', 'processFiles', 'setLogLevel'];
    const missing = required.filter(name => typeof repomix[name] !== 'function');
    if (missing.length) {
        throw new TypeError(`incompatible Repomix API; expected package-root functions: ${missing.join(', ')}`);
    }
}

/**
 * @param {TransformContextFile[]} files
 * @param {unknown} processedFiles
 * @returns {TransformContextFile[]}
 */
function mapProcessedFiles(files, processedFiles) {
    if (!Array.isArray(processedFiles)) {
        throw new TypeError('Repomix processFiles() returned a non-array result');
    }

    const selectedPaths = new Set(files.map(file => file.relativePath));
    const processedByPath = new Map();
    for (const processed of processedFiles) {
        const path = processed && typeof processed === 'object'
            ? /** @type {{ path?: unknown }} */ (processed).path
            : undefined;
        if (typeof path !== 'string' || !selectedPaths.has(path)) {
            throw new TypeError(`Repomix returned an unknown path: ${String(path)}`);
        }
        if (processedByPath.has(path)) {
            throw new TypeError(`Repomix returned a duplicate path: ${path}`);
        }
        const content = /** @type {{ content?: unknown }} */ (processed).content;
        if (typeof content !== 'string') {
            throw new TypeError(`Repomix returned non-string content for path: ${path}`);
        }
        processedByPath.set(path, content);
    }

    return files.map(file => {
        if (!processedByPath.has(file.relativePath)) {
            throw new TypeError(`Repomix did not return selected path: ${file.relativePath}`);
        }
        const content = /** @type {string} */ (processedByPath.get(file.relativePath));
        return {
            ...file,
            content,
            sizeBytes: Buffer.byteLength(content, 'utf8'),
            estimatedTokens: estimateTokens(content, 1),
        };
    });
}

/** @param {unknown} error */
function errorMessage(error) {
    if (error && typeof error === 'object' && 'message' in error) {
        return String(/** @type {{ message?: unknown }} */ (error).message || error);
    }
    return String(error);
}
