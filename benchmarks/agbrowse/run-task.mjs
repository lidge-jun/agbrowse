#!/usr/bin/env node
// @ts-check
import fs from 'node:fs/promises';
import process from 'node:process';
import {
    appendTrajectoryStep,
    createTrajectory,
    finalizeTrajectory,
    writeTrajectoryBundle,
} from './trajectory.mjs';

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
async function main(argv = process.argv.slice(2)) {
    const opts = parseArgs(argv);
    if (opts.help) {
        printHelp();
        return 0;
    }
    const inputPath = opts.input;
    if (!inputPath) throw new Error('missing --input <file>');
    const outputDir = opts.outputDir || 'benchmark-output';
    const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
    const trajectory = createTrajectory(input);
    for (const step of input.steps || []) appendTrajectoryStep(trajectory, step);
    finalizeTrajectory(trajectory, {
        finalAnswer: input.finalAnswer || '',
        verdict: input.verdict || null,
        completedAt: input.completedAt,
    });
    const result = await writeTrajectoryBundle(trajectory, outputDir);
    if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, ...(/** @type {any} */ (result)) }, null, 2)}\n`);
    } else {
        process.stdout.write(`wrote trajectory: ${result.path}\n`);
    }
    return 0;
}

/**
 * @param {string[]} argv
 * @returns {{ help?: boolean, json?: boolean, input?: string, outputDir?: string }}
 */
function parseArgs(argv) {
    /** @type {{ help?: boolean, json?: boolean, input?: string, outputDir?: string }} */
    const opts = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') opts.help = true;
        else if (arg === '--json') opts.json = true;
        else if (arg === '--input') opts.input = argv[++i];
        else if (arg === '--output-dir') opts.outputDir = argv[++i];
        else throw new Error(`unknown option: ${arg}`);
    }
    return opts;
}

function printHelp() {
    process.stdout.write(`Usage: node benchmarks/agbrowse/run-task.mjs --input <file> [--output-dir <dir>] [--json]

Builds a sanitized agbrowse benchmark trajectory bundle from an offline JSON
description. It does not drive live providers, open Chrome, or publish scores.
`);
}

main().then(
    (code) => process.exit(code),
    (error) => {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    },
);
