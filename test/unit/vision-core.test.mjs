import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    buildCoordPrompt,
    candidateCenter,
    clipAroundPoint,
    describeRegion,
    extractCoordJson,
    extractVisionCandidateJson,
    assertCodexCli,
    applyDprCorrection,
    isLowConfidence,
    parseVisionClickCliArgs,
    parseViewportSpec,
    resolveRegionClip,
    validateVisionCandidate,
} from '../../skills/vision-click/vision-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coordFixtures = JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'coord-responses.json'), 'utf8')
);
const visionFixtures = JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'vision-candidates.json'), 'utf8')
);
const dprClipFixture = JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'browser-dpr-clip.json'), 'utf8')
);

describe('vision-core', () => {
    it('buildCoordPrompt includes the target and JSON contract', () => {
        const prompt = buildCoordPrompt('Submit button');
        expect(prompt).toContain('Submit button');
        expect(prompt).toContain('"found"');
        expect(prompt).toContain('"bbox"');
        expect(prompt).toContain('"confidence"');
    });

    it('buildCoordPrompt includes region and verification hints when provided', () => {
        const prompt = buildCoordPrompt('first result row', {
            regionHint: 'Focus only on the left-side results panel.',
            centerBias: true,
            preferContainer: true,
        });
        expect(prompt).toContain('left-side results panel');
        expect(prompt).toContain('close to the center');
        expect(prompt).toContain('Prefer the clickable row or container center');
    });

    it('extractCoordJson parses noisy provider responses', () => {
        const parsed = extractCoordJson(coordFixtures[0].text);
        expect(parsed).toEqual(coordFixtures[0].expected);
    });

    it('extractCoordJson handles found:false responses', () => {
        const parsed = extractCoordJson(coordFixtures[1].text);
        expect(parsed).toEqual(coordFixtures[1].expected);
    });

    it('extractCoordJson handles json wrapped in markdown', () => {
        const parsed = extractCoordJson(coordFixtures[2].text);
        expect(parsed).toEqual(coordFixtures[2].expected);
    });

    it('extractCoordJson prefers the last valid object when multiple are present', () => {
        const parsed = extractCoordJson(coordFixtures[3].text);
        expect(parsed).toEqual(coordFixtures[3].expected);
    });

    it('extractCoordJson returns null for missing x/y', () => {
        const parsed = extractCoordJson(coordFixtures[4].text);
        expect(parsed).toBeNull();
    });

    it('extractCoordJson returns null for truncated json', () => {
        const parsed = extractCoordJson(coordFixtures[5].text);
        expect(parsed).toBeNull();
    });

    it('extractVisionCandidateJson parses bbox candidates and legacy points', () => {
        for (const fixture of visionFixtures) {
            const parsed = extractVisionCandidateJson(fixture.text);
            expect(parsed).toMatchObject(fixture.expected);
        }
    });

    it('candidateCenter derives the bbox center', () => {
        const candidate = extractVisionCandidateJson(visionFixtures[0].text);
        expect(candidateCenter(candidate)).toEqual({ x: 140, y: 70 });
    });

    it('validateVisionCandidate rejects invalid bbox and out-of-bounds point', () => {
        expect(() => validateVisionCandidate({
            schemaVersion: 'vision-candidate-v1',
            found: true,
            kind: 'vision_bbox',
            bbox: { x: 1, y: 1, width: 0, height: 10 },
            point: { x: 1, y: 1 },
            confidence: 0.8,
            riskFlags: [],
        }, { viewport: { width: 100, height: 100 }, dpr: 1 })).toThrow('invalid vision candidate bbox');
        expect(() => validateVisionCandidate({
            schemaVersion: 'vision-candidate-v1',
            found: true,
            kind: 'coordinate',
            bbox: null,
            point: { x: 200, y: 1 },
            confidence: 0.8,
            riskFlags: [],
        }, { viewport: { width: 100, height: 100 }, dpr: 1 })).toThrow('outside');
    });

    it('isLowConfidence applies the shared threshold', () => {
        const candidate = extractVisionCandidateJson(visionFixtures[1].text);
        expect(isLowConfidence(candidate)).toBe(true);
    });

    it('assertCodexCli accepts an injected exec implementation', () => {
        const execFn = () => 'codex';
        expect(() => assertCodexCli({ execFn, binary: 'which' })).not.toThrow();
    });

    it('assertCodexCli throws a helpful error when the binary is missing', () => {
        const execFn = () => {
            throw new Error('not found');
        };
        expect(() => assertCodexCli({ execFn, binary: 'which' })).toThrow('codex CLI not found');
    });

    it('applyDprCorrection converts image pixels to CSS pixels', () => {
        expect(applyDprCorrection(400, 276, 2)).toEqual({ x: 200, y: 138 });
    });

    it('applyDprCorrection preserves clip origin evidence', () => {
        const center = candidateCenter(dprClipFixture.candidate);
        const css = applyDprCorrection(center.x, center.y, dprClipFixture.dpr);
        expect({
            x: dprClipFixture.clip.x + css.x,
            y: dprClipFixture.clip.y + css.y,
        }).toEqual(dprClipFixture.expectedCssPoint);
    });

    it('parseVisionClickCliArgs keeps option values out of the target', () => {
        const parsed = parseVisionClickCliArgs([
            'Submit',
            'button',
            '--port', '9333',
            '--double',
            '--prepare-stable',
            '--verify-before-click',
            '--viewport', '1440x900',
            '--region', 'left-panel',
            '--clip', '10', '20', '300', '180',
            '--bundle', '/tmp/bundle.json',
        ], {
            port: '9222',
            browserScript: '/tmp/browser.mjs',
        });
        expect(parsed.target).toBe('Submit button');
        expect(parsed.opts).toEqual({
            doubleClick: true,
            port: '9333',
            browserScript: '/tmp/browser.mjs',
            prepareStable: true,
            verifyBeforeClick: true,
            viewport: { width: 1440, height: 900 },
            region: 'left-panel',
            clip: { x: 10, y: 20, width: 300, height: 180 },
            help: false,
            bundle: '/tmp/bundle.json',
        });
    });

    it('parseVisionClickCliArgs defaults bundle to null', () => {
        const parsed = parseVisionClickCliArgs(['Target'], {
            port: '9222',
            browserScript: '/tmp/default-browser.mjs',
        });
        expect(parsed.opts.bundle).toBeNull();
    });

    it('parseVisionClickCliArgs reads browser-script explicitly', () => {
        const parsed = parseVisionClickCliArgs(['Target', '--browser-script', '/tmp/custom-browser.mjs'], {
            port: '9222',
            browserScript: '/tmp/default-browser.mjs',
        });
        expect(parsed.target).toBe('Target');
        expect(parsed.opts.browserScript).toBe('/tmp/custom-browser.mjs');
    });

    it('parseViewportSpec parses WIDTHxHEIGHT', () => {
        expect(parseViewportSpec('1600x900')).toEqual({ width: 1600, height: 900 });
    });

    it('describeRegion returns a concrete hint for named regions', () => {
        expect(describeRegion('left-panel')).toContain('left-side results panel');
        expect(describeRegion('center-map')).toContain('center map canvas');
    });

    it('resolveRegionClip returns deterministic clips for known regions', () => {
        expect(resolveRegionClip('left-panel', { width: 1440, height: 900 })).toEqual({
            x: 0,
            y: 0,
            width: 440,
            height: 900,
        });
        expect(resolveRegionClip('top-bar', { width: 1440, height: 900 })).toEqual({
            x: 0,
            y: 0,
            width: 1440,
            height: 180,
        });
    });

    it('clipAroundPoint keeps the verification clip inside viewport bounds', () => {
        expect(clipAroundPoint({ x: 20, y: 20 }, { width: 1200, height: 800 }, { width: 280, height: 200 })).toEqual({
            x: 0,
            y: 0,
            width: 280,
            height: 200,
        });
    });
});
