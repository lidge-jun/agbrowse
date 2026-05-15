// @ts-check

/** @typedef {{ id: string, detect: { cookies?: RegExp[], headers?: Record<string, RegExp>, body?: RegExp[], status?: number[] }, behavior: { jsChallengeSolvable?: boolean, interactiveCaptcha?: boolean, cookieWarmingHelps?: boolean, userSessionHelps?: boolean } }} WafProfile */

/** @type {WafProfile[]} */
export const WAF_PROFILES = [
    {
        id: 'cloudflare_managed_challenge',
        detect: {
            cookies: [/^cf_clearance$/i, /^__cf_bm$/i],
            headers: { server: /cloudflare/i, 'cf-ray': /.+/ },
            body: [/challenge-platform/i, /cdn-cgi\/challenge-platform/i,
                /Checking your browser/i, /Verifying you are human/i],
            status: [403, 503],
        },
        behavior: {
            jsChallengeSolvable: true,
            interactiveCaptcha: true,
            cookieWarmingHelps: false,
            userSessionHelps: true,
        },
    },
    {
        id: 'cloudflare_turnstile',
        detect: {
            body: [/challenges\.cloudflare\.com\/turnstile/i, /cf-turnstile/i],
        },
        behavior: {
            jsChallengeSolvable: false,
            interactiveCaptcha: true,
            userSessionHelps: true,
        },
    },
    {
        id: 'akamai_bot_manager',
        detect: {
            cookies: [/^_abck$/i, /^bm_sz$/i, /^ak_bmsc$/i],
            body: [/akamai/i, /sensor_data/i],
        },
        behavior: {
            jsChallengeSolvable: false,
            interactiveCaptcha: false,
            userSessionHelps: true,
        },
    },
    {
        id: 'datadome',
        detect: {
            cookies: [/^datadome$/i],
            body: [/datadome/i, /dd\.js/i],
        },
        behavior: {
            jsChallengeSolvable: false,
            interactiveCaptcha: true,
            userSessionHelps: true,
        },
    },
    {
        id: 'perimeterx',
        detect: {
            cookies: [/^_px\d?$/i, /^_pxhd$/i],
            body: [/perimeterx/i, /human-challenge/i],
        },
        behavior: {
            jsChallengeSolvable: false,
            interactiveCaptcha: true,
            userSessionHelps: true,
        },
    },
    {
        id: 'incapsula',
        detect: {
            cookies: [/^incap_ses_/i, /^visid_incap_/i],
            headers: { 'x-cdn': /Incapsula/i },
            body: [/incapsula/i],
        },
        behavior: {
            jsChallengeSolvable: true,
            interactiveCaptcha: false,
            userSessionHelps: true,
        },
    },
    {
        id: 'aws_waf',
        detect: {
            headers: { 'x-amzn-waf-action': /.+/ },
            body: [/aws-waf-token/i],
            status: [403],
        },
        behavior: {
            jsChallengeSolvable: false,
            interactiveCaptcha: false,
            userSessionHelps: false,
        },
    },
];

/**
 * @param {string} id
 */
export function getProfileById(id) {
    return WAF_PROFILES.find(p => p.id === id) || null;
}

/**
 * @param {WafProfile} profile
 * @param {{ cookies?: string[], headers?: Record<string, string>, body?: string, status?: number }} signals
 */
export function scoreProfile(profile, signals) {
    let score = 0;
    const detect = profile.detect;
    if (detect.cookies && signals.cookies) {
        for (const pattern of detect.cookies) {
            if (signals.cookies.some(c => pattern.test(c))) score += 2;
        }
    }
    if (detect.headers && signals.headers) {
        for (const [key, pattern] of Object.entries(detect.headers)) {
            const value = signals.headers[key] || signals.headers[key.toLowerCase()] || '';
            if (pattern.test(value)) score += 2;
        }
    }
    if (detect.body && signals.body) {
        const bodySlice = signals.body.substring(0, 50000);
        for (const pattern of detect.body) {
            if (pattern.test(bodySlice)) score += 3;
        }
    }
    if (detect.status && signals.status) {
        if (detect.status.includes(signals.status)) score += 1;
    }
    return score;
}
