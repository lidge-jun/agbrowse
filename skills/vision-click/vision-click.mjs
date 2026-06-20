#!/usr/bin/env node
// @ts-check
/**
 * vision-click.mjs — Vision-based coordinate click via Codex CLI
 *
 * Usage:
 *   agbrowse-vision-click "<target>" [--port N] [--double] [--prepare-stable] [--region left-panel]
 *
 * Pipeline: screenshot → optional clip → codex exec (NDJSON) → optional verify crop → DPR correction → mouse click → verify
 *
 * Requires:
 *   - agbrowse running Chrome
 *   - codex CLI installed (npm install -g @openai/codex)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildCoordPrompt,
    candidateCenter,
    extractVisionCandidateJson,
    assertCodexCli,
    applyDprCorrection,
    clipAroundPoint,
    describeRegion,
    isLowConfidence,
    parseVisionClickCliArgs,
    resolveRegionClip,
    validateVisionCandidate,
} from './vision-core.mjs';
import { assertFreshObservationBundle, reconcileVisionCandidate } from '../../web-ai/candidate-reconcile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────
const DEFAULT_BROWSER_SCRIPT = process.env.BROWSER_SCRIPT || join(__dirname, '..', 'browser', 'browser.mjs');
const DEFAULT_CDP_PORT = process.env.CDP_PORT || '9222';

// ─── ANSI colors ─────────────────────────────────
const c = {
    reset: '\x1b[0m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m',
};

// ═══════════════════════════════════════════════════
//  Browser Script Helper
// ═══════════════════════════════════════════════════

/**
 * @param {string[]} args
 * @param {{browserScript?:string, port?:string|number}} [opts]
 * @returns {string}
 */
function browserCmd(args, opts = {}) {
    const browserScript = opts.browserScript || DEFAULT_BROWSER_SCRIPT;
    const portArgs = opts.port ? ['--port', String(opts.port)] : [];
    const allArgs = [browserScript, ...args, ...portArgs];
    try {
        return execFileSync('node', allArgs, {
            encoding: 'utf-8',
            timeout: 30000,
            env: /** @type {any} */ ({ ...process.env, CDP_PORT: opts.port || DEFAULT_CDP_PORT }),
        }).trim();
    } catch (e) {
        throw new Error(`browser.mjs ${args[0]} failed: ${(/** @type {any} */ (e)).stderr || (/** @type {any} */ (e)).message}`);
    }
}

// ═══════════════════════════════════════════════════
//  Codex CLI Vision (NDJSON)
// ═══════════════════════════════════════════════════
//
// `codex exec --json` emits newline-delimited JSON events to stdout:
//   {"type":"thread.started","thread_id":"..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"{\"found\":true,\"x\":...,\"y\":...}"}}
//   {"type":"turn.completed","usage":{...}}

/**
 * @param {string} screenshotPath
 * @param {string} prompt
 * @returns {import('./vision-core.mjs').VisionCandidate}
 */
function codexVisionWithPrompt(screenshotPath, prompt) {
    const args = [
        'exec', '-i', screenshotPath, '--json',
        '--dangerously-bypass-approvals-and-sandbox',
        '--skip-git-repo-check',
        '--ephemeral',
        prompt,
    ];

    let stdout;
    try {
        stdout = execFileSync('codex', args, {
            encoding: 'utf-8',
            timeout: 90000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch (e) {
        throw new Error(`codex exec failed: ${((/** @type {any} */ (e)).stderr || (/** @type {any} */ (e)).message).slice(0, 300)}`);
    }

    // Parse NDJSON lines, scan from last to first for item.completed with coordinates
    const lines = stdout.split('\n').filter(l => l.trim());
    for (const line of lines.reverse()) {
        try {
            const event = JSON.parse(line);
            const text = event.item?.text || event.item?.aggregated_output || '';
            if (!text) continue;
            const candidate = extractVisionCandidateJson(text);
            if (candidate) return candidate;
        } catch { /* skip non-JSON lines */ }
    }
    throw new Error(`No vision candidate JSON in codex NDJSON output (${lines.length} lines)`);
}

/**
 * @param {string} screenshotPath
 * @param {string} target
 * @param {any} [options]
 * @returns {import('./vision-core.mjs').VisionCandidate}
 */
function codexVision(screenshotPath, target, options = {}) {
    return codexVisionWithPrompt(screenshotPath, buildCoordPrompt(target, options));
}

/**
 * @param {any} [opts]
 * @param {{x:number,y:number,width:number,height:number}|null} [clip]
 * @returns {string[]}
 */
function screenshotJsonArgs(opts = {}, clip = null) {
    const args = ['screenshot', '--json'];
    const effectiveClip = clip || opts.clip;
    if (effectiveClip) {
        args.push('--clip', String(effectiveClip.x), String(effectiveClip.y), String(effectiveClip.width), String(effectiveClip.height));
    }
    return args;
}

/**
 * @param {any} [opts]
 * @returns {{width:number,height:number}|null}
 */
function prepareStableViewport(opts = {}) {
    if (!opts.prepareStable && !opts.viewport) return null;
    const viewport = opts.viewport || { width: 1440, height: 900 };
    browserCmd(['resize', String(viewport.width), String(viewport.height)], opts);
    browserCmd(['wait', '250'], opts);
    return viewport;
}

/**
 * @param {string|null|undefined} path
 * @returns {any|null}
 */
function loadObservationBundle(path) {
    if (!path) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @param {any} opts
 * @param {{width:number,height:number}} viewport
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
function resolveInitialClip(opts, viewport) {
    if (opts.clip) return opts.clip;
    if (opts.region) return resolveRegionClip(opts.region, viewport);
    return null;
}

/**
 * @param {{x:number,y:number}} raw
 * @param {number} dpr
 * @param {{x:number,y:number,width:number,height:number}|null} [clip]
 * @returns {{x:number,y:number}}
 */
function convertRawToCss(raw, dpr, clip = null) {
    const local = applyDprCorrection(raw.x, raw.y, dpr);
    if (!clip) return local;
    return {
        x: clip.x + local.x,
        y: clip.y + local.y,
    };
}

/**
 * @param {string} target
 * @param {{dpr:number, viewport:{width:number,height:number}, clip:{x:number,y:number,width:number,height:number}|null}} capture
 * @param {import('./vision-core.mjs').VisionCandidate} initialResult
 * @param {any} [opts]
 * @returns {{raw:{x:number,y:number}, css:{x:number,y:number}, clip:{x:number,y:number,width:number,height:number}, description?:string}}
 */
function verifyCandidate(target, capture, initialResult, opts = {}) {
    const center = candidateCenter(initialResult);
    const cssPoint = convertRawToCss(center, capture.dpr, capture.clip);
    const verifyClip = clipAroundPoint(cssPoint, capture.viewport, { width: 280, height: 200 });
    const verifyCapture = JSON.parse(browserCmd(screenshotJsonArgs(opts, verifyClip), opts));
    const regionHint = describeRegion(opts.region);
    const verified = codexVision(verifyCapture.path, target, {
        regionHint: [regionHint, 'This is a zoomed verification crop around the candidate location.'].filter(Boolean).join(' '),
        centerBias: true,
        preferContainer: true,
    });

    if (!verified.found) {
        throw new Error('Verification crop did not contain the target');
    }

    validateVisionCandidate(verified, { viewport: { width: verifyClip.width, height: verifyClip.height }, dpr: verifyCapture.dpr || capture.dpr || 1 });
    const verifyCenter = candidateCenter(verified);
    const verifyCss = applyDprCorrection(verifyCenter.x, verifyCenter.y, verifyCapture.dpr || capture.dpr || 1);
    const distanceX = Math.abs(verifyCss.x - verifyClip.width / 2);
    const distanceY = Math.abs(verifyCss.y - verifyClip.height / 2);
    if (distanceX > verifyClip.width * 0.45 || distanceY > verifyClip.height * 0.45) {
        throw new Error('Verification candidate was too far from the crop center');
    }

    return {
        raw: {
            x: Math.round((verifyClip.x + verifyCss.x) * capture.dpr),
            y: Math.round((verifyClip.y + verifyCss.y) * capture.dpr),
        },
        css: {
            x: verifyClip.x + verifyCss.x,
            y: verifyClip.y + verifyCss.y,
        },
        clip: verifyClip,
        description: verified.description || initialResult.description,
    };
}

// ═══════════════════════════════════════════════════
//  Vision Click Pipeline
// ═══════════════════════════════════════════════════

/**
 * @param {string} target
 * @param {any} [opts]
 * @returns {{success:boolean, reason?:string, clicked?:{x:number,y:number}, raw?:{x:number,y:number}, dpr?:number, description?:string, candidate?:import('./vision-core.mjs').VisionCandidate, reconciliation?:string, snap?:string|null, clip?:any, verified?:boolean}}
 */
function visionClick(target, opts = {}) {
    const stableViewport = prepareStableViewport(opts);

    // 1. Screenshot (get path + DPR via --json)
    console.error(`${c.dim}📸 Taking screenshot...${c.reset}`);
    const baseCapture = JSON.parse(browserCmd(['screenshot', '--json'], opts));
    const bundle = loadObservationBundle(opts.bundle);
    if (bundle) {
        assertFreshObservationBundle(bundle, { url: baseCapture.url, targetId: baseCapture.targetId });
    }
    const viewport = stableViewport || baseCapture.viewport;
    const clip = resolveInitialClip(opts, viewport);
    const ss = clip
        ? JSON.parse(browserCmd(screenshotJsonArgs(opts, clip), opts))
        : baseCapture;
    const dpr = ss.dpr || 1;
    console.error(`${c.dim}   path: ${ss.path}, dpr: ${dpr}${c.reset}`);
    if (clip) {
        console.error(`${c.dim}   clip: (${clip.x}, ${clip.y}, ${clip.width}, ${clip.height})${c.reset}`);
    }

    // 2. Codex vision → coordinates (image pixel space)
    console.error(`${c.dim}👁️  Analyzing screenshot for "${target}" via codex...${c.reset}`);
    const result = codexVision(ss.path, target, {
        regionHint: describeRegion(opts.region),
        preferContainer: true,
    });

    if (!result.found) {
        return { success: false, reason: 'target not found' };
    }
    validateVisionCandidate(result, { viewport, dpr, clip });

    const requiresVerification =
        result.riskFlags.includes('point_only') ||
        (isLowConfidence(result) && result.confidence >= 0.5);
    if (isLowConfidence(result) && !opts.verifyBeforeClick) {
        return {
            success: false,
            reason: `vision candidate confidence ${result.confidence} is below 0.75; rerun with --verify-before-click`,
        };
    }

    // 3. DPR correction: image pixels → CSS pixels
    let finalRaw = candidateCenter(result);
    let finalCss = convertRawToCss(finalRaw, dpr, clip);
    let verification = null;
    let reconciliation = 'unavailable';
    let shouldVerify = opts.verifyBeforeClick || requiresVerification;

    if (bundle) {
        const decision = reconcileVisionCandidate({ candidate: candidateAtCssPoint(result, finalCss), bundle });
        reconciliation = decision.reason || decision.action;
        if (decision.action === 'fail') {
            throw new Error(`${decision.code || 'COMPUTER_TARGET_AMBIGUOUS'}: ${decision.reason}`);
        }
        if (decision.action === 'ref' && decision.ref) {
            browserCmd(['click', decision.ref], opts);
            return {
                success: true,
                clicked: finalCss,
                raw: finalRaw,
                dpr,
                description: result.description,
                candidate: result,
                reconciliation,
                snap: safeSnapshot(opts),
                clip,
                verified: false,
            };
        }
        shouldVerify = true;
    }

    if (shouldVerify) {
        verification = verifyCandidate(target, { dpr, viewport, clip }, result, opts);
        finalRaw = verification.raw;
        finalCss = verification.css;
        console.error(`${c.dim}   verified via crop: (${verification.clip.x}, ${verification.clip.y}, ${verification.clip.width}, ${verification.clip.height})${c.reset}`);
    }

    if (bundle && verification) {
        const decision = reconcileVisionCandidate({ candidate: candidateAtCssPoint(result, finalCss), bundle });
        reconciliation = decision.reason || decision.action;
        if (decision.action === 'fail') {
            throw new Error(`${decision.code || 'COMPUTER_TARGET_AMBIGUOUS'}: ${decision.reason}`);
        }
        if (decision.action === 'ref' && decision.ref) {
            browserCmd(['click', decision.ref], opts);
            return {
                success: true,
                clicked: finalCss,
                raw: finalRaw,
                dpr,
                description: verification.description || result.description,
                candidate: result,
                reconciliation,
                snap: safeSnapshot(opts),
                clip,
                verified: true,
            };
        }
    }

    console.error(`${c.dim}   raw: (${finalRaw.x}, ${finalRaw.y}) → css: (${finalCss.x}, ${finalCss.y}) [dpr=${dpr}]${c.reset}`);

    // 4. Click
    const clickArgs = ['mouse-click', String(finalCss.x), String(finalCss.y)];
    if (opts.doubleClick) clickArgs.push('--double');
    browserCmd(clickArgs, opts);

    // 5. Verify (optional snapshot)
    let snap = null;
    try {
        snap = browserCmd(['snapshot', '--interactive'], opts);
    } catch { /* ignore */ }

    return {
        success: true,
        clicked: { x: finalCss.x, y: finalCss.y },
        raw: finalRaw,
        dpr,
        description: verification?.description || result.description,
        candidate: result,
        reconciliation,
        snap,
        clip,
        verified: Boolean(verification),
    };
}

/**
 * @param {any} opts
 * @returns {string|null}
 */
function safeSnapshot(opts) {
    try {
        return browserCmd(['snapshot', '--interactive'], opts);
    } catch {
        return null;
    }
}

/**
 * @param {import('./vision-core.mjs').VisionCandidate} candidate
 * @param {{x:number,y:number}} cssPoint
 * @returns {import('./vision-core.mjs').VisionCandidate}
 */
function candidateAtCssPoint(candidate, cssPoint) {
    return {
        ...candidate,
        point: cssPoint,
    };
}

// ═══════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════

const { target, opts } = parseVisionClickCliArgs(process.argv.slice(2), {
    port: DEFAULT_CDP_PORT,
    browserScript: DEFAULT_BROWSER_SCRIPT,
});

if (opts.help || !target) {
    console.log(`
  👁️ agbrowse-vision-click — Vision-based coordinate click via Codex CLI

  Usage:
    agbrowse-vision-click "<target description>" [options]

  Options:
    --double               Double-click instead of single click
    --port <N>             CDP port (default: 9222)
    --browser-script <path>  Path to browser.mjs
    --prepare-stable       Resize to a stable desktop viewport before capture
    --viewport <WxH>       Custom viewport preset, e.g. 1440x900
    --region <name>        Named crop: left-panel, center-map, top-bar
    --clip <x y w h>       Manual crop in CSS pixels
    --bundle <path>        ObservationBundle JSON from observe-bundle --json for ref reconciliation
    --verify-before-click  Re-check a zoomed crop before clicking

  Pipeline:
    screenshot → optional clip → codex exec (bbox/confidence candidate) → optional verify crop → DPR correction → mouse click → verify
    Ref clicks are preferred whenever snapshot --interactive exposes a usable ref. Coordinate click is the last fallback.

  Prerequisites:
    - agbrowse running Chrome (agbrowse start)
    - codex CLI installed (npm install -g @openai/codex)

  Examples:
    agbrowse-vision-click "Login button"
    agbrowse-vision-click "Submit" --double
    agbrowse-vision-click "Play button" --port 9333
    agbrowse-vision-click "first search result row" --prepare-stable --region left-panel --verify-before-click

  Environment:
    BROWSER_SCRIPT         Path to browser.mjs (overrides default)
    CDP_PORT               Default CDP port (default: 9222)
`);
    process.exit(0);
}

// Pre-flight: ensure codex CLI exists
assertCodexCli();

try {
    console.error(`${c.dim}👁️ vision-click: "${target}"...${c.reset}`);
    const result = visionClick(target, opts);

    if (result.success) {
        console.log(`${c.green}🖱️ vision-clicked "${target}" at (${(/** @type {any} */ (result)).clicked.x}, ${(/** @type {any} */ (result)).clicked.y})${c.reset}`);
        if (result.dpr !== 1) {
            console.log(`${c.dim}   DPR=${result.dpr}, raw=(${(/** @type {any} */ (result)).raw.x}, ${(/** @type {any} */ (result)).raw.y})${c.reset}`);
        }
        if (result.description) {
            console.log(`${c.dim}   description: ${result.description}${c.reset}`);
        }
    } else {
        console.log(`${c.red}❌ "${target}" not found: ${result.reason}${c.reset}`);
        process.exitCode = 1;
    }
} catch (e) {
    console.error(`❌ ${(/** @type {any} */ (e)).message}`);
    process.exitCode = 1;
}
