// @ts-check
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DEFAULT_INLINE_CHAR_LIMIT } from './constants.mjs';
import { buildContextPack } from './file-selector.mjs';
import { buildContextRenderResult } from './renderer.mjs';
import { WebAiError } from '../errors.mjs';

/**
 * @typedef {{
 *   contextFromFiles?: any,
 *   contextExclude?: string[],
 *   contextFile?: string,
 *   cwd?: string,
 *   maxFileSize?: number,
 *   strict?: boolean,
 *   inlineCharLimit?: number,
 *   prompt?: string,
 *   vendor?: string,
 *   model?: string,
 *   contextTransport?: string,
 *   inlineOnly?: boolean,
 *   maxInput?: number,
 * }} BuilderInput
 */

const PACKAGE_DIR = join(process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent'), 'web-ai-context-packages');

/** @param {BuilderInput} [input] */
export async function buildContextPackageResult(input = {}) {
    const selected = await buildContextPack(input);
    const result = buildContextRenderResult(input, selected.files, selected.excluded, selected.warnings);
    if (result.budget.estimatedTokens > result.budget.maxInputTokens) {
        result.ok = false;
    }
    return result;
}

/** @param {BuilderInput} [input] */
export async function buildInlineContextOrFail(input = {}) {
    if (!hasContextPackaging(input)) return null;
    const result = await buildContextPackageResult({ ...input, strict: true });
    const inlineLimit = Number(input.inlineCharLimit || DEFAULT_INLINE_CHAR_LIMIT);
    if (result.budget.estimatedTokens > result.budget.maxInputTokens) {
        throw overBudgetError(result.budget);
    }
    if (result.composerText.length > inlineLimit) {
        throw inlineLimitError(result.composerText.length, inlineLimit);
    }
    return result;
}

/** @param {BuilderInput} [input] */
export async function prepareContextForBrowser(input = {}) {
    if (!hasContextPackaging(input)) return null;
    const result = await buildContextPackageResult({ ...input, strict: true });
    if (result.budget.estimatedTokens > result.budget.maxInputTokens) {
        throw overBudgetError(result.budget);
    }
    if (result.transport === 'inline') {
        const inlineLimit = Number(input.inlineCharLimit || DEFAULT_INLINE_CHAR_LIMIT);
        if (result.composerText.length > inlineLimit) {
            throw inlineLimitError(result.composerText.length, inlineLimit);
        }
        return result;
    }
    if (!result.attachmentText.trim()) throw new WebAiError({
        errorCode: 'context.over-budget',
        stage: 'context-preflight',
        retryHint: 'reduce-files',
        message: 'context package attachment is empty',
    });
    await fs.mkdir(PACKAGE_DIR, { recursive: true });
    const filePath = join(PACKAGE_DIR, `web-ai-context-package-${Date.now()}.md`);
    await fs.writeFile(filePath, `${result.attachmentText}\n`, 'utf8');
    const stat = await fs.stat(filePath);
    result.attachments = [{
        path: filePath,
        displayPath: basename(filePath),
        sizeBytes: stat.size,
    }];
    return result;
}

/**
 * @param {{ contextFile?: string, contextFromFiles?: any }} [input]
 */
export function hasContextPackaging(input = {}) {
    return Boolean(
        input.contextFile ||
        (Array.isArray(input.contextFromFiles) && input.contextFromFiles.length > 0)
    );
}

/** @param {{ estimatedTokens: number, maxInputTokens: number }} budget */
function overBudgetError(budget) {
    return new WebAiError({
        errorCode: 'context.over-budget',
        stage: 'context-preflight',
        retryHint: 'reduce-files',
        message: `context package exceeds max input tokens: ${budget.estimatedTokens}/${budget.maxInputTokens}`,
        evidence: budget,
    });
}

/**
 * @param {number} length
 * @param {number} limit
 */
function inlineLimitError(length, limit) {
    return new WebAiError({
        errorCode: 'context.over-budget',
        stage: 'context-preflight',
        retryHint: 'reduce-files',
        message: `context package exceeds inline limit: ${length}/${limit} chars`,
        evidence: { length, limit },
    });
}
