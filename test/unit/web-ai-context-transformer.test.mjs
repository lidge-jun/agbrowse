import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAiError } from '../../web-ai/errors.mjs';
import {
    normalizeContextTransformMode,
    transformContextFiles,
} from '../../web-ai/context-pack/transformer.mjs';
import { estimateTokens } from '../../web-ai/context-pack/token-estimator.mjs';

const temporaryDirectories = [];
const fakeEventKeys = [];

afterEach(async () => {
    vi.restoreAllMocks();
    for (const key of fakeEventKeys.splice(0)) delete globalThis[key];
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
        rm(directory, { recursive: true, force: true, maxRetries: 3 })
    )));
});

function selectedFiles(cwd) {
    return [
        {
            path: join(cwd, 'src', 'alpha.mjs'),
            relativePath: 'src/alpha.mjs',
            language: 'javascript',
            content: 'export function alpha() { return "한글"; }\n',
            sizeBytes: 47,
            estimatedTokens: 32,
        },
        {
            path: join(cwd, 'src', 'beta.py'),
            relativePath: 'src/beta.py',
            language: 'python',
            content: 'def beta():\n    return 2\n',
            sizeBytes: 25,
            estimatedTokens: 25,
        },
    ];
}

function fakeRepomixSource(eventKey, processBody = `
    return [...rawFiles].reverse().map(file => ({
        path: file.path,
        content: 'compressed:' + file.path + ':' + file.content,
    }));
`) {
    return `
const events = globalThis[${JSON.stringify(eventKey)}] ??= [];

export function mergeConfigs(cwd, fileConfig, cliConfig) {
    const merged = { source: ${JSON.stringify(eventKey)}, cwd, fileConfig, cliConfig };
    events.push({ type: 'mergeConfigs', cwd, fileConfig, cliConfig, returned: merged });
    return merged;
}

export function setLogLevel(level) {
    events.push({ type: 'setLogLevel', level });
}

export async function processFiles(rawFiles, config, progressCallback) {
    const progressReturn = progressCallback('progress-probe');
    events.push({
        type: 'processFiles',
        rawFiles,
        config,
        callbackType: typeof progressCallback,
        progressReturn,
    });
    ${processBody}
}
`;
}

async function createTemporaryProject({
    installRepomix = true,
    processBody,
    sourceFactory,
} = {}) {
    const cwd = await mkdtemp(join(tmpdir(), 'agbrowse-context-transform-'));
    temporaryDirectories.push(cwd);
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ private: true, type: 'module' }));

    if (!installRepomix) return { cwd, eventKey: null, events: [] };

    const packageDirectory = join(cwd, 'node_modules', 'repomix');
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
        name: 'repomix',
        version: '0.0.0-test',
        type: 'module',
        main: './index.mjs',
        exports: { '.': './index.mjs' },
    }));

    const eventKey = `__agbrowse_fake_repomix_${randomUUID()}`;
    fakeEventKeys.push(eventKey);
    globalThis[eventKey] = [];
    const source = sourceFactory
        ? sourceFactory(eventKey)
        : fakeRepomixSource(eventKey, processBody);
    await writeFile(join(packageDirectory, 'index.mjs'), source);

    return { cwd, eventKey, events: globalThis[eventKey] };
}

async function captureTransformFailure(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected context transform to fail');
}

function expectTypedTransformFailure(error) {
    expect(error).toBeInstanceOf(WebAiError);
    expect(error.errorCode).toBe('context.transform-failed');
    expect(error.stage).toBe('context-transform');
}

describe('normalizeContextTransformMode', () => {
    it('normalizes omission to raw and accepts the two supported modes', () => {
        expect(normalizeContextTransformMode()).toBe('raw');
        expect(normalizeContextTransformMode('raw')).toBe('raw');
        expect(normalizeContextTransformMode('repomix')).toBe('repomix');
    });

    it('rejects an unsupported mode with supplied and supported values in evidence', async () => {
        const normalizedError = await captureTransformFailure(Promise.resolve().then(() => (
            normalizeContextTransformMode('brotli')
        )));
        const { cwd } = await createTemporaryProject({ installRepomix: false });
        const transformError = await captureTransformFailure(transformContextFiles(selectedFiles(cwd), {
            mode: 'brotli',
            cwd,
        }));

        for (const error of [normalizedError, transformError]) {
            expect(error).toBeInstanceOf(WebAiError);
            expect(error.errorCode).toBe('context.transform-invalid');
            expect(error.stage).toBe('context-transform');
            const evidence = JSON.stringify(error.evidence);
            expect(evidence).toContain('brotli');
            expect(evidence).toContain('raw');
            expect(evidence).toContain('repomix');
        }
    });
});

describe('transformContextFiles raw mode', () => {
    it('returns the original file data by identity without a local Repomix package', async () => {
        const { cwd } = await createTemporaryProject({ installRepomix: false });
        const files = selectedFiles(cwd);

        const omitted = await transformContextFiles(files, { cwd });
        const explicit = await transformContextFiles(files, { mode: 'raw', cwd });

        expect(omitted).toBe(files);
        expect(explicit).toBe(files);
        expect(omitted[0]).toBe(files[0]);
        expect(omitted[1]).toBe(files[1]);
    });
});

describe('transformContextFiles repomix mode', () => {
    it('loads package-root APIs from target cwd and remaps transformed output by path', async () => {
        const { cwd, events } = await createTemporaryProject();
        const files = selectedFiles(cwd);
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        const transformed = await transformContextFiles(files, { mode: 'repomix', cwd });

        const mergeEvent = events.find(event => event.type === 'mergeConfigs');
        const logEvent = events.find(event => event.type === 'setLogLevel');
        const processEvent = events.find(event => event.type === 'processFiles');
        expect(mergeEvent).toMatchObject({
            cwd,
            fileConfig: {},
            cliConfig: { output: { compress: true } },
        });
        expect(logEvent).toEqual({ type: 'setLogLevel', level: -1 });
        expect(events.indexOf(logEvent)).toBeLessThan(events.indexOf(processEvent));
        expect(processEvent.config).toBe(mergeEvent.returned);
        expect(processEvent.rawFiles).toEqual(files.map(file => ({
            path: file.relativePath,
            content: file.content,
        })));
        expect(processEvent.callbackType).toBe('function');
        expect(processEvent.progressReturn).toBeUndefined();
        expect(consoleLog).not.toHaveBeenCalled();

        expect(transformed.map(file => file.relativePath)).toEqual(files.map(file => file.relativePath));
        for (let index = 0; index < files.length; index += 1) {
            const original = files[index];
            const result = transformed[index];
            const expectedContent = `compressed:${original.relativePath}:${original.content}`;
            expect(result).toMatchObject({
                path: original.path,
                relativePath: original.relativePath,
                language: original.language,
                content: expectedContent,
                sizeBytes: Buffer.byteLength(expectedContent, 'utf8'),
                estimatedTokens: estimateTokens(expectedContent, 1),
            });
        }
    });

    it.each([
        ['missing selected path', 'return rawFiles.slice(0, -1);'],
        ['duplicate processed path', 'return [rawFiles[0], rawFiles[0], ...rawFiles.slice(1)];'],
        ['unknown processed path', "return [...rawFiles, { path: 'unknown/file.mjs', content: 'x' }];"],
        ['non-string processed content', "return rawFiles.map((file, index) => index === 0 ? { path: file.path, content: 42 } : file);"],
    ])('fails closed on %s', async (_label, processBody) => {
        const { cwd } = await createTemporaryProject({ processBody });
        const error = await captureTransformFailure(transformContextFiles(selectedFiles(cwd), {
            mode: 'repomix',
            cwd,
        }));

        expectTypedTransformFailure(error);
    });

    it('accepts unchanged content as an unsupported-language fallback', async () => {
        const { cwd } = await createTemporaryProject({
            processBody: 'return rawFiles.map(file => ({ path: file.path, content: file.content }));',
        });
        const content = 'opaque unsupported language\n';
        const files = [{
            path: join(cwd, 'src', 'sample.unknown-language'),
            relativePath: 'src/sample.unknown-language',
            language: 'unknown-language',
            content,
            sizeBytes: 999,
            estimatedTokens: 999,
        }];

        const transformed = await transformContextFiles(files, { mode: 'repomix', cwd });

        expect(transformed).toHaveLength(1);
        expect(transformed[0]).toMatchObject({
            path: files[0].path,
            relativePath: files[0].relativePath,
            language: files[0].language,
            content,
            sizeBytes: Buffer.byteLength(content, 'utf8'),
            estimatedTokens: estimateTokens(content, 1),
        });
    });

    it('wraps a missing target-cwd package as a typed failure with cause', async () => {
        const { cwd } = await createTemporaryProject({ installRepomix: false });
        const error = await captureTransformFailure(transformContextFiles(selectedFiles(cwd), {
            mode: 'repomix',
            cwd,
        }));

        expectTypedTransformFailure(error);
        expect(error.cause).toBeTruthy();
        expect(error.message).toMatch(/repomix/i);
        expect(error.message).toMatch(/local|install/i);
        expect(error.message).toMatch(/compatible|runtime|node/i);
    });

    it('wraps an incompatible package-root API shape as a typed failure with cause', async () => {
        const { cwd } = await createTemporaryProject({
            sourceFactory: () => `
export function mergeConfigs(cwd, fileConfig, cliConfig) {
    return { cwd, fileConfig, cliConfig };
}
export async function processFiles(rawFiles) {
    return rawFiles;
}
`,
        });
        const error = await captureTransformFailure(transformContextFiles(selectedFiles(cwd), {
            mode: 'repomix',
            cwd,
        }));

        expectTypedTransformFailure(error);
        expect(error.cause).toBeTruthy();
    });

    it('wraps a processing error as a typed failure and preserves the original cause', async () => {
        const { cwd } = await createTemporaryProject({
            processBody: "throw new Error('fake process exploded');",
        });
        const error = await captureTransformFailure(transformContextFiles(selectedFiles(cwd), {
            mode: 'repomix',
            cwd,
        }));

        expectTypedTransformFailure(error);
        expect(error.cause).toBeInstanceOf(Error);
        expect(error.cause.message).toBe('fake process exploded');
    });
});
