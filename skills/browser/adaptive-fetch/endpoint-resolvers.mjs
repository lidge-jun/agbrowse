// @ts-check

/**
 * @param {string|URL} rawUrl
 */
export function resolvePublicEndpointCandidates(rawUrl) {
    const url = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
    return [
        ...githubCandidates(url),
        ...redditCandidates(url),
        ...hackerNewsCandidates(url),
        ...wikipediaCandidates(url),
        ...registryCandidates(url),
        ...arxivCandidates(url),
    ];
}

/**
 * @param {URL} url
 */
function githubCandidates(url) {
    if (url.hostname !== 'github.com') return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 5 && parts[2] === 'blob') {
        const [owner, repo, , branch, ...pathParts] = parts;
        return [{
            label: 'github-raw',
            url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts.join('/')}`,
            source: 'public_endpoint',
        }];
    }
    if (parts.length >= 2) {
        return [{
            label: 'github-repo-api',
            url: `https://api.github.com/repos/${parts[0]}/${parts[1]}`,
            source: 'public_endpoint',
        }];
    }
    return [];
}

/**
 * @param {URL} url
 */
function redditCandidates(url) {
    if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return [];
    if (url.pathname.endsWith('.json')) return [];
    const clone = new URL(url.href);
    clone.pathname = clone.pathname.replace(/\/?$/, '.json');
    return [{ label: 'reddit-json', url: clone.href, source: 'public_endpoint' }];
}

/**
 * @param {URL} url
 */
function hackerNewsCandidates(url) {
    if (url.hostname !== 'news.ycombinator.com') return [];
    const id = url.searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) return [];
    return [{
        label: 'hacker-news-item-api',
        url: `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function wikipediaCandidates(url) {
    const match = url.hostname.match(/^([a-z-]+)\.wikipedia\.org$/i);
    if (!match) return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'wiki' || !parts[1]) return [];
    return [{
        label: 'wikipedia-summary-api',
        url: `https://${match[1]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(parts.slice(1).join('/'))}`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function registryCandidates(url) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'www.npmjs.com' && parts[0] === 'package' && parts[1]) {
        return [{ label: 'npm-registry', url: `https://registry.npmjs.org/${encodeURIComponent(parts[1])}`, source: 'public_endpoint' }];
    }
    if (url.hostname === 'pypi.org' && parts[0] === 'project' && parts[1]) {
        return [{ label: 'pypi-json', url: `https://pypi.org/pypi/${encodeURIComponent(parts[1])}/json`, source: 'public_endpoint' }];
    }
    return [];
}

/**
 * @param {URL} url
 */
function arxivCandidates(url) {
    if (url.hostname !== 'arxiv.org') return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'abs' || !parts[1]) return [];
    return [{ label: 'arxiv-api', url: `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(parts[1])}`, source: 'public_endpoint' }];
}

