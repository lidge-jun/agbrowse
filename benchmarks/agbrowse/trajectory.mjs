// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const TRAJECTORY_VERSION = 1;

/**
 * @typedef {Object} TrajectoryInput
 * @property {string} taskId
 * @property {string} [startedAt]
 * @property {string|null} [gitCommit]
 * @property {string} [model]
 * @property {string} [planner]
 * @property {string} [driver]
 * @property {string} [browserEnvironment]
 * @property {number|string} [maxSteps]
 * @property {string|null} [tracePath]
 */

/**
 * @typedef {Object} TrajectoryStep
 * @property {number} index
 * @property {string} type
 * @property {string} command
 * @property {string} status
 * @property {string|null} startedAt
 * @property {string|null} completedAt
 * @property {string} observationHash
 * @property {string|null} traceId
 * @property {string|null} errorCode
 * @property {string|null} notes
 */

/**
 * @typedef {Object} TrajectoryStepInput
 * @property {string} command
 * @property {string} [type]
 * @property {string} [status]
 * @property {string|null} [startedAt]
 * @property {string|null} [completedAt]
 * @property {string} [observationHash]
 * @property {string} [observation]
 * @property {string|null} [traceId]
 * @property {string|null} [errorCode]
 * @property {string|null} [notes]
 */

/**
 * @typedef {Object} Trajectory
 * @property {number} trajectoryVersion
 * @property {string} taskId
 * @property {string|null} gitCommit
 * @property {string} model
 * @property {string} planner
 * @property {string} driver
 * @property {string} browserEnvironment
 * @property {number} maxSteps
 * @property {TrajectoryStep[]} steps
 * @property {string} finalAnswer
 * @property {string} [finalAnswerHash]
 * @property {string|null} verdict
 * @property {string|null} tracePath
 * @property {string} startedAt
 * @property {string|null} completedAt
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} FinalizeInput
 * @property {string} [finalAnswer]
 * @property {string|null} [verdict]
 * @property {string} [completedAt]
 */

/**
 * @param {TrajectoryInput} input
 * @returns {Trajectory}
 */
export function createTrajectory(input = /** @type {any} */ ({})) {
    const now = input.startedAt || new Date().toISOString();
    return {
        trajectoryVersion: TRAJECTORY_VERSION,
        taskId: requireString(input.taskId, 'taskId'),
        gitCommit: input.gitCommit || null,
        model: input.model || 'unspecified',
        planner: input.planner || 'external',
        driver: input.driver || 'agbrowse',
        browserEnvironment: input.browserEnvironment || 'local-chrome',
        maxSteps: normalizeMaxSteps(input.maxSteps),
        steps: [],
        finalAnswer: '',
        verdict: null,
        tracePath: input.tracePath || null,
        startedAt: now,
        completedAt: null,
        warnings: [],
    };
}

/**
 * @param {Trajectory} trajectory
 * @param {TrajectoryStepInput} step
 * @returns {Trajectory}
 */
export function appendTrajectoryStep(trajectory, step = /** @type {any} */ ({})) {
    assertTrajectory(trajectory);
    const index = trajectory.steps.length + 1;
    trajectory.steps.push({
        index,
        type: step.type || 'tool',
        command: requireString(step.command, 'command'),
        status: step.status || 'ok',
        startedAt: step.startedAt || null,
        completedAt: step.completedAt || null,
        observationHash: step.observationHash || hashText(step.observation || ''),
        traceId: step.traceId || null,
        errorCode: step.errorCode || null,
        notes: step.notes || null,
    });
    if (trajectory.steps.length > trajectory.maxSteps) {
        trajectory.warnings.push('max-steps-exceeded');
    }
    return trajectory;
}

/**
 * @param {Trajectory} trajectory
 * @param {FinalizeInput} input
 * @returns {Trajectory}
 */
export function finalizeTrajectory(trajectory, input = /** @type {any} */ ({})) {
    assertTrajectory(trajectory);
    trajectory.finalAnswer = input.finalAnswer || '';
    trajectory.finalAnswerHash = hashText(trajectory.finalAnswer);
    trajectory.verdict = input.verdict || null;
    trajectory.completedAt = input.completedAt || new Date().toISOString();
    return trajectory;
}

/**
 * @param {Trajectory} trajectory
 * @param {string} outputDir
 * @returns {Promise<{ ok: true, path: string }>}
 */
export async function writeTrajectoryBundle(trajectory, outputDir) {
    assertTrajectory(trajectory);
    const dir = path.resolve(outputDir || '.');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'trajectory.json');
    await fs.writeFile(file, `${JSON.stringify(trajectory, null, 2)}\n`, 'utf8');
    return { ok: true, path: file };
}

/**
 * @param {unknown} value
 * @returns {asserts value is Trajectory}
 */
function assertTrajectory(value) {
    if (!value || (/** @type {any} */ (value)).trajectoryVersion !== TRAJECTORY_VERSION || !Array.isArray((/** @type {any} */ (value)).steps)) {
        throw new Error('invalid trajectory object');
    }
}

/**
 * @param {number|string|undefined|null} value
 * @returns {number}
 */
function normalizeMaxSteps(value) {
    const parsed = value === undefined || value === null ? 20 : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
        throw new Error('maxSteps must be an integer between 1 and 200');
    }
    return parsed;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireString(value, field) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${field} is required`);
    return normalized;
}

/**
 * @param {string} value
 * @returns {string}
 */
function hashText(value) {
    return `sha256:${createHash('sha256').update(String(value || '')).digest('hex')}`;
}
