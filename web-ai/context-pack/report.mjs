// @ts-check

/**
 * @typedef {{
 *   path: string,
 *   relativePath?: string,
 *   sizeBytes?: number,
 *   estimatedTokens?: number,
 *   language?: string,
 *   reason?: string,
 * }} ContextFileRow
 *
 * @typedef {{
 *   path: string,
 *   displayPath?: string,
 *   sizeBytes?: number,
 * }} ContextAttachment
 *
 * @typedef {{
 *   ok: boolean,
 *   status: string,
 *   vendor: string,
 *   model?: string,
 *   budget: {
 *     status: string,
 *     estimatedTokens: number,
 *     maxInputTokens: number,
 *     inlineChars: number,
 *     inlineCharLimit: number,
 *   },
 *   transport?: string,
 *   contextTransform?: 'repomix',
 *   files: ContextFileRow[],
 *   excluded: ContextFileRow[],
 *   attachments?: ContextAttachment[],
 *   repomix?: Record<string, unknown>,
 *   warnings: string[],
 *   composerText?: string,
 *   attachmentText?: string,
 * }} ContextDryRunResult
 *
 * @typedef {{
 *   mode?: 'summary'|'full'|'json',
 *   full?: boolean,
 *   json?: boolean,
 *   includeComposerText?: boolean,
 * }} ReportOptions
 */

/**
 * @param {ContextDryRunResult} result
 * @param {ReportOptions} [options]
 * @returns {string|undefined}
 */
export function renderContextDryRunReport(result, options = {}) {
    const mode = options.mode || (options.full ? 'full' : options.json ? 'json' : 'summary');
    if (mode === 'json') return JSON.stringify(toJsonResult(result, options), null, 2);
    if (mode === 'full') return result.transport === 'inline' ? result.composerText : result.attachmentText;
    return renderSummary(result);
}

/**
 * @param {ContextDryRunResult} result
 * @param {ReportOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function toJsonResult(result, options = {}) {
    const includeComposerText = Boolean(options.full || options.includeComposerText);
    /** @type {Record<string, unknown>} */
    const base = {
        ok: result.ok,
        status: result.status,
        vendor: result.vendor,
        model: result.model,
        budget: result.budget,
        transport: result.transport,
        ...(result.contextTransform === 'repomix' ? { contextTransform: result.contextTransform } : {}),
        files: result.files.map(file => ({
            path: file.path,
            relativePath: file.relativePath,
            sizeBytes: file.sizeBytes,
            estimatedTokens: file.estimatedTokens,
            language: file.language,
        })),
        attachments: result.attachments || [],
        ...(result.repomix ? { repomix: result.repomix } : {}),
        excluded: result.excluded,
        warnings: result.warnings,
    };
    if (includeComposerText) base.composerText = result.composerText;
    return base;
}

/**
 * @param {ContextDryRunResult} result
 * @returns {string}
 */
function renderSummary(result) {
    const lines = [
        `[context-dry-run] ${result.files.length} files, ~${result.budget.estimatedTokens} / ${result.budget.maxInputTokens} tokens (${result.budget.status})`,
        `[context-dry-run] inline chars: ${result.budget.inlineChars} / ${result.budget.inlineCharLimit}`,
        `[context-dry-run] transport: ${result.transport || 'upload'}`,
    ];

    if (result.contextTransform === 'repomix') {
        lines.push('[context-dry-run] transform: repomix');
        if (result.repomix) {
            lines.push(`[context-dry-run] repomix: ${String(result.repomix.version || 'unknown')} (${String(result.repomix.source || 'unknown')})`);
            lines.push(`[context-dry-run] config: ${String(result.repomix.configPath || 'built-in defaults')}`);
        }
    }

    if (result.attachments?.length) {
        lines.push('');
        lines.push('Attachments to upload:');
        for (const attachment of result.attachments) {
            lines.push(`  - ${attachment.displayPath || attachment.path} — ${attachment.sizeBytes} bytes`);
        }
    }

    lines.push('');
    lines.push('Included:');
    if (result.files.length === 0) lines.push('  (none)');
    for (const file of result.files) {
        lines.push(`  - ${file.relativePath} — ~${file.estimatedTokens} tokens, ${file.sizeBytes} bytes`);
    }

    if (result.excluded.length || result.warnings.length) {
        lines.push('');
        lines.push('Excluded:');
        if (result.excluded.length === 0) lines.push('  (none)');
        for (const file of result.excluded) {
            lines.push(`  - ${file.relativePath || file.path} — ${file.reason}${file.sizeBytes ? ` (${file.sizeBytes} bytes)` : ''}`);
        }
    }

    if (result.warnings.length) {
        lines.push('');
        lines.push('Warnings:');
        for (const warning of result.warnings) lines.push(`  - ${warning}`);
    }

    return lines.join('\n');
}
