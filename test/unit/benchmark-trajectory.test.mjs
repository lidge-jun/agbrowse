import { describe, expect, it } from 'vitest';
import {
    appendTrajectoryStep,
    createTrajectory,
    finalizeTrajectory,
    TRAJECTORY_VERSION,
} from '../../benchmarks/agbrowse/trajectory.mjs';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('benchmark trajectory format', () => {
    it('creates deterministic versioned trajectory records without raw observations', () => {
        const trajectory = createTrajectory({
            taskId: 'provider-copy-001',
            gitCommit: 'abc123',
            model: 'gpt-pro',
            planner: 'manual',
            driver: 'agbrowse',
            maxSteps: 2,
            startedAt: '2026-05-05T00:00:00.000Z',
        });
        appendTrajectoryStep(trajectory, {
            command: 'web-ai query',
            observation: 'secret answer text should be hashed',
            traceId: 'trace-1',
        });
        finalizeTrajectory(trajectory, {
            finalAnswer: 'done',
            verdict: { status: 'pass' },
            completedAt: '2026-05-05T00:01:00.000Z',
        });

        expect(trajectory.trajectoryVersion).toBe(TRAJECTORY_VERSION);
        expect(trajectory.steps).toHaveLength(1);
        expect(trajectory.steps[0]).not.toHaveProperty('observation');
        expect(trajectory.steps[0].observationHash).toMatch(/^sha256:/);
        expect(trajectory.finalAnswerHash).toMatch(/^sha256:/);
        expect(trajectory.finalAnswer).toBe('done');
    });

    it('rejects invalid max step budgets before benchmark execution', () => {
        expect(() => createTrajectory({ taskId: 'x', maxSteps: 0 })).toThrow(/maxSteps/);
        expect(() => createTrajectory({ taskId: 'x', maxSteps: 201 })).toThrow(/maxSteps/);
    });

    it('writes offline trajectory bundles without live browser execution', async () => {
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agbrowse-trajectory-'));
        const inputPath = path.join(temp, 'input.json');
        const outputDir = path.join(temp, 'out');
        await fs.writeFile(inputPath, JSON.stringify({
            taskId: 'offline-task',
            model: 'fixture',
            planner: 'external',
            steps: [{ command: 'snapshot', observation: 'sensitive page text' }],
            finalAnswer: 'done',
            verdict: { status: 'pass' },
        }), 'utf8');
        await execFileAsync(process.execPath, [
            'benchmarks/agbrowse/run-task.mjs',
            '--input',
            inputPath,
            '--output-dir',
            outputDir,
            '--json',
        ], { cwd: repoRoot });
        const bundle = JSON.parse(await fs.readFile(path.join(outputDir, 'trajectory.json'), 'utf8'));
        expect(bundle.taskId).toBe('offline-task');
        expect(bundle.steps[0].observationHash).toMatch(/^sha256:/);
        expect(JSON.stringify(bundle)).not.toContain('sensitive page text');
    });
});
