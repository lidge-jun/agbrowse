// @ts-check
import { fork } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebAiError } from '../errors.mjs';
import { languageFromPath } from './renderer.mjs';
import { estimateTokens } from './token-estimator.mjs';

export const CONTEXT_TRANSFORM_MODES = Object.freeze(/** @type {const} */ (['raw', 'repomix']));

const RUNNER_PATH = fileURLToPath(new URL('./repomix-runner.mjs', import.meta.url));
const CHILD_OUTPUT_LIMIT = 32 * 1024;

/**
 * @typedef {{
 *   version: string,
 *   source: 'project-local'|'path',
 *   packagePath: string,
 *   entryPath: string,
 * }} RepomixProvenance
 *
 * @typedef {{
 *   artifactPaths: string[],
 *   configPath: string|null,
 *   configResolution: 'repomix-auto',
 *   configuredOutputPath: string,
 *   totalFiles: number,
 *   totalCharacters: number,
 *   totalTokens: number,
 *   warnings: string[],
 * }} RepomixRunnerResult
 *
 * @typedef {{
 *   cwd: string,
 *   stagingRoot: string,
 *   managedRoot?: string,
 *   explicitFiles?: string[]|null,
 *   contextExclude?: string[],
 *   maxFileSize?: number|string,
 * }} BuildRepomixArtifactsOptions
 */

/**
 * @param {unknown} [mode]
 * @returns {'raw'|'repomix'}
 */
export function normalizeContextTransformMode(mode) {
    const supplied = mode == null ? 'raw' : String(mode).trim();
    const normalized = supplied.toLowerCase();
    if (normalized === 'raw' || normalized === 'repomix') return normalized;
    throw new WebAiError({
        errorCode: 'context.transform-invalid',
        stage: 'context-transform',
        retryHint: 'use-supported-transform',
        message: `unsupported context transform: ${supplied}. Supported values: ${CONTEXT_TRANSFORM_MODES.join(', ')}`,
        evidence: {
            supplied: mode,
            supported: [...CONTEXT_TRANSFORM_MODES],
        },
    });
}

/**
 * Build Repomix output in an existing, caller-owned staging directory.
 * @param {BuildRepomixArtifactsOptions} options
 */
export async function buildRepomixArtifacts(options) {
    const cwd = resolve(options?.cwd || process.cwd());
    const stagingRoot = typeof options?.stagingRoot === 'string' && options.stagingRoot.trim()
        ? resolve(options.stagingRoot)
        : '';
    const managedRoot = typeof options?.managedRoot === 'string' && options.managedRoot.trim()
        ? resolve(options.managedRoot)
        : null;
    /** @type {RepomixProvenance|undefined} */
    let provenance;

    try {
        if (!stagingRoot) throw new TypeError('stagingRoot is required');
        if (options.explicitFiles != null && !Array.isArray(options.explicitFiles)) {
            throw new TypeError('explicitFiles must be an array or null');
        }
        if (options.contextExclude != null && !Array.isArray(options.contextExclude)) {
            throw new TypeError('contextExclude must be an array');
        }

        const [cwdStat, realCwd, realStagingRoot, realManagedRoot] = await Promise.all([
            fs.stat(cwd),
            fs.realpath(cwd),
            fs.realpath(stagingRoot),
            managedRoot ? fs.realpath(managedRoot) : null,
        ]);
        if (!cwdStat.isDirectory()) throw new TypeError(`cwd is not a directory: ${cwd}`);
        const stagingStat = await fs.stat(realStagingRoot);
        if (!stagingStat.isDirectory()) throw new TypeError(`stagingRoot is not a directory: ${stagingRoot}`);
        if (realManagedRoot && !isPathWithin(realManagedRoot, realStagingRoot)) {
            throw new TypeError(`stagingRoot is outside managedRoot: ${stagingRoot}`);
        }

        provenance = await resolveRepomixPackage(cwd);
        const explicitFiles = await resolveExplicitFilesWithinCwd(
            cwd,
            realCwd,
            options.explicitFiles ?? null,
        );
        assertExplicitFileSupport(provenance, explicitFiles);
        const runnerResult = await runRepomixChild({
            cwd,
            stagingRoot,
            managedRoot: realManagedRoot,
            entryPath: provenance.entryPath,
            explicitFiles,
            contextExclude: (options.contextExclude || []).map(String),
            maxFileSize: options.maxFileSize,
        });
        const artifacts = await readValidatedArtifacts(runnerResult.artifactPaths, realStagingRoot);

        return {
            artifacts,
            repomix: {
                version: provenance.version,
                source: provenance.source,
                packagePath: provenance.packagePath,
                entryPath: provenance.entryPath,
                configPath: runnerResult.configPath,
                configResolution: runnerResult.configResolution,
                configuredOutputPath: runnerResult.configuredOutputPath,
                totalFiles: runnerResult.totalFiles,
                totalCharacters: runnerResult.totalCharacters,
                totalTokens: runnerResult.totalTokens,
            },
            warnings: runnerResult.warnings,
        };
    } catch (cause) {
        if (cause instanceof WebAiError && cause.errorCode === 'context.symlink-rejected') throw cause;
        const reason = errorMessage(cause);
        throw new WebAiError({
            errorCode: 'context.transform-failed',
            stage: 'context-transform',
            retryHint: 'install-compatible-repomix',
            message: `repomix context transform failed: ${reason}`,
            evidence: {
                cwd,
                stagingRoot: stagingRoot || options?.stagingRoot,
                explicitFileCount: Array.isArray(options?.explicitFiles) ? options.explicitFiles.length : null,
                reason,
                ...(provenance ? { repomix: provenance } : {}),
                ...remoteEvidence(cause),
            },
            cause,
        });
    }
}

/**
 * Repomix added the public explicitFiles pack() argument in v1.0.0. Older
 * versions silently ignore the extra positional argument and can pack cwd,
 * so fail before config evaluation whenever agbrowse promised a selector cap.
 * @param {RepomixProvenance} provenance
 * @param {string[]|null} explicitFiles
 */
function assertExplicitFileSupport(provenance, explicitFiles) {
    if (explicitFiles === null) return;
    const majorMatch = /^(\d+)\./.exec(String(provenance.version).trim());
    const major = majorMatch ? Number(majorMatch[1]) : null;
    if (major !== null && major >= 1) return;
    throw new TypeError(
        `explicit context selectors require Repomix >= 1.0.0; installed ${provenance.version}`,
    );
}

/**
 * Resolve the explicit upper-bound set and reject lexical or symlink escapes
 * at the transform boundary, before Repomix config or processors execute.
 * @param {string} cwd
 * @param {string} realCwd
 * @param {string[]|null} files
 */
async function resolveExplicitFilesWithinCwd(cwd, realCwd, files) {
    if (files === null) return null;
    const resolvedFiles = files.map(file => resolve(cwd, String(file)));
    for (const filePath of resolvedFiles) {
        const realPath = await fs.realpath(filePath);
        if (!isPathWithin(realCwd, realPath)) {
            throw new WebAiError({
                errorCode: 'context.symlink-rejected',
                stage: 'context-preflight',
                retryHint: 'path-list',
                message: `repomix context file resolves outside cwd: ${filePath}`,
                evidence: { cwd: realCwd, path: filePath, realPath },
            });
        }
    }
    return resolvedFiles;
}

/** @param {string} cwd @returns {Promise<RepomixProvenance>} */
async function resolveRepomixPackage(cwd) {
    const requireFromCwd = createRequire(join(cwd, 'package.json'));
    try {
        const entryPath = requireFromCwd.resolve('repomix');
        return await packageFromEntry(entryPath, 'project-local');
    } catch (error) {
        if (!isModuleNotFound(error)) throw error;
    }

    const executablePath = await findPathExecutable('repomix', cwd);
    if (!executablePath) {
        throw new Error('Repomix was not found from the project or PATH');
    }
    const fromPath = await packageFromExecutable(executablePath);
    if (!fromPath) {
        throw new Error(`PATH Repomix is not backed by a resolvable npm package: ${executablePath}`);
    }
    return fromPath;
}

/**
 * @param {string} entryPath
 * @param {'project-local'|'path'} source
 * @returns {Promise<RepomixProvenance>}
 */
async function packageFromEntry(entryPath, source) {
    const realEntryPath = await fs.realpath(entryPath);
    const packagePath = await findNamedPackageAncestor(dirname(realEntryPath));
    if (!packagePath) throw new Error(`Resolved Repomix entry has no package root: ${entryPath}`);
    const repomixPackage = await readRepomixPackage(packagePath, source, realEntryPath);
    if (!repomixPackage) throw new Error(`Invalid Repomix package root: ${packagePath}`);
    return repomixPackage;
}

/** @param {string} executablePath @returns {Promise<RepomixProvenance|null>} */
async function packageFromExecutable(executablePath) {
    const realExecutablePath = await fs.realpath(executablePath);
    const ancestor = await findNamedPackageAncestor(dirname(realExecutablePath));
    if (ancestor) return readRepomixPackage(ancestor, 'path');

    const binDirectory = dirname(executablePath);
    const candidates = [
        resolve(binDirectory, 'node_modules/repomix'),
        resolve(binDirectory, '../repomix'),
        resolve(binDirectory, '../lib/node_modules/repomix'),
        resolve(binDirectory, '../node_modules/repomix'),
    ];
    for (const candidate of candidates) {
        const repomixPackage = await readRepomixPackage(candidate, 'path');
        if (repomixPackage) return repomixPackage;
    }
    return null;
}

/**
 * @param {string} packagePath
 * @param {'project-local'|'path'} source
 * @param {string} [knownEntryPath]
 * @returns {Promise<RepomixProvenance|null>}
 */
async function readRepomixPackage(packagePath, source, knownEntryPath) {
    let packageJsonPath;
    let packageJson;
    try {
        const realPackagePath = await fs.realpath(packagePath);
        packageJsonPath = join(realPackagePath, 'package.json');
        packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        if (packageJson?.name !== 'repomix') return null;

        const entryPath = knownEntryPath || createRequire(packageJsonPath).resolve('repomix');
        const realEntryPath = await fs.realpath(entryPath);
        if (!isPathWithin(realPackagePath, realEntryPath)) {
            throw new Error(`Repomix package entry resolves outside its package root: ${realEntryPath}`);
        }
        if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
            throw new Error(`Repomix package has no valid version: ${packageJsonPath}`);
        }
        return {
            version: packageJson.version,
            source,
            packagePath: realPackagePath,
            entryPath: realEntryPath,
        };
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

/** @param {string} startDirectory @returns {Promise<string|null>} */
async function findNamedPackageAncestor(startDirectory) {
    let directory = resolve(startDirectory);
    while (true) {
        try {
            const packageJson = JSON.parse(await fs.readFile(join(directory, 'package.json'), 'utf8'));
            if (packageJson?.name === 'repomix') return directory;
        } catch (error) {
            if (!isNotFound(error) && !(error instanceof SyntaxError)) throw error;
        }
        const parent = dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
}

/** @param {string} command @param {string} cwd @returns {Promise<string|null>} */
async function findPathExecutable(command, cwd) {
    const pathValue = process.env.PATH || process.env.Path || process.env.path || '';
    const suffixes = process.platform === 'win32'
        ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
        : [''];
    for (const rawDirectory of pathValue.split(delimiter)) {
        const directory = stripOuterQuotes(rawDirectory) || cwd;
        for (const suffix of suffixes) {
            const candidate = join(directory, `${command}${suffix}`);
            try {
                const stat = await fs.stat(candidate);
                if (!stat.isFile()) continue;
                await fs.access(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
                return resolve(candidate);
            } catch {
                // Keep PATH ordering and continue to the next executable candidate.
            }
        }
    }
    return null;
}

/**
 * @param {{cwd:string,stagingRoot:string,managedRoot:string|null,entryPath:string,explicitFiles:string[]|null,contextExclude:string[],maxFileSize?:number|string}} request
 * @returns {Promise<RepomixRunnerResult>}
 */
function runRepomixChild(request) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = fork(RUNNER_PATH, [], {
            cwd: request.cwd,
            env: { ...process.env, AGBROWSE_REPOMIX_RUNNER: '1' },
            execArgv: [],
            serialization: 'json',
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        /** @type {any} */
        let response;

        child.stdout?.on('data', chunk => {
            stdout = appendLimited(stdout, chunk);
        });
        child.stderr?.on('data', chunk => {
            stderr = appendLimited(stderr, chunk);
        });
        child.on('message', message => {
            const envelope = message && typeof message === 'object'
                ? /** @type {Record<string, any>} */ (message)
                : {};
            if (envelope.type === 'agbrowse-repomix-result') {
                response = message;
            }
        });
        child.once('error', error => {
            if (settled) return;
            settled = true;
            rejectPromise(error);
        });
        child.once('exit', (code, signal) => {
            if (settled) return;
            settled = true;
            if (!response) {
                const suffix = stderr || stdout;
                rejectPromise(new Error(`Repomix runner exited without a result (code=${code}, signal=${signal})${suffix ? `: ${suffix}` : ''}`));
                return;
            }
            if (code !== 0 || signal) {
                rejectPromise(new Error(`Repomix runner exited abnormally (code=${code}, signal=${signal})`));
                return;
            }
            if (response.ok !== true) {
                rejectPromise(remoteError(response.error, stderr || stdout));
                return;
            }
            try {
                resolvePromise(validateRunnerResult(response.value));
            } catch (error) {
                rejectPromise(error);
            }
        });
        child.send({ type: 'agbrowse-repomix-run', request }, error => {
            if (!error || settled) return;
            settled = true;
            child.kill();
            rejectPromise(error);
        });
    });
}

/** @param {unknown} value @returns {RepomixRunnerResult} */
function validateRunnerResult(value) {
    if (!value || typeof value !== 'object') throw new TypeError('Repomix runner returned no result');
    const result = /** @type {Record<string, unknown>} */ (value);
    if (!Array.isArray(result.artifactPaths) || !result.artifactPaths.every(path => typeof path === 'string')) {
        throw new TypeError('Repomix runner returned invalid artifact paths');
    }
    for (const field of ['totalFiles', 'totalCharacters', 'totalTokens']) {
        if (!Number.isFinite(result[field])) throw new TypeError(`Repomix runner returned invalid ${field}`);
    }
    if (typeof result.configuredOutputPath !== 'string') {
        throw new TypeError('Repomix runner returned an invalid configured output path');
    }
    if (result.configPath !== null) {
        throw new TypeError('Repomix runner returned an invalid config path');
    }
    if (result.configResolution !== 'repomix-auto') {
        throw new TypeError('Repomix runner returned an invalid config resolution');
    }
    return /** @type {RepomixRunnerResult} */ ({
        artifactPaths: result.artifactPaths,
        configPath: null,
        configResolution: result.configResolution,
        configuredOutputPath: result.configuredOutputPath,
        totalFiles: result.totalFiles,
        totalCharacters: result.totalCharacters,
        totalTokens: result.totalTokens,
        warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    });
}

/** @param {string[]} artifactPaths @param {string} realStagingRoot */
async function readValidatedArtifacts(artifactPaths, realStagingRoot) {
    const seen = new Set();
    const artifacts = [];
    for (const artifactPath of artifactPaths) {
        const candidate = resolve(artifactPath);
        const lstat = await fs.lstat(candidate);
        if (!lstat.isFile()) throw new TypeError(`Repomix artifact is not a regular file: ${candidate}`);
        const realPath = await fs.realpath(candidate);
        if (!isPathWithin(realStagingRoot, realPath)) {
            throw new TypeError(`Repomix artifact escaped stagingRoot: ${candidate}`);
        }
        if (seen.has(realPath)) throw new TypeError(`Repomix returned a duplicate artifact: ${candidate}`);
        seen.add(realPath);

        const buffer = await fs.readFile(realPath);
        const content = buffer.toString('utf8');
        const displayPath = relative(realStagingRoot, realPath).split(sep).join('/');
        artifacts.push({
            path: realPath,
            displayPath,
            sizeBytes: buffer.byteLength,
            content,
            estimatedTokens: estimateTokens(content, 1),
            language: languageFromPath(displayPath),
        });
    }
    return artifacts;
}

/** @param {string} root @param {string} candidate */
function isPathWithin(root, candidate) {
    const fromRoot = relative(root, candidate);
    return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

/** @param {string} value */
function stripOuterQuotes(value) {
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
        ? value.slice(1, -1)
        : value;
}

/** @param {string} current @param {unknown} chunk */
function appendLimited(current, chunk) {
    if (current.length >= CHILD_OUTPUT_LIMIT) return current;
    return (current + String(chunk)).slice(0, CHILD_OUTPUT_LIMIT);
}

/** @param {unknown} payload @param {string} output */
function remoteError(payload, output) {
    const remote = payload && typeof payload === 'object'
        ? /** @type {Record<string, unknown>} */ (payload)
        : {};
    const error = new Error(String(remote.message || output || 'Repomix runner failed'));
    if (typeof remote.name === 'string') error.name = remote.name;
    if (typeof remote.stack === 'string') error.stack = remote.stack;
    Object.assign(error, {
        remoteCode: remote.code,
        remoteDetails: remote.details,
        runnerOutput: output || undefined,
    });
    return error;
}

/** @param {unknown} error */
function remoteEvidence(error) {
    if (!error || typeof error !== 'object') return {};
    const record = /** @type {{remoteCode?:unknown,remoteDetails?:unknown,runnerOutput?:unknown}} */ (error);
    return {
        ...(record.remoteCode !== undefined ? { remoteCode: record.remoteCode } : {}),
        ...(record.remoteDetails !== undefined ? { remoteDetails: record.remoteDetails } : {}),
        ...(record.runnerOutput ? { runnerOutput: record.runnerOutput } : {}),
    };
}

/** @param {unknown} error */
function isModuleNotFound(error) {
    return Boolean(error && typeof error === 'object' && /** @type {{code?:unknown}} */ (error).code === 'MODULE_NOT_FOUND');
}

/** @param {unknown} error */
function isNotFound(error) {
    return Boolean(error && typeof error === 'object' && ['ENOENT', 'ENOTDIR'].includes(String(/** @type {{code?:unknown}} */ (error).code)));
}

/** @param {unknown} error */
function errorMessage(error) {
    if (error && typeof error === 'object' && 'message' in error) {
        return String(/** @type {{ message?: unknown }} */ (error).message || error);
    }
    return String(error);
}
