// @ts-check
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG_NAMES = Object.freeze([
    'repomix.config.ts',
    'repomix.config.mts',
    'repomix.config.cts',
    'repomix.config.js',
    'repomix.config.mjs',
    'repomix.config.cjs',
    'repomix.config.json5',
    'repomix.config.jsonc',
    'repomix.config.json',
]);

/**
 * @typedef {{
 *   cwd:string,
 *   stagingRoot:string,
 *   managedRoot:string|null,
 *   entryPath:string,
 *   explicitFiles:string[]|null,
 *   contextExclude:string[],
 *   maxFileSize?:number|string,
 * }} RunnerRequest
 *
 * @typedef {{
 *   loadFileConfig: Function,
 *   mergeConfigs: Function,
 *   pack: Function,
 *   setLogLevel: Function,
 * }} RepomixApi
 */

/** @param {RunnerRequest} request */
export async function runRepomixJob(request) {
    const repomix = await import(pathToFileURL(request.entryPath).href);
    assertRepomixApi(repomix);
    const api = /** @type {RepomixApi} */ (repomix);
    api.setLogLevel(-1);

    const configPath = await findConfigPath(request.cwd);
    try {
        // Let the active Repomix version own config discovery semantics. The
        // parallel path lookup is provenance only and never forces a filename.
        const fileConfig = await api.loadFileConfig(request.cwd, null);
        const config = await api.mergeConfigs(request.cwd, fileConfig, { enableFileProcessors: true });
        const configuredOutputPath = String(config.output.filePath);
        const outputName = safeOutputBasename(configuredOutputPath);
        const stagedOutputPath = join(request.stagingRoot, outputName);
        const managedIgnorePattern = await buildManagedIgnorePattern(request);
        config.output = {
            ...config.output,
            filePath: stagedOutputPath,
            copyToClipboard: false,
            stdout: false,
        };
        config.ignore = {
            ...config.ignore,
            customPatterns: mergedIgnorePatterns(config, request, configuredOutputPath, managedIgnorePattern),
        };
        if (request.explicitFiles !== null) config.include = [];
        if (request.maxFileSize !== undefined) {
            config.input = {
                ...config.input,
                maxFileSize: parseMaxFileSize(request.maxFileSize),
            };
        }

        const emptySelectionDeps = request.explicitFiles?.length === 0
            ? { searchFiles: async () => ({ filePaths: [], emptyDirPaths: [] }) }
            : {};
        const packResult = await api.pack(
            [request.cwd],
            config,
            () => {},
            emptySelectionDeps,
            request.explicitFiles === null ? undefined : request.explicitFiles,
        );
        enforceTokenBudget(packResult, config);

        const outputFiles = Array.isArray(packResult.outputFiles)
            ? packResult.outputFiles
            : [config.output.filePath];
        if (outputFiles.length === 0 || !outputFiles.every((/** @type {unknown} */ path) => typeof path === 'string')) {
            throw new TypeError('Repomix pack() returned invalid outputFiles');
        }
        const artifactPaths = outputFiles.map((/** @type {string} */ path) => resolve(config.cwd, path));
        return {
            artifactPaths,
            configPath,
            configuredOutputPath,
            totalFiles: finiteMetric(packResult.totalFiles, 'totalFiles'),
            totalCharacters: finiteMetric(packResult.totalCharacters, 'totalCharacters'),
            totalTokens: finiteMetric(packResult.totalTokens, 'totalTokens'),
            warnings: buildPackWarnings(packResult),
        };
    } catch (error) {
        attachConfigPathEvidence(error, configPath);
        throw error;
    }
}

/** @param {Record<string, unknown>} repomix */
function assertRepomixApi(repomix) {
    const required = ['loadFileConfig', 'mergeConfigs', 'pack', 'setLogLevel'];
    const missing = required.filter(name => typeof repomix[name] !== 'function');
    if (missing.length) {
        throw new TypeError(`incompatible Repomix package API: missing ${missing.join(', ')}`);
    }
}

/** @param {unknown} error @param {string|null} configPath */
function attachConfigPathEvidence(error, configPath) {
    if (!error || typeof error !== 'object') return;
    const record = /** @type {Record<string, any>} */ (error);
    const details = record.details && typeof record.details === 'object'
        ? record.details
        : {};
    record.details = { ...details, configPath };
}

/** @param {string} cwd */
async function findConfigPath(cwd) {
    const local = await firstConfigFile(cwd);
    if (local) return local;
    return firstConfigFile(globalConfigDirectory());
}

/** @param {string} directory */
async function firstConfigFile(directory) {
    for (const name of CONFIG_NAMES) {
        const candidate = join(directory, name);
        try {
            if ((await fs.stat(candidate)).isFile()) return candidate;
        } catch {
            // Match Repomix discovery: unavailable candidates are skipped.
        }
    }
    return null;
}

function globalConfigDirectory() {
    if (process.platform === 'win32') {
        return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Repomix');
    }
    if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'repomix');
    return join(homedir(), '.config', 'repomix');
}

/** @param {any} config @param {RunnerRequest} request @param {string} configuredOutputPath @param {string|null} managedIgnorePattern */
function mergedIgnorePatterns(config, request, configuredOutputPath, managedIgnorePattern) {
    const patterns = [
        ...(Array.isArray(config.ignore?.customPatterns) ? config.ignore.customPatterns : []),
        ...request.contextExclude.map(String).filter(Boolean),
    ];
    if (managedIgnorePattern) patterns.push(managedIgnorePattern);
    const configuredAbsolutePath = resolve(request.cwd, configuredOutputPath);
    if (isPathWithin(request.cwd, configuredAbsolutePath)) {
        const configuredRelativePath = toPosix(relative(request.cwd, configuredAbsolutePath));
        if (configuredRelativePath) {
            patterns.push(escapeGlobLiteral(configuredRelativePath));
            const extension = extname(configuredRelativePath);
            const stem = extension
                ? configuredRelativePath.slice(0, -extension.length)
                : configuredRelativePath;
            patterns.push(`${escapeGlobLiteral(stem)}.+([0-9])${escapeGlobLiteral(extension)}`);
        }
    }
    return [...new Set(patterns)];
}

/** @param {RunnerRequest} request */
async function buildManagedIgnorePattern(request) {
    if (!request.managedRoot) return null;
    const [realCwd, realManagedRoot, realStagingRoot] = await Promise.all([
        fs.realpath(request.cwd),
        fs.realpath(request.managedRoot),
        fs.realpath(request.stagingRoot),
    ]);
    if (!isPathWithin(realCwd, realManagedRoot)) return null;
    const managedRelativePath = toPosix(relative(realCwd, realManagedRoot));
    if (managedRelativePath) {
        // Repomix may be run from $HOME or another ancestor of agbrowse's
        // retained package directory. Never feed prior context artifacts back
        // into a later pack.
        return `${escapeGlobLiteral(managedRelativePath)}/**`;
    }
    const stagingRelativePath = toPosix(relative(realCwd, realStagingRoot));
    return stagingRelativePath ? `${escapeGlobLiteral(stagingRelativePath)}/**` : null;
}

/** @param {number|string} value */
function parseMaxFileSize(value) {
    if (typeof value === 'number') {
        if (Number.isSafeInteger(value) && value > 0) return value;
        throw new TypeError(`invalid maxFileSize: ${value}`);
    }
    const raw = String(value).trim();
    if (/^\d+$/.test(raw)) {
        const bytes = Number(raw);
        if (Number.isSafeInteger(bytes) && bytes > 0) return bytes;
    }
    const match = /^(\d+(?:\.\d+)?)\s*(kb|mb)$/i.exec(raw);
    if (!match) throw new TypeError(`invalid maxFileSize: ${value}`);
    const multiplier = match[2].toLowerCase() === 'kb' ? 1024 : 1024 * 1024;
    const bytes = Math.floor(Number(match[1]) * multiplier);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new TypeError(`invalid maxFileSize: ${value}`);
    return bytes;
}

/** @param {any} packResult @param {any} config */
function enforceTokenBudget(packResult, config) {
    const budget = config.output?.tokenBudget;
    if (budget === undefined) return;
    if (Number(packResult.totalTokens) <= Number(budget)) return;
    const error = new Error(`Repomix output exceeds token budget: ${packResult.totalTokens}/${budget}`);
    Object.assign(error, {
        code: 'REPOMIX_TOKEN_BUDGET_EXCEEDED',
        details: { totalTokens: packResult.totalTokens, tokenBudget: budget },
    });
    throw error;
}

/** @param {any} packResult */
function buildPackWarnings(packResult) {
    /** @type {string[]} */
    const warnings = [];
    appendSecurityWarning(warnings, packResult.suspiciousFilesResults, 'source file', 'excluded');
    appendSecurityWarning(warnings, packResult.suspiciousGitDiffResults, 'Git diff item', 'included');
    appendSecurityWarning(warnings, packResult.suspiciousGitLogResults, 'Git log item', 'included');

    const skipped = Array.isArray(packResult.skippedFiles) ? packResult.skippedFiles : [];
    /** @type {Map<string, string[]>} */
    const skippedByReason = new Map();
    for (const item of skipped) {
        const reason = String(item?.reason || 'unknown');
        const paths = skippedByReason.get(reason) || [];
        paths.push(String(item?.path || 'unknown'));
        skippedByReason.set(reason, paths);
    }
    for (const [reason, paths] of skippedByReason) {
        warnings.push(`repomix skipped ${paths.length} file(s) (${reason}): ${paths.join(', ')}`);
    }
    return warnings;
}

/** @param {string[]} warnings @param {any} results @param {string} label @param {'excluded'|'included'} disposition */
function appendSecurityWarning(warnings, results, label, disposition) {
    if (!Array.isArray(results) || results.length === 0) return;
    const paths = results.map(result => String(result?.filePath || 'unknown'));
    warnings.push(`repomix security: ${results.length} suspicious ${label}(s) ${disposition}: ${paths.join(', ')}`);
}

/** @param {unknown} value @param {string} name */
function finiteMetric(value, name) {
    if (!Number.isFinite(value)) throw new TypeError(`Repomix pack() returned invalid ${name}`);
    return Number(value);
}

/** @param {string} filePath */
function safeOutputBasename(filePath) {
    const name = basename(filePath);
    if (
        !name ||
        name === '.' ||
        name === '..' ||
        name.includes('\0') ||
        name.includes('/') ||
        (process.platform === 'win32' && name.includes('\\'))
    ) {
        throw new TypeError(`invalid configured Repomix output filename: ${filePath}`);
    }
    return name;
}

/** @param {string} root @param {string} candidate */
function isPathWithin(root, candidate) {
    const fromRoot = relative(resolve(root), resolve(candidate));
    return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

/** @param {string} value */
function toPosix(value) {
    return value.split(sep).join('/');
}

/** @param {string} value */
function escapeGlobLiteral(value) {
    return value.replace(/[\\!*?{}()[\]]/g, '\\$&');
}

/** @param {unknown} error */
function serializeError(error) {
    const record = error && typeof error === 'object'
        ? /** @type {Record<string, unknown>} */ (error)
        : {};
    return {
        name: typeof record.name === 'string' ? record.name : 'Error',
        message: typeof record.message === 'string' ? record.message : String(error),
        stack: typeof record.stack === 'string' ? record.stack : undefined,
        code: record.code,
        details: record.details,
    };
}

/** @param {unknown} payload @param {number} exitCode */
function sendAndExit(payload, exitCode) {
    if (typeof process.send !== 'function') {
        process.exit(exitCode);
        return;
    }
    process.send(payload, error => process.exit(error ? 1 : exitCode));
}

if (process.env.AGBROWSE_REPOMIX_RUNNER === '1' && typeof process.send === 'function') {
    process.once('message', message => {
        const envelope = message && typeof message === 'object'
            ? /** @type {Record<string, any>} */ (message)
            : {};
        if (envelope.type !== 'agbrowse-repomix-run') return;
        Promise.resolve()
            .then(() => runRepomixJob(envelope.request))
            .then(value => sendAndExit({ type: 'agbrowse-repomix-result', ok: true, value }, 0))
            .catch(error => sendAndExit({ type: 'agbrowse-repomix-result', ok: false, error: serializeError(error) }, 0));
    });
}
