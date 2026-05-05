import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const TRAJECTORY_VERSION = 1;

export function createTrajectory(input = {}) {
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

export function appendTrajectoryStep(trajectory, step = {}) {
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

export function finalizeTrajectory(trajectory, input = {}) {
    assertTrajectory(trajectory);
    trajectory.finalAnswer = input.finalAnswer || '';
    trajectory.finalAnswerHash = hashText(trajectory.finalAnswer);
    trajectory.verdict = input.verdict || null;
    trajectory.completedAt = input.completedAt || new Date().toISOString();
    return trajectory;
}

export async function writeTrajectoryBundle(trajectory, outputDir) {
    assertTrajectory(trajectory);
    const dir = path.resolve(outputDir || '.');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'trajectory.json');
    await fs.writeFile(file, `${JSON.stringify(trajectory, null, 2)}\n`, 'utf8');
    return { ok: true, path: file };
}

function assertTrajectory(value) {
    if (!value || value.trajectoryVersion !== TRAJECTORY_VERSION || !Array.isArray(value.steps)) {
        throw new Error('invalid trajectory object');
    }
}

function normalizeMaxSteps(value) {
    const parsed = value === undefined || value === null ? 20 : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
        throw new Error('maxSteps must be an integer between 1 and 200');
    }
    return parsed;
}

function requireString(value, field) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${field} is required`);
    return normalized;
}

function hashText(value) {
    return `sha256:${createHash('sha256').update(String(value || '')).digest('hex')}`;
}
