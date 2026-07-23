import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebAiError } from '../../web-ai/errors.mjs';
import {
    buildRepomixArtifacts,
    normalizeContextTransformMode,
} from '../../web-ai/context-pack/transformer.mjs';
import {
    installPathFakeRepomix,
    installProjectLocalFakeRepomix,
    readFakeRepomixEvents,
} from '../helpers/fake-repomix-project.mjs';

const temporaryDirectories = [];
const suiteCwd = process.cwd();
const suitePath = process.env.PATH;

afterEach(async () => {
    process.chdir(suiteCwd);
    if (suitePath === undefined) delete process.env.PATH;
    else process.env.PATH = suitePath;
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
        rm(directory, { recursive: true, force: true, maxRetries: 3 })
    )));
});

async function createTemporaryProject(prefix = 'agbrowse-context-transform-') {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    temporaryDirectories.push(cwd);
    await writeFile(join(cwd, 'package.json'), '{"private":true,"type":"module"}\n');
    const stagingRoot = join(cwd, '.agbrowse-staging');
    await mkdir(stagingRoot);
    return { cwd, stagingRoot };
}

async function captureFailure(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected Repomix transform to fail');
}

function expectTypedTransformFailure(error) {
    expect(error).toBeInstanceOf(WebAiError);
    expect(error).toMatchObject({
        errorCode: 'context.transform-failed',
        stage: 'context-transform',
        retryHint: 'install-compatible-repomix',
    });
    expect(error.cause).toBeTruthy();
}

describe('normalizeContextTransformMode', () => {
    it('normalizes omission to raw and accepts the two supported modes', () => {
        expect(normalizeContextTransformMode()).toBe('raw');
        expect(normalizeContextTransformMode('raw')).toBe('raw');
        expect(normalizeContextTransformMode('repomix')).toBe('repomix');
    });

    it('rejects an unsupported mode with supplied and supported values in evidence', async () => {
        const error = await captureFailure(Promise.resolve().then(() => (
            normalizeContextTransformMode('brotli')
        )));

        expect(error).toBeInstanceOf(WebAiError);
        expect(error.errorCode).toBe('context.transform-invalid');
        expect(error.stage).toBe('context-transform');
        expect(error.evidence).toEqual({
            supplied: 'brotli',
            supported: ['raw', 'repomix'],
        });
    });

    it('rejects explicitly supplied empty values instead of treating them as omission', async () => {
        for (const supplied of ['', '   ']) {
            const error = await captureFailure(Promise.resolve().then(() => (
                normalizeContextTransformMode(supplied)
            )));

            expect(error).toBeInstanceOf(WebAiError);
            expect(error.errorCode).toBe('context.transform-invalid');
            expect(error.evidence).toMatchObject({
                supplied,
                supported: ['raw', 'repomix'],
            });
        }
    });
});

describe('buildRepomixArtifacts package and artifact contract', () => {
    it('rejects Repomix v0.3.9 before config execution when explicit files are selected', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const selectedPath = join(cwd, 'selected.ts');
        await writeFile(selectedPath, 'export const selected = true;\n');
        const fake = await installProjectLocalFakeRepomix(cwd, { version: '0.3.9' });

        const error = await captureFailure(buildRepomixArtifacts({
            cwd,
            stagingRoot,
            explicitFiles: [selectedPath],
        }));

        expectTypedTransformFailure(error);
        expect(error.message).toMatch(/explicit context selectors require Repomix >= 1\.0\.0.*0\.3\.9/i);
        expect(error.evidence).toMatchObject({
            explicitFileCount: 1,
            repomix: { version: '0.3.9' },
        });
        expect(await readFakeRepomixEvents(fake.eventFile)).toEqual([]);
    });

    it('allows an API-compatible legacy Repomix for cwd packing without selectors', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const fake = await installProjectLocalFakeRepomix(cwd, {
            version: '0.3.9',
            outputs: [{ content: 'legacy cwd artifact\n' }],
        });

        const result = await buildRepomixArtifacts({ cwd, stagingRoot });

        expect(result.repomix.version).toBe('0.3.9');
        expect(result.artifacts[0].content).toBe('legacy cwd artifact\n');
        expect((await readFakeRepomixEvents(fake.eventFile)).at(-1)).toMatchObject({
            type: 'pack',
            explicitFiles: null,
        });
    });

    it('prefers the project-local package, records package provenance, and returns a single output directly', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const pathRoot = await realpath(await mkdtemp(join(tmpdir(), 'agbrowse-path-repomix-decoy-')));
        temporaryDirectories.push(pathRoot);
        const local = await installProjectLocalFakeRepomix(cwd, {
            version: '9.1.0-local',
            configPath: 'repomix.config.ts',
            fileConfig: { output: { filePath: 'reports/review-context.md' } },
            outputs: [{ content: 'project-local artifact\n' }],
        });
        const decoy = await installPathFakeRepomix({
            root: pathRoot,
            projectCwd: pathRoot,
            version: '9.2.0-path-decoy',
            outputs: [{ content: 'wrong PATH artifact\n' }],
        });
        process.env.PATH = decoy.binDir;

        const result = await buildRepomixArtifacts({
            cwd,
            stagingRoot,
            explicitFiles: null,
            contextExclude: [],
        });

        expect(result.repomix).toMatchObject({
            version: '9.1.0-local',
            source: 'project-local',
            packagePath: local.packageRoot,
            configPath: null,
            configResolution: 'repomix-auto',
            configuredOutputPath: 'reports/review-context.md',
        });
        expect(result.artifacts).toEqual([expect.objectContaining({
            path: join(stagingRoot, 'review-context.md'),
            displayPath: 'review-context.md',
            content: 'project-local artifact\n',
            language: 'markdown',
        })]);
        expect(result.artifacts[0].path).not.toMatch(/\.zip$/i);

        const events = await readFakeRepomixEvents(local.eventFile);
        expect(events.map(event => event.type)).toEqual([
            'setLogLevel',
            'loadFileConfig',
            'mergeConfigs',
            'pack',
        ]);
        expect(events.every(event => event.runtimeCwd === cwd)).toBe(true);
        expect(events.at(-1).config.ignore.customPatterns).toContain(
            'reports/review-context.+([0-9]).md',
        );
        expect(await readFakeRepomixEvents(decoy.eventFile)).toEqual([]);
    });

    it('falls back to the npm package behind the Repomix executable on PATH', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const pathRoot = await realpath(await mkdtemp(join(tmpdir(), 'agbrowse-path-repomix-')));
        temporaryDirectories.push(pathRoot);
        const pathPackage = await installPathFakeRepomix({
            root: pathRoot,
            projectCwd: cwd,
            version: '8.0.0-path',
            fileConfig: { output: { filePath: 'path-output.txt' } },
            outputs: [{ content: 'PATH artifact\n' }],
        });
        process.env.PATH = pathPackage.binDir;

        const result = await buildRepomixArtifacts({
            cwd,
            stagingRoot,
            explicitFiles: null,
        });

        expect(result.repomix).toMatchObject({
            version: '8.0.0-path',
            source: 'path',
            packagePath: pathPackage.packageRoot,
        });
        expect(result.artifacts[0]).toMatchObject({
            displayPath: 'path-output.txt',
            content: 'PATH artifact\n',
        });
        const events = await readFakeRepomixEvents(pathPackage.eventFile);
        expect(events.at(-1)).toMatchObject({
            type: 'pack',
            runtimeCwd: cwd,
            rootDirs: [cwd],
        });
    });

    it('delegates config resolution to Repomix without guessing a config path', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        await writeFile(join(cwd, 'repomix.config.ts'), 'export default {};\n');
        await writeFile(join(cwd, 'repomix.config.json'), '{}\n');
        const fake = await installProjectLocalFakeRepomix(cwd, {
            fileConfig: { output: { filePath: 'from-json.md' } },
        });

        const result = await buildRepomixArtifacts({ cwd, stagingRoot });

        const configLoads = (await readFakeRepomixEvents(fake.eventFile))
            .filter(event => event.type === 'loadFileConfig');
        expect(configLoads).toEqual([expect.objectContaining({ cwd, configPath: null })]);
        expect(result.repomix).toMatchObject({
            configPath: null,
            configResolution: 'repomix-auto',
            configuredOutputPath: 'from-json.md',
        });
        expect(result.artifacts[0].displayPath).toBe('from-json.md');
    });

    it('preserves Repomix split-output order and original filenames', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const { eventFile } = await installProjectLocalFakeRepomix(cwd, {
            fileConfig: { output: { filePath: 'configured-name.md', splitOutput: 64 } },
            outputs: [
                { name: 'configured-name.2.md', content: 'second-by-name, first-by-order\n' },
                { name: 'configured-name.1.md', content: 'first-by-name, second-by-order\n' },
                { name: 'configured-name.10.md', content: 'tenth-by-name, third-by-order\n' },
            ],
        });

        const result = await buildRepomixArtifacts({ cwd, stagingRoot });

        expect(result.artifacts.map(artifact => artifact.displayPath)).toEqual([
            'configured-name.2.md',
            'configured-name.1.md',
            'configured-name.10.md',
        ]);
        expect(result.artifacts.map(artifact => artifact.content)).toEqual([
            'second-by-name, first-by-order\n',
            'first-by-name, second-by-order\n',
            'tenth-by-name, third-by-order\n',
        ]);
        const packEvent = (await readFakeRepomixEvents(eventFile))
            .find(event => event.type === 'pack');
        expect(packEvent.config.ignore.customPatterns).toContain('configured-name.+([0-9]).md');
        expect(packEvent.config.ignore.customPatterns).not.toContain('configured-name.*.md');
    });

    it.runIf(process.platform !== 'win32')('preserves a POSIX output basename containing a backslash', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const { eventFile } = await installProjectLocalFakeRepomix(cwd, {
            fileConfig: { output: { filePath: 'foo\\bar.md' } },
            outputs: [{ content: 'literal backslash basename\n' }],
        });

        const result = await buildRepomixArtifacts({ cwd, stagingRoot });

        expect(result.artifacts[0].displayPath).toBe('foo\\bar.md');
        expect(result.repomix.configuredOutputPath).toBe('foo\\bar.md');
        const packEvent = (await readFakeRepomixEvents(eventFile))
            .find(event => event.type === 'pack');
        expect(packEvent.config.ignore.customPatterns).toContain('foo\\\\bar.md');
    });

    it('replaces config include with the explicit set while retaining ignore, processors, and output patterns', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const selectedPath = join(cwd, 'src', 'selected.fixture');
        await mkdir(join(cwd, 'src'));
        await writeFile(selectedPath, 'selected source\n');
        const processor = { pattern: '**/*.fixture', command: 'node ./processor.mjs {file}' };
        const outputPatterns = [{ pattern: '**/*.fixture', compress: true }];
        const { eventFile } = await installProjectLocalFakeRepomix(cwd, {
            fileConfig: {
                include: ['**/*'],
                ignore: { customPatterns: ['ignored/**'], useGitignore: false },
                input: { processors: [processor] },
                output: {
                    filePath: 'reports/custom-context.md',
                    patterns: outputPatterns,
                    removeComments: true,
                    stdout: true,
                },
            },
            outputs: [{ content: 'processed selected source\n' }],
        });

        await buildRepomixArtifacts({
            cwd,
            stagingRoot,
            explicitFiles: [selectedPath],
            contextExclude: ['cli-excluded/**'],
            maxFileSize: 1234,
        });

        const events = await readFakeRepomixEvents(eventFile);
        const packEvent = events.find(event => event.type === 'pack');
        expect(packEvent).toMatchObject({
            runtimeCwd: cwd,
            rootDirs: [cwd],
            explicitFiles: [selectedPath],
            config: {
                cwd,
                include: [],
                enableFileProcessors: true,
                input: {
                    processors: [processor],
                    maxFileSize: 1234,
                },
                output: {
                    filePath: join(stagingRoot, 'custom-context.md'),
                    copyToClipboard: false,
                    patterns: outputPatterns,
                    removeComments: true,
                    stdout: false,
                },
                ignore: {
                    useGitignore: false,
                    customPatterns: expect.arrayContaining([
                        'ignored/**',
                        'cli-excluded/**',
                        'reports/custom-context.md',
                    ]),
                },
            },
        });
    });

    it('excludes the retained agbrowse package root when it is inside cwd', async () => {
        const cwd = await realpath(await mkdtemp(join(tmpdir(), 'agbrowse-repomix-managed-root-')));
        temporaryDirectories.push(cwd);
        await writeFile(join(cwd, 'package.json'), '{"private":true,"type":"module"}\n');
        const packageRoot = join(cwd, '.browser-agent', 'web-ai-context-packages');
        const stagingRoot = join(packageRoot, 'web-ai-context-repomix-current');
        await mkdir(stagingRoot, { recursive: true });
        const { eventFile } = await installProjectLocalFakeRepomix(cwd);

        await buildRepomixArtifacts({ cwd, stagingRoot, managedRoot: packageRoot });

        const packEvent = (await readFakeRepomixEvents(eventFile))
            .find(event => event.type === 'pack');
        expect(packEvent.config.ignore.customPatterns).toContain(
            '.browser-agent/web-ai-context-packages/**',
        );
    });

    it('preserves Repomix security and skipped-file warnings', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        await installProjectLocalFakeRepomix(cwd, {
            packResult: {
                suspiciousFilesResults: [{ filePath: 'secret.env', messages: ['secret'], type: 'file' }],
                suspiciousGitDiffResults: [{ filePath: 'git-diff', messages: ['secret'], type: 'gitDiff' }],
                suspiciousGitLogResults: [{ filePath: 'git-log', messages: ['secret'], type: 'gitLog' }],
                skippedFiles: [
                    { path: 'asset.bin', reason: 'binary-content' },
                    { path: 'large.txt', reason: 'size-limit' },
                ],
            },
        });

        const result = await buildRepomixArtifacts({ cwd, stagingRoot });

        expect(result.warnings).toEqual([
            'repomix security: 1 suspicious source file(s) excluded: secret.env',
            'repomix security: 1 suspicious Git diff item(s) included: git-diff',
            'repomix security: 1 suspicious Git log item(s) included: git-log',
            'repomix skipped 1 file(s) (binary-content): asset.bin',
            'repomix skipped 1 file(s) (size-limit): large.txt',
        ]);
    });

    it('rejects direct explicit-file escapes before loading Repomix', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        const outside = await realpath(await mkdtemp(join(tmpdir(), 'agbrowse-repomix-outside-')));
        temporaryDirectories.push(outside);
        const outsideFile = join(outside, 'outside.ts');
        const linkedFile = join(cwd, 'linked.ts');
        await writeFile(outsideFile, 'export const OUTSIDE = true;\n');
        await symlink(outsideFile, linkedFile);
        const fake = await installProjectLocalFakeRepomix(cwd);

        for (const explicitFile of [outsideFile, linkedFile]) {
            const error = await captureFailure(buildRepomixArtifacts({
                cwd,
                stagingRoot,
                explicitFiles: [explicitFile],
            }));
            expect(error).toMatchObject({
                errorCode: 'context.symlink-rejected',
                stage: 'context-preflight',
            });
        }
        expect(await readFakeRepomixEvents(fake.eventFile)).toEqual([]);
    });

    it('fails closed with one typed contract for missing and incompatible packages', async () => {
        const missing = await createTemporaryProject('agbrowse-repomix-missing-');
        const emptyBin = join(missing.cwd, 'empty-bin');
        await mkdir(emptyBin);
        process.env.PATH = emptyBin;
        const missingError = await captureFailure(buildRepomixArtifacts({
            cwd: missing.cwd,
            stagingRoot: missing.stagingRoot,
        }));
        expectTypedTransformFailure(missingError);
        expect(missingError.message).toMatch(/Repomix.*not found|not found.*Repomix/i);

        const incompatible = await createTemporaryProject('agbrowse-repomix-incompatible-');
        await installProjectLocalFakeRepomix(incompatible.cwd, { incompatible: true });
        const incompatibleError = await captureFailure(buildRepomixArtifacts({
            cwd: incompatible.cwd,
            stagingRoot: incompatible.stagingRoot,
        }));
        expectTypedTransformFailure(incompatibleError);
        expect(incompatibleError.message).toMatch(/incompatible|missing/i);
    });

    it('fails the whole transform when any reported split part is missing', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        await installProjectLocalFakeRepomix(cwd, {
            outputs: [
                { name: 'context.1.md', content: 'complete first part\n' },
                { name: 'context.2.md', missing: true },
            ],
        });

        const error = await captureFailure(buildRepomixArtifacts({ cwd, stagingRoot }));

        expectTypedTransformFailure(error);
        expect(error.message).toMatch(/context\.2\.md|ENOENT|no such file/i);
    });

    it('fails closed when Repomix reports an empty output file list', async () => {
        const { cwd, stagingRoot } = await createTemporaryProject();
        await installProjectLocalFakeRepomix(cwd, {
            packResult: { outputFiles: [] },
        });

        const error = await captureFailure(buildRepomixArtifacts({ cwd, stagingRoot }));

        expectTypedTransformFailure(error);
        expect(error.message).toMatch(/invalid outputFiles/);
    });
});
