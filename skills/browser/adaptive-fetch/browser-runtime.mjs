// @ts-check

export class BrowserRequiredError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        this.name = 'BrowserRequiredError';
        this.code = 'browser_required';
    }
}

/**
 * @param {{ browserDeps?: any, browserSession?: 'none'|'isolated'|'existing' }} [options]
 */
export async function getFetchBrowserPage(options = {}) {
    const deps = options.browserDeps || {};
    if (options.browserSession === 'none') {
        throw new BrowserRequiredError('browser session mode is none');
    }
    if (options.browserSession === 'existing') {
        if (typeof deps.getPage !== 'function') throw new BrowserRequiredError('browser getPage dependency is unavailable');
        return { page: await deps.getPage(), cleanup: async () => undefined, isolated: false };
    }
    if (typeof deps.createIsolatedPage === 'function') {
        return deps.createIsolatedPage();
    }
    throw new BrowserRequiredError('isolated browser page dependency is unavailable');
}

/**
 * @param {{ cleanup?: () => Promise<void>|void }} pageRef
 */
export async function closeFetchBrowserPage(pageRef) {
    if (typeof pageRef?.cleanup === 'function') await pageRef.cleanup();
}
