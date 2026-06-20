// @ts-check
// Code-mode orchestration (Phase 12 of devlog/_fin/260611_webai_gpt_code_mode):
// strict contract prompt → ChatGPT query → conversation-id resolution →
// in-page artifact retrieval → zip verification. ChatGPT-only: the contract
// depends on container tools that Gemini/Grok do not expose the same way.

import { WebAiError } from './errors.mjs';
import { buildCodeModePrompt, checkContractCompliance } from './code-mode-prompt.mjs';
import { retrieveAllCodeArtifacts, retrieveCodeArtifact } from './code-artifact.mjs';
import { ensureCodeDevContextZip } from './code-dev-context.mjs';

const CONVERSATION_ID_RE = /\/c\/([a-z0-9-]+)/i;
const BARE_CONVERSATION_ID_RE = /^[a-z0-9][a-z0-9-]{8,}$/i;

/**
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
export function extractConversationId(url) {
    const match = String(url || '').match(CONVERSATION_ID_RE);
    if (match) return match[1];
    const value = String(url || '').trim();
    return BARE_CONVERSATION_ID_RE.test(value) ? value : null;
}

/**
 * @param {{ getPage: () => Promise<import('playwright-core').Page> }} deps
 * @param {Record<string, any>} input
 * @param {{ queryWebAi: (deps: any, input: any) => Promise<any>, getSession: (id: string) => any }} services
 */
export async function codeWebAi(deps, input, services) {
    if (input.vendor && input.vendor !== 'chatgpt') {
        throw new WebAiError({
            errorCode: 'code-mode.vendor-unsupported',
            stage: 'code-mode',
            retryHint: 'use-chatgpt',
            message: 'web-ai code is ChatGPT-only (container tool contract)',
        });
    }
    const multiZip = input.multiZip === true;
    const contractPrompt = buildCodeModePrompt(input.prompt, { multiZip });
    // Continuation turns (existing conversation via --url/--conversation, or a
    // resumed recorded session) reuse the same ChatGPT container: the dev-agent
    // context zip from the first turn is already in /mnt/data and its contract
    // already lives in the conversation history. Re-uploading it every turn is
    // redundant — skip it unless the caller forces --context-refresh.
    const continuation = Boolean(
        extractConversationId(input.conversation || input.url) || input.session,
    );
    const attachContext = !continuation || input.contextRefresh === true;
    const contextZip = attachContext ? await ensureCodeDevContextZip() : null;
    const callerFilePaths = Array.isArray(input.filePaths) && input.filePaths.length
        ? input.filePaths
        : (input.filePath ? [input.filePath] : []);
    const filePaths = [...(contextZip ? [contextZip.path] : []), ...callerFilePaths];
    const result = await services.queryWebAi(deps, {
        ...input,
        prompt: contractPrompt,
        inlineOnly: false,
        attachmentPolicy: filePaths.length ? 'upload' : 'inline-only',
        filePath: filePaths[0],
        filePaths,
    });
    if (!result?.ok) return result;

    const warnings = [...(result.warnings || [])];
    if (!multiZip) {
        const compliance = checkContractCompliance(result.answerText || '');
        if (!compliance.compliant) warnings.push('code-mode:contract-drift');
        if (!compliance.mentionsPath) warnings.push('code-mode:answer-missing-artifact-path');
        result.compliance = compliance;
    }

    const session = result.sessionId ? services.getSession(result.sessionId) : null;
    const page = await deps.getPage();
    const pageUrl = typeof page?.url === 'function' ? page.url() : '';
    const conversationId = extractConversationId(session?.conversationUrl)
        || extractConversationId(session?.url)
        || extractConversationId(pageUrl);
    if (!conversationId) {
        return { ...result, ok: false, errorCode: 'code-mode.conversation-id-missing', warnings };
    }

    if (multiZip) {
        const outputDir = input.outputDir || `${process.cwd()}/code-artifacts-${conversationId.slice(0, 8)}`;
        const multi = await retrieveAllCodeArtifacts(page, { conversationId, outputDir, requirePlan: true });
        if (!multi.ok) {
            return { ...result, ok: false, errorCode: multi.reason || 'code-mode.retrieval-failed', artifacts: multi.artifacts, codeContextZip: contextZip?.path ?? null, codeContextAttached: attachContext, warnings };
        }
        const failed = multi.artifacts.filter(a => !a.ok);
        if (failed.length) warnings.push(`code-mode:partial-retrieval(${failed.length} failed)`);
        return { ...result, ok: true, artifacts: multi.artifacts, outputDir, codeContextZip: contextZip?.path ?? null, codeContextAttached: attachContext, warnings };
    }

    const outputPath = input.outputZip
        || `${process.cwd()}/code-artifact-${conversationId.slice(0, 8)}.zip`;
    const artifact = await retrieveCodeArtifact(page, { conversationId, outputPath, requirePlan: true });
    if (!artifact.ok) {
        return { ...result, ok: false, errorCode: artifact.reason || 'code-mode.retrieval-failed', artifact, codeContextZip: contextZip?.path ?? null, codeContextAttached: attachContext, warnings };
    }
    return { ...result, ok: true, artifact, codeContextZip: contextZip?.path ?? null, codeContextAttached: attachContext, warnings };
}

/**
 * Re-retrieve code-mode zip artifacts from an existing ChatGPT conversation.
 * This does not send a prompt; it only uses the saved conversation JSON plus
 * the same interpreter/download API that `web-ai code` uses immediately after
 * generation.
 *
 * @param {{ getPage: () => Promise<import('playwright-core').Page> }} deps
 * @param {Record<string, any>} input
 * @param {{ getSession?: (id: string) => any }} [services]
 */
export async function extractCodeArtifacts(deps, input, services = {}) {
    if (input.vendor && input.vendor !== 'chatgpt') {
        throw new WebAiError({
            errorCode: 'code-mode.vendor-unsupported',
            stage: 'code-extract',
            retryHint: 'use-chatgpt',
            message: 'web-ai code-extract is ChatGPT-only (container artifact contract)',
        });
    }

    const session = input.session && services.getSession ? services.getSession(input.session) : null;
    const page = await deps.getPage();
    const pageUrl = typeof page?.url === 'function' ? page.url() : '';
    const conversationRef = input.conversation || input.url || session?.conversationUrl || session?.url || pageUrl;
    const conversationId = extractConversationId(conversationRef);
    if (!conversationId) {
        return {
            ok: false,
            status: 'error',
            errorCode: 'code-extract.conversation-id-missing',
            warnings: [],
        };
    }

    const targetUrl = resolveConversationUrl(conversationRef, conversationId);
    if (targetUrl && shouldNavigateForExtraction(pageUrl, targetUrl)) {
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } catch (error) {
            return {
                ok: false,
                status: 'error',
                errorCode: 'code-extract.navigation-failed',
                url: targetUrl,
                conversationId,
                warnings: [],
                errorMessage: /** @type {Error} */ (error)?.message || String(error),
            };
        }
    }

    if (input.multiZip === true) {
        const outputDir = input.outputDir || `${process.cwd()}/code-artifacts-${conversationId.slice(0, 8)}`;
        const multi = await retrieveAllCodeArtifacts(page, { conversationId, outputDir });
        return {
            ok: multi.ok,
            status: multi.ok ? 'complete' : 'error',
            errorCode: multi.ok ? undefined : (multi.reason || 'code-extract.retrieval-failed'),
            url: targetUrl || pageUrl,
            conversationId,
            artifacts: multi.artifacts,
            outputDir,
            warnings: [],
        };
    }

    const outputPath = input.outputZip
        || `${process.cwd()}/code-artifact-${conversationId.slice(0, 8)}.zip`;
    const artifact = await retrieveCodeArtifact(page, { conversationId, outputPath });
    return {
        ok: artifact.ok,
        status: artifact.ok ? 'complete' : 'error',
        errorCode: artifact.ok ? undefined : (artifact.reason || 'code-extract.retrieval-failed'),
        url: targetUrl || pageUrl,
        conversationId,
        artifact,
        warnings: [],
    };
}

/**
 * @param {string} conversationRef
 * @param {string} conversationId
 */
function resolveConversationUrl(conversationRef, conversationId) {
    const value = String(conversationRef || '').trim();
    if (/^https:\/\/chatgpt\.com\/c\//i.test(value)) return value;
    return `https://chatgpt.com/c/${conversationId}`;
}

/**
 * @param {string} pageUrl
 * @param {string} targetUrl
 */
function shouldNavigateForExtraction(pageUrl, targetUrl) {
    if (!pageUrl) return true;
    try {
        const current = new URL(pageUrl);
        const target = new URL(targetUrl);
        if (current.origin !== target.origin) return true;
        return extractConversationId(current.href) !== extractConversationId(target.href);
    } catch {
        return true;
    }
}
