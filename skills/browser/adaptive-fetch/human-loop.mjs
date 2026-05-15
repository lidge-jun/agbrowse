// @ts-check

import { navigateInUserSession } from './browser-session.mjs';

const DEFAULT_HUMAN_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * @param {string} url
 * @param {{ interactive?: boolean, browserSession?: string, browserSessionRaw?: string, browserDeps?: any, timeoutMs?: number, humanTimeoutMs?: number, selector?: string|null, allowPrivateNetwork?: boolean }} options
 * @param {{ type?: string|null, primary?: any }} challengeInfo
 * @returns {Promise<{ ok: boolean, verdict?: string, source?: string, finalUrl?: string, title?: string, text?: string, contentType?: string, status?: number, session?: string, evidence?: string[], warnings?: string[], safetyFlags?: string[], humanActionNeeded?: boolean, actionMessage?: string }>}
 */
export async function humanResolve(url, options, challengeInfo) {
    const rawSession = options.browserSessionRaw || options.browserSession;
    if (!options.interactive && rawSession !== 'interactive') {
        return {
            ok: false,
            verdict: challengeInfo.type || 'challenge',
            humanActionNeeded: true,
            actionMessage: formatNonInteractiveMessage(challengeInfo, url),
        };
    }

    const message = formatChallengeMessage(challengeInfo, url);
    await presentToUser(message);
    await waitForUserSignal(options.humanTimeoutMs || DEFAULT_HUMAN_TIMEOUT_MS);

    const result = await navigateInUserSession(url, options);
    return {
        ...result,
        source: 'human_resolved',
        safetyFlags: ['user_session_used', 'human_action_taken'],
    };
}

/**
 * @param {{ type?: string|null, primary?: any }} challengeInfo
 * @param {string} url
 * @returns {string}
 */
function formatChallengeMessage(challengeInfo, url) {
    switch (challengeInfo.type) {
        case 'challenge': {
            const waf = challengeInfo.primary?.profile?.id ?? 'unknown';
            return [
                `Challenge detected at ${url}`,
                `Type: ${waf}`,
                `Action: Open this URL in your browser and solve the challenge.`,
                `Press Enter when done.`,
            ].join('\n');
        }
        case 'auth_required':
            return [
                `Login required at ${url}`,
                `Action: Log in via your browser.`,
                `Press Enter when done.`,
            ].join('\n');
        case 'paywall':
            return [
                `Paywall detected at ${url}`,
                `Action: If you have a subscription, ensure you're logged in.`,
                `Press Enter to read with your session, or Ctrl+C to skip.`,
            ].join('\n');
        default:
            return `Obstacle at ${url}. Open in your browser, resolve it, then press Enter.`;
    }
}

/**
 * @param {{ type?: string|null }} challengeInfo
 * @param {string} url
 * @returns {string}
 */
function formatNonInteractiveMessage(challengeInfo, url) {
    const type = challengeInfo.type || 'obstacle';
    return `${type} detected at ${url}. Run with --browser-session interactive to resolve.`;
}

/**
 * @param {string} message
 * @returns {Promise<void>}
 */
async function presentToUser(message) {
    process.stderr.write('\n' + message + '\n');
}

/**
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForUserSignal(timeoutMs) {
    return new Promise((resolve, reject) => {
        if (!process.stdin.readable) {
            resolve(undefined);
            return;
        }
        const timer = setTimeout(() => {
            process.stdin.removeListener('data', onData);
            reject(new Error(`human-loop timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        /** @param {any} _data */
        function onData(_data) {
            clearTimeout(timer);
            resolve(undefined);
        }
        process.stdin.once('data', onData);
    });
}
