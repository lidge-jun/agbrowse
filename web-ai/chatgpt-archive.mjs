// @ts-check

/**
 * @typedef {Object} ArchivePolicyResult
 * @property {boolean} shouldArchive
 * @property {string} reason
 */

/**
 * Resolve archive policy based on flag and session state.
 * @param {{ archiveFlag?: string, session: any }} opts
 * @returns {ArchivePolicyResult}
 */
export function resolveArchivePolicy({ archiveFlag = 'auto', session }) {
    if (archiveFlag === 'never') {
        return { shouldArchive: false, reason: 'archive-disabled' };
    }

    const conversationUrl = session?.conversationUrl;
    if (!conversationUrl) {
        return { shouldArchive: false, reason: 'no-conversation-url' };
    }

    if (archiveFlag === 'always') {
        return { shouldArchive: true, reason: 'archive-forced' };
    }

    if (session.followUpCount > 0) {
        return { shouldArchive: false, reason: 'multi-turn-session' };
    }
    if (session.researchMode === 'deep') {
        return { shouldArchive: false, reason: 'deep-research-session' };
    }
    if (session.projectUrl) {
        return { shouldArchive: false, reason: 'project-chat' };
    }
    if (session.status !== 'complete' && session.status !== 'completed') {
        return { shouldArchive: false, reason: 'session-not-completed' };
    }

    return { shouldArchive: true, reason: 'auto-archive-one-shot' };
}

const ARCHIVE_MENU_SELECTORS = [
    'button[data-testid="conversation-menu-trigger"]',
    'button[aria-label*="Options" i]',
    'button[aria-haspopup="menu"]',
];

const ARCHIVE_ITEM_SELECTORS = [
    '[role="menuitem"]:has-text("Archive")',
    'div[role="menuitem"]:has-text("Archive")',
    'a:has-text("Archive chat")',
];

/**
 * Archive a ChatGPT conversation via the UI.
 * @param {any} page
 * @param {{ conversationUrl: string }} opts
 * @returns {Promise<{ ok: boolean, warning?: string }>}
 */
export async function archiveConversation(page, { conversationUrl }) {
    const currentUrl = page.url();
    if (!currentUrl.includes(extractConversationId(conversationUrl) || '__never__')) {
        return { ok: false, warning: 'conversation-url-mismatch' };
    }

    for (const sel of ARCHIVE_MENU_SELECTORS) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
            await btn.click();
            await page.waitForTimeout(500);

            for (const itemSel of ARCHIVE_ITEM_SELECTORS) {
                const item = page.locator(itemSel).first();
                if (await item.isVisible().catch(() => false)) {
                    await item.click();
                    await page.waitForTimeout(1000);
                    return { ok: true };
                }
            }
            await page.keyboard.press('Escape');
            return { ok: false, warning: 'archive-menu-item-not-found' };
        }
    }

    return { ok: false, warning: 'archive-menu-trigger-not-found' };
}

/**
 * @param {string} url
 * @returns {string|null}
 */
function extractConversationId(url) {
    if (!url) return null;
    const match = url.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
}
