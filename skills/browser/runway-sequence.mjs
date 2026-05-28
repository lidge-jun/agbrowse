// @ts-check

import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import { buildRunwaySafety } from './runway-selectors.mjs';
import { executeRunwayGeneration } from './runway-generate.mjs';

const execFile = promisify(execFileCallback);
const DEFAULT_TARGET_DURATION = 120;
const DEFAULT_SHOT_DURATION = 10;
const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_INTERVAL_MS = 5000;

/**
 * @param {unknown} value
 * @returns {string}
 */
function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {number} index
 * @param {number} total
 * @returns {string}
 */
function padShot(index, total) {
    return String(index).padStart(String(total).length, '0');
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

/**
 * @param {string} shot
 * @param {number} index
 * @param {number} total
 * @param {boolean} hasAnchor
 * @returns {string}
 */
export function buildAnchoredPrompt(shot, index, total, hasAnchor) {
    const continuity = hasAnchor
        ? 'Continue directly from the provided first frame. Preserve subject identity, composition, lighting, color palette, camera direction, and screen direction. Avoid a hard reset or new establishing shot.'
        : 'Establish the visual language, subject identity, color palette, lighting, and camera direction for the full sequence.';
    return [
        `Shot ${index} of ${total}.`,
        continuity,
        clean(shot),
    ].filter(Boolean).join('\n');
}

/**
 * @param {object} options
 * @param {string} [options.story]
 * @param {string[]} [options.shots]
 * @param {number} [options.targetDuration]
 * @param {number} [options.shotDuration]
 * @param {number} [options.maxShots]
 * @returns {{ targetDuration: number, shotDuration: number, totalDuration: number, shotCount: number, shots: Array<{ index: number, prompt: string, duration: number }> }}
 */
export function buildRunwaySequencePlan(options = {}) {
    const shotDuration = positiveInt(options.shotDuration, DEFAULT_SHOT_DURATION);
    const rawShots = (options.shots || []).map(clean).filter(Boolean);
    const targetDuration = positiveInt(
        options.targetDuration,
        rawShots.length ? rawShots.length * shotDuration : DEFAULT_TARGET_DURATION
    );
    const plannedCount = rawShots.length || Math.max(1, Math.ceil(targetDuration / shotDuration));
    const shotCount = options.maxShots ? Math.min(plannedCount, positiveInt(options.maxShots, plannedCount)) : plannedCount;
    const story = clean(options.story);

    if (!rawShots.length && !story) {
        throw new Error('sequence requires --story or at least one --shots prompt');
    }

    const prompts = rawShots.length
        ? rawShots.slice(0, shotCount)
        : Array.from({ length: shotCount }, (_, i) => [
            story,
            `Segment ${i + 1}/${shotCount}: advance the same continuous moment with a clear beginning, middle, and end beat for this segment.`,
        ].join('\n'));

    return {
        targetDuration,
        shotDuration,
        totalDuration: prompts.length * shotDuration,
        shotCount: prompts.length,
        shots: prompts.map((prompt, i) => ({
            index: i + 1,
            prompt,
            duration: shotDuration,
        })),
    };
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isImagePath(path) {
    return /\.(?:png|jpe?g|webp|gif)$/i.test(path);
}

/**
 * @param {string} path
 * @returns {string}
 */
function concatListPath(path) {
    return String(path).replace(/'/g, "'\\''");
}

/**
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {{ execFile?: typeof execFile }} [deps]
 * @returns {Promise<{ ok: boolean, path?: string, reusedImage?: boolean, error?: string }>}
 */
export async function extractRunwayLastFrame(inputPath, outputPath, deps = {}) {
    try {
        const absInput = resolve(inputPath);
        if (!existsSync(absInput)) return { ok: false, error: `input not found: ${absInput}` };
        if (isImagePath(absInput)) return { ok: true, path: absInput, reusedImage: true };

        const absOutput = resolve(outputPath);
        await mkdir(dirname(absOutput), { recursive: true });
        const run = deps.execFile || execFile;
        await run('ffmpeg', [
            '-y',
            '-sseof', '-0.08',
            '-i', absInput,
            '-frames:v', '1',
            absOutput,
        ], { timeout: 60000 });
        return { ok: true, path: absOutput };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string[]} videoPaths
 * @param {string} outputPath
 * @param {{ execFile?: typeof execFile }} [deps]
 * @returns {Promise<{ ok: boolean, path?: string, listFile?: string, error?: string }>}
 */
export async function stitchRunwaySequenceVideos(videoPaths, outputPath, deps = {}) {
    try {
        const videos = videoPaths.map(path => resolve(path)).filter(path => !isImagePath(path));
        if (videos.length < 2) return { ok: false, error: 'stitch requires at least two video outputs' };

        const absOutput = resolve(outputPath);
        await mkdir(dirname(absOutput), { recursive: true });
        const listFile = join(dirname(absOutput), `runway-sequence-${Date.now()}.txt`);
        await writeFile(listFile, videos.map(path => `file '${concatListPath(path)}'`).join('\n'));

        const run = deps.execFile || execFile;
        await run('ffmpeg', [
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', listFile,
            '-c', 'copy',
            absOutput,
        ], { timeout: 120000 });
        return { ok: true, path: absOutput, listFile };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} manifestPath
 * @param {object} manifest
 * @returns {Promise<string>}
 */
async function writeSequenceManifest(manifestPath, manifest) {
    const absPath = resolve(manifestPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return absPath;
}

/**
 * @param {any} page
 * @param {object} options
 * @param {string} [options.story]
 * @param {string[]} [options.shots]
 * @param {number} [options.targetDuration]
 * @param {number} [options.shotDuration]
 * @param {number} [options.maxShots]
 * @param {string} [options.model]
 * @param {string} [options.ratio]
 * @param {string} [options.resolution]
 * @param {boolean} [options.explore]
 * @param {string} [options.seedImage]
 * @param {string} [options.outputDir]
 * @param {string} [options.output]
 * @param {string} [options.manifest]
 * @param {string} [options.stitch]
 * @param {boolean} [options.dryRun]
 * @param {number} [options.timeout]
 * @param {number} [options.interval]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {any} [deps]
 * @returns {Promise<object>}
 */
export async function executeRunwaySequence(page, options = {}, deps = {}) {
    const plan = buildRunwaySequencePlan(options);
    const outputDir = resolve(options.outputDir || join(tmpdir(), `runway-sequence-${Date.now()}`));
    const manifestPath = resolve(options.manifest || join(outputDir, 'manifest.json'));
    const stitchMode = options.stitch || 'ffmpeg';
    const manifest = {
        ok: false,
        command: 'sequence',
        status: options.dryRun ? 'planned' : 'running',
        surface: 'custom-tools',
        model: options.model || 'Seedance 2.0',
        ratio: options.ratio || '16:9',
        resolution: options.resolution || null,
        explore: Boolean(options.explore),
        continuityMode: 'last-frame-to-next-first-frame',
        outputDir,
        plan,
        shots: [],
        final: null,
        safety: buildRunwaySafety(options.dryRun ? 0 : 2),
    };

    if (options.dryRun) {
        manifest.ok = true;
        await writeSequenceManifest(manifestPath, manifest);
        return { ...manifest, manifest: manifestPath };
    }

    await mkdir(outputDir, { recursive: true });
    /** @type {string | undefined} */
    let nextSeedImage = options.seedImage ? resolve(options.seedImage) : undefined;
    /** @type {string[]} */
    const videoOutputs = [];
    const generate = deps.executeGeneration || executeRunwayGeneration;
    const extractFrame = deps.extractLastFrame || extractRunwayLastFrame;

    for (const shot of plan.shots) {
        const shotId = padShot(shot.index, plan.shotCount);
        const shotOutput = join(outputDir, `shot-${shotId}.mp4`);
        const frameOutput = join(outputDir, `frame-${shotId}-last.png`);
        const prompt = buildAnchoredPrompt(shot.prompt, shot.index, plan.shotCount, Boolean(nextSeedImage));
        const result = await generate(page, {
            surface: 'custom-tools',
            model: options.model || 'Seedance 2.0',
            prompt,
            mode: 'video',
            duration: shot.duration,
            ratio: options.ratio || '16:9',
            resolution: options.resolution,
            seedImage: nextSeedImage,
            clearReferences: true,
            explore: Boolean(options.explore),
            output: shotOutput,
            timeout: options.timeout || DEFAULT_TIMEOUT_MS,
            interval: options.interval || DEFAULT_INTERVAL_MS,
            sleep: options.sleep,
        });

        const outputFile = result.outputFile || result.download?.path || null;
        const frame = outputFile ? await extractFrame(outputFile, frameOutput, deps) : { ok: false, error: 'no output file' };
        const shotRecord = {
            index: shot.index,
            duration: shot.duration,
            prompt,
            seedImage: nextSeedImage || null,
            outputFile,
            outputUrl: result.outputUrl || null,
            outputType: result.outputType || null,
            frame,
            generation: result,
        };
        manifest.shots.push(shotRecord);

        if (!result.ok || !outputFile || !frame.ok) {
            manifest.status = 'failed';
            manifest.error = result.error || frame.error || `shot ${shot.index} failed`;
            await writeSequenceManifest(manifestPath, manifest);
            return { ...manifest, manifest: manifestPath };
        }

        if (!isImagePath(outputFile)) videoOutputs.push(outputFile);
        nextSeedImage = frame.path;
        await writeSequenceManifest(manifestPath, manifest);
    }

    if (options.output && stitchMode !== 'none') {
        const stitch = deps.stitchVideos || stitchRunwaySequenceVideos;
        manifest.final = await stitch(videoOutputs, options.output, deps);
    }

    manifest.ok = !manifest.final || manifest.final.ok;
    manifest.status = manifest.ok ? 'complete' : 'stitch_failed';
    await writeSequenceManifest(manifestPath, manifest);
    return { ...manifest, manifest: manifestPath };
}

/**
 * @param {string[]} args
 * @param {any} deps
 */
export async function runRunwaySequenceCli(args = [], deps = {}) {
    const { values } = parseArgs({
        args,
        options: {
            story: { type: 'string' },
            shots: { type: 'string', multiple: true },
            'target-duration': { type: 'string', default: String(DEFAULT_TARGET_DURATION) },
            'shot-duration': { type: 'string', default: String(DEFAULT_SHOT_DURATION) },
            'max-shots': { type: 'string' },
            model: { type: 'string', default: 'Seedance 2.0' },
            ratio: { type: 'string', default: '16:9' },
            resolution: { type: 'string' },
            'seed-image': { type: 'string' },
            explore: { type: 'boolean', default: false },
            'output-dir': { type: 'string' },
            output: { type: 'string' },
            manifest: { type: 'string' },
            stitch: { type: 'string', default: 'ffmpeg' },
            timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_MS) },
            interval: { type: 'string', default: String(DEFAULT_INTERVAL_MS) },
            'allow-submit': { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });

    if (!values['dry-run'] && !values['allow-submit']) {
        throw new Error('sequence requires --allow-submit unless --dry-run is used');
    }

    const options = {
        story: values.story ? String(values.story) : undefined,
        shots: values.shots?.map(String),
        targetDuration: Number(values['target-duration'] || DEFAULT_TARGET_DURATION),
        shotDuration: Number(values['shot-duration'] || DEFAULT_SHOT_DURATION),
        maxShots: values['max-shots'] ? Number(values['max-shots']) : undefined,
        model: String(values.model || 'Seedance 2.0'),
        ratio: String(values.ratio || '16:9'),
        resolution: values.resolution ? String(values.resolution) : undefined,
        seedImage: values['seed-image'] ? String(values['seed-image']) : undefined,
        explore: Boolean(values.explore),
        outputDir: values['output-dir'] ? String(values['output-dir']) : undefined,
        output: values.output ? String(values.output) : undefined,
        manifest: values.manifest ? String(values.manifest) : undefined,
        stitch: String(values.stitch || 'ffmpeg'),
        timeout: Number(values.timeout || DEFAULT_TIMEOUT_MS),
        interval: Number(values.interval || DEFAULT_INTERVAL_MS),
        dryRun: Boolean(values['dry-run']),
        sleep: deps.sleep,
    };

    const page = values['dry-run'] ? null : await deps.getPage();
    const result = await executeRunwaySequence(page, options, deps);
    const output = values.json ? JSON.stringify(result, null, 2) : formatRunwaySequenceResult(result);
    if (typeof deps.write === 'function') deps.write(output);
    else console.log(output);
}

/**
 * @param {any} result
 */
function formatRunwaySequenceResult(result) {
    const lines = [
        'Runway sequence',
        `status: ${result.status}`,
        `shots: ${result.plan?.shotCount || 0}`,
        `duration: ${result.plan?.totalDuration || 0}s`,
        `model: ${result.model || 'n/a'}`,
        `manifest: ${result.manifest || 'n/a'}`,
    ];
    if (result.final?.path) lines.push(`output: ${result.final.path}`);
    if (result.error) lines.push(`error: ${result.error}`);
    return lines.join('\n');
}
