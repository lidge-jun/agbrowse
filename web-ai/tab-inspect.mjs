// @ts-check

/**
 * @typedef {Object} TabSummary
 * @property {string} targetId
 * @property {string} title
 * @property {string} url
 * @property {string} vendor
 * @property {string|null} modelLabel
 * @property {boolean} stopExists
 * @property {boolean} sendExists
 * @property {boolean} promptReady
 * @property {boolean} authenticated
 * @property {number} assistantCount
 * @property {string|null} lastAssistantText
 * @property {string|null} lastAssistantSnippet
 * @property {string|null} conversationId
 * @property {string|null} fingerprint
 * @property {'running'|'completed'|'detached'|'stalled'} state
 */

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

const INSPECT_EXPRESSION = `(() => {
    const stopBtn = document.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label*="Stop"]');
    const sendBtn = document.querySelector('[data-testid="send-button"], button[aria-label="Send prompt"]');
    const composer = document.querySelector('#prompt-textarea, [contenteditable="true"]');
    const authEl = document.querySelector('[data-testid="profile-button"], img[alt="User"]');
    const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
    const lastAssistant = assistants[assistants.length - 1];
    const lastText = lastAssistant?.innerText?.trim() || null;
    const modelEl = document.querySelector('[data-testid="model-switcher"] span, button[aria-haspopup="menu"] > div > span');
    const convMatch = window.location.pathname.match(/\\/c\\/([a-f0-9-]+)/);
    return JSON.stringify({
        stopExists: !!stopBtn,
        sendExists: !!sendBtn,
        promptReady: !!(sendBtn || (composer && !stopBtn)),
        authenticated: !!authEl,
        assistantCount: assistants.length,
        lastAssistantText: lastText,
        lastAssistantSnippet: lastText ? lastText.slice(0, 200) : null,
        modelLabel: modelEl?.textContent?.trim() || null,
        conversationId: convMatch ? convMatch[1] : null,
        fingerprint: lastText ? String(assistants.length) + ':' + String(lastText.length) : null,
    });
})()`;

/**
 * Classify tab state from inspection data.
 * @param {{ authenticated: boolean, stopExists: boolean, sendExists: boolean, promptReady: boolean, assistantCount: number }} summary
 * @returns {'running'|'completed'|'detached'|'stalled'}
 */
export function classifyTabState(summary) {
    if (!summary.authenticated) return 'detached';
    if (summary.stopExists) return 'running';
    if (summary.sendExists || summary.promptReady || summary.assistantCount > 0) return 'completed';
    return 'detached';
}

/**
 * Inspect a single ChatGPT tab via CDP.
 * @param {number} port
 * @param {string} targetId
 * @param {{ title?: string, url?: string }} [meta]
 * @returns {Promise<TabSummary>}
 */
export async function inspectTab(port, targetId, meta = {}) {
    const CDP = (await import('chrome-remote-interface')).default;
    let client;
    try {
        client = await CDP({ port, target: targetId });
        await client.Runtime.enable();
        const { result } = await client.Runtime.evaluate({
            expression: INSPECT_EXPRESSION,
            returnByValue: true,
        });
        const data = result?.value ? JSON.parse(result.value) : {};
        const state = classifyTabState(data);
        return {
            targetId,
            title: meta.title || '',
            url: meta.url || '',
            vendor: 'chatgpt',
            modelLabel: data.modelLabel || null,
            stopExists: !!data.stopExists,
            sendExists: !!data.sendExists,
            promptReady: !!data.promptReady,
            authenticated: !!data.authenticated,
            assistantCount: data.assistantCount || 0,
            lastAssistantText: data.lastAssistantText || null,
            lastAssistantSnippet: data.lastAssistantSnippet || null,
            conversationId: data.conversationId || null,
            fingerprint: data.fingerprint || null,
            state,
        };
    } finally {
        if (client) await client.close().catch(() => undefined);
    }
}

/**
 * Harvest assistant markdown from a ChatGPT tab.
 * @param {number} port
 * @param {string} targetId
 * @param {{ stallWindowMs?: number, title?: string, url?: string }} [opts]
 * @returns {Promise<TabSummary & { lastAssistantMarkdown?: string }>}
 */
export async function harvestTab(port, targetId, { stallWindowMs, title, url } = {}) {
    let summary = await inspectTab(port, targetId, { title, url });

    if (summary.state === 'running' && stallWindowMs && stallWindowMs > 0) {
        await new Promise(r => setTimeout(r, stallWindowMs));
        const after = await inspectTab(port, targetId, { title, url });
        if (after.fingerprint === summary.fingerprint) {
            summary = { ...after, state: 'stalled' };
        } else {
            summary = after;
        }
    }

    return { ...summary, lastAssistantMarkdown: summary.lastAssistantText };
}

/**
 * Collect and inspect all ChatGPT tabs.
 * @param {number} port
 * @param {{ activeTargetIds?: Set<string>, stallWindowMs?: number }} [opts]
 * @returns {Promise<(TabSummary & { inUse: boolean })[]>}
 */
export async function collectTabs(port, { activeTargetIds = new Set(), stallWindowMs = 0 } = {}) {
    const CDP = (await import('chrome-remote-interface')).default;
    const targets = await CDP.List({ port });
    const chatgptTargets = targets.filter(t =>
        t.type === 'page' && CHATGPT_HOSTS.has(new URL(t.url).hostname)
    );

    const results = [];
    for (const target of chatgptTargets) {
        const inUse = activeTargetIds.has(target.id);
        if (inUse) {
            results.push({
                targetId: target.id,
                title: target.title,
                url: target.url,
                vendor: 'chatgpt',
                modelLabel: null,
                stopExists: false,
                sendExists: false,
                promptReady: false,
                authenticated: false,
                assistantCount: 0,
                lastAssistantText: null,
                lastAssistantSnippet: null,
                conversationId: null,
                fingerprint: null,
                state: /** @type {const} */ ('completed'),
                inUse: true,
            });
            continue;
        }
        try {
            const summary = stallWindowMs > 0
                ? await harvestTab(port, target.id, { stallWindowMs, title: target.title, url: target.url })
                : await inspectTab(port, target.id, { title: target.title, url: target.url });
            results.push({ ...summary, inUse: false });
        } catch {
            continue;
        }
    }

    return results.sort((a, b) => {
        if (a.state === 'running' && b.state !== 'running') return -1;
        if (b.state === 'running' && a.state !== 'running') return 1;
        return 0;
    });
}
