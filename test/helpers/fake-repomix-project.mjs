import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export const FAKE_REPOMIX_EVENT_FILE = '.fake-repomix-events.jsonl';

/**
 * Install a file-backed fake Repomix package. The generated package has no
 * dependency on Vitest globals, so it is also usable by CLI child processes.
 * Every public API call appends one JSON object to an event file in the target
 * project, including the process cwd from which Repomix was executed.
 *
 * @param {{
 *   packageRoot: string,
 *   projectCwd: string,
 *   version?: string,
 *   fileConfig?: Record<string, unknown>,
 *   configPath?: string|null,
 *   outputs?: Array<{name?: string, content?: string, missing?: boolean}>,
 *   packResult?: Record<string, unknown>,
 *   incompatible?: boolean,
 * }} options
 */
export async function installFakeRepomixPackage(options) {
    const {
        packageRoot,
        projectCwd,
        version = '1.17.0-fake',
        fileConfig = {},
        configPath = null,
        outputs = [{ content: 'fake repomix output\n' }],
        packResult = {},
        incompatible = false,
    } = options;
    const eventFile = join(projectCwd, FAKE_REPOMIX_EVENT_FILE);
    await mkdir(join(packageRoot, 'bin'), { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
        name: 'repomix',
        version,
        type: 'module',
        exports: { '.': './index.mjs' },
        bin: { repomix: './bin/repomix.cjs' },
    }, null, 2)}\n`);
    await writeFile(join(packageRoot, 'bin', 'repomix.cjs'), [
        '#!/usr/bin/env node',
        "process.stdout.write('fake-repomix\\n');",
        '',
    ].join('\n'), { mode: 0o755 });

    if (configPath) {
        const absoluteConfigPath = isAbsolute(configPath)
            ? configPath
            : resolve(projectCwd, configPath);
        await mkdir(resolve(absoluteConfigPath, '..'), { recursive: true });
        await writeFile(absoluteConfigPath, 'export default {};\n');
    }

    const exportsSource = incompatible
        ? `export const fakeIncompatiblePackage = true;\n`
        : fakeRepomixModuleSource({ eventFile, fileConfig, configPath, outputs, packResult });
    await writeFile(join(packageRoot, 'index.mjs'), exportsSource);
    return { eventFile, packageRoot, version };
}

/**
 * Install a fake package at the normal project-local resolution location.
 *
 * @param {string} projectCwd
 * @param {Omit<Parameters<typeof installFakeRepomixPackage>[0], 'packageRoot'|'projectCwd'>} [options]
 */
export async function installProjectLocalFakeRepomix(projectCwd, options = {}) {
    return installFakeRepomixPackage({
        ...options,
        projectCwd,
        packageRoot: join(projectCwd, 'node_modules', 'repomix'),
    });
}

/**
 * Install a package in a global-style directory and expose its executable from
 * a separate PATH entry. The npm-style `../lib/node_modules/repomix` layout lets
 * the resolver identify the package without relying on symlink privileges.
 *
 * @param {{root: string, projectCwd: string} & Omit<Parameters<typeof installFakeRepomixPackage>[0], 'packageRoot'|'projectCwd'>} options
 */
export async function installPathFakeRepomix(options) {
    const packageRoot = join(options.root, 'lib', 'node_modules', 'repomix');
    const installed = await installFakeRepomixPackage({
        ...options,
        packageRoot,
        projectCwd: options.projectCwd,
    });
    const binDir = join(options.root, 'bin');
    const executablePath = join(binDir, 'repomix');
    await mkdir(binDir, { recursive: true });
    await writeFile(executablePath, [
        '#!/usr/bin/env node',
        "process.stdout.write('fake-repomix-path-shim\\n');",
        '',
    ].join('\n'), { mode: 0o755 });
    return { ...installed, binDir, executablePath };
}

/** @param {string} eventFile */
export async function readFakeRepomixEvents(eventFile) {
    try {
        const text = await readFile(eventFile, 'utf8');
        return text
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => JSON.parse(line));
    } catch (error) {
        if (/** @type {{code?: string}} */ (error)?.code === 'ENOENT') return [];
        throw error;
    }
}

/**
 * @param {{
 *   eventFile: string,
 *   fileConfig: Record<string, unknown>,
 *   configPath: string|null,
 *   outputs: Array<{name?: string, content?: string, missing?: boolean}>,
 *   packResult: Record<string, unknown>,
 * }} fixture
 */
function fakeRepomixModuleSource(fixture) {
    return `
import { appendFileSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const eventFile = ${JSON.stringify(fixture.eventFile)};
const fileConfig = ${JSON.stringify(fixture.fileConfig)};
const configuredPath = ${JSON.stringify(fixture.configPath)};
const outputs = ${JSON.stringify(fixture.outputs)};
const packResult = ${JSON.stringify(fixture.packResult)};

function record(type, detail = {}) {
    mkdirSync(dirname(eventFile), { recursive: true });
    appendFileSync(eventFile, JSON.stringify({ type, runtimeCwd: process.cwd(), ...detail }) + '\\n');
}

export async function loadFileConfig(cwd, suppliedConfigPath) {
    record('loadFileConfig', { cwd, configPath: suppliedConfigPath ?? null });
    return structuredClone(fileConfig);
}

export function mergeConfigs(cwd, suppliedFileConfig, cliConfig) {
    const merged = {
        cwd,
        input: {
            ...(suppliedFileConfig.input || {}),
            ...(cliConfig.input || {}),
        },
        output: {
            filePath: 'repomix-output.xml',
            copyToClipboard: true,
            ...(suppliedFileConfig.output || {}),
            ...(cliConfig.output || {}),
        },
        include: [
            ...(suppliedFileConfig.include || []),
            ...(cliConfig.include || []),
        ],
        ignore: {
            ...(suppliedFileConfig.ignore || {}),
            ...(cliConfig.ignore || {}),
            customPatterns: [
                ...(suppliedFileConfig.ignore?.customPatterns || []),
                ...(cliConfig.ignore?.customPatterns || []),
            ],
        },
        security: {
            ...(suppliedFileConfig.security || {}),
            ...(cliConfig.security || {}),
        },
        tokenCount: {
            ...(suppliedFileConfig.tokenCount || {}),
            ...(cliConfig.tokenCount || {}),
        },
        ...(cliConfig.enableFileProcessors !== undefined
            ? { enableFileProcessors: cliConfig.enableFileProcessors }
            : {}),
    };
    record('mergeConfigs', { cwd, fileConfig: suppliedFileConfig, cliConfig, merged });
    return merged;
}

export function setLogLevel(level) {
    record('setLogLevel', { level });
}

export async function pack(rootDirs, config, progressCallback, overrideDeps, explicitFiles) {
    progressCallback?.('fake-pack');
    record('pack', {
        rootDirs,
        config,
        callbackType: typeof progressCallback,
        overrideDeps: overrideDeps || {},
        explicitFiles: explicitFiles ?? null,
    });

    if (outputs.length > 1 || outputs.some(output => output.name)) {
        const outputFiles = [];
        for (const [index, output] of outputs.entries()) {
            const outputPath = join(
                dirname(config.output.filePath),
                output.name || ('repomix-output.' + (index + 1) + '.xml'),
            );
            outputFiles.push(outputPath);
            if (!output.missing) {
                await mkdir(dirname(outputPath), { recursive: true });
                await writeFile(outputPath, output.content ?? ('fake part ' + (index + 1) + '\\n'));
            }
        }
        return {
            ...packResult,
            outputFiles,
            totalFiles: explicitFiles?.length ?? outputs.length,
            totalCharacters: outputs.reduce((sum, output) => sum + (output.content || '').length, 0),
            totalTokens: outputs.length,
        };
    }

    const outputPath = config.output.filePath;
    if (!outputs[0]?.missing) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, outputs[0]?.content ?? 'fake repomix output\\n');
    }
    return {
        ...packResult,
        totalFiles: explicitFiles?.length ?? 1,
        totalCharacters: (outputs[0]?.content || '').length,
        totalTokens: 1,
    };
}
`;
}
