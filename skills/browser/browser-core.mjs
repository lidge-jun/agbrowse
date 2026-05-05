// @ts-check

/**
 * @typedef {Object} AriaYamlNode
 * @property {string} ref
 * @property {string} role
 * @property {string} name
 * @property {number} depth
 */

/**
 * @typedef {Object} CdpAxValue
 * @property {string} [value]
 */

/**
 * @typedef {Object} CdpAxNode
 * @property {string} nodeId
 * @property {string} [parentId]
 * @property {boolean} [ignored]
 * @property {CdpAxValue} [role]
 * @property {CdpAxValue} [name]
 * @property {CdpAxValue} [value]
 */

/**
 * @typedef {Object} ParsedAxNode
 * @property {string} ref
 * @property {string} role
 * @property {string} name
 * @property {number} depth
 * @property {string} [value]
 */

/**
 * @typedef {Object} AnnotatedAxNode
 * @property {string} ref
 * @property {string} role
 * @property {string} [name]
 * @property {number} depth
 * @property {string} [value]
 * @property {number} occurrence
 */

/**
 * @typedef {Object} HttpRequestRecord
 * @property {string} url
 * @property {string} method
 * @property {string} [type]
 * @property {string} [source]
 */

/**
 * @param {string} yaml
 * @returns {AriaYamlNode[]}
 */
export function parseAriaYaml(yaml) {
    /** @type {AriaYamlNode[]} */
    const nodes = [];
    let counter = 0;
    for (const line of yaml.split('\n')) {
        if (!line.trim() || !line.includes('-')) continue;
        const indent = line.search(/\S/);
        const depth = Math.floor(indent / 2);
        const match = line.match(/-\s+(\w+)(?:\s+"([^"]*)")?/);
        if (!match) continue;
        counter++;
        const role = match[1];
        const name = match[2] || '';
        nodes.push({ ref: `e${counter}`, role, name, depth });
    }
    return nodes;
}

/**
 * @param {CdpAxNode[]} axNodes
 * @returns {ParsedAxNode[]}
 */
export function parseCdpAxTree(axNodes) {
    /** @type {ParsedAxNode[]} */
    const nodes = [];
    let counter = 0;
    /** @type {Record<string, number>} */
    const depthMap = {};
    for (const node of axNodes) {
        const parentDepth = node.parentId ? (depthMap[node.parentId] ?? 0) : -1;
        const depth = parentDepth + 1;
        depthMap[node.nodeId] = depth;
        const role = node.role?.value || 'unknown';
        const name = node.name?.value || '';
        const value = node.value?.value || '';
        if (node.ignored) continue;
        counter++;
        nodes.push({
            ref: `e${counter}`,
            role,
            name,
            ...(value ? { value } : {}),
            depth,
        });
    }
    return nodes;
}

/**
 * @template {{ role: string, name?: string }} T
 * @param {T[]} nodes
 * @returns {Array<T & { occurrence: number }>}
 */
export function annotateNodeOccurrences(nodes) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    return nodes.map(node => {
        const key = `${node.role}\u0000${node.name ?? ''}`;
        const occurrence = counts.get(key) ?? 0;
        counts.set(key, occurrence + 1);
        return { ...node, occurrence };
    });
}

/**
 * @param {HttpRequestRecord[]} requests
 * @param {string|null|undefined} filter
 * @returns {HttpRequestRecord[]}
 */
export function filterRequests(requests, filter) {
    if (!filter) return requests;
    return requests.filter(request => request.url.includes(filter));
}

/**
 * @param {HttpRequestRecord[]} requests
 * @returns {HttpRequestRecord[]}
 */
export function dedupeRequests(requests) {
    /** @type {Set<string>} */
    const seen = new Set();
    return requests.filter(request => {
        const key = `${request.method}:${request.type || ''}:${request.url}:${request.source || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
