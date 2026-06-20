// @ts-check
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    assertFreshObservationBundle,
    reconcileVisionCandidate,
} from '../../web-ai/candidate-reconcile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('candidate reconciliation', () => {
    it('prefers a ref when the vision candidate center is inside its box', () => {
        const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'browser-ref-vs-coordinate.json'), 'utf8'));
        expect(reconcileVisionCandidate({ candidate: fixture.candidate, bundle: fixture.bundle })).toMatchObject(fixture.expected);
    });

    it('fails when multiple boxes contain the candidate point', () => {
        const result = reconcileVisionCandidate({
            candidate: { point: { x: 50, y: 50 } },
            bundle: {
                refs: [
                    { ref: '@e1', role: 'button', name: 'A', box: { x: 0, y: 0, width: 100, height: 100 } },
                    { ref: '@e2', role: 'button', name: 'B', box: { x: 0, y: 0, width: 100, height: 100 } },
                ],
            },
        });
        expect(result).toMatchObject({ action: 'fail', code: 'COMPUTER_TARGET_AMBIGUOUS' });
    });

    it('falls back to coordinates when no ref box matches', () => {
        const result = reconcileVisionCandidate({
            candidate: { point: { x: 500, y: 500 } },
            bundle: { refs: [{ ref: '@e1', role: 'button', name: 'A', box: { x: 0, y: 0, width: 100, height: 100 } }] },
        });
        expect(result).toMatchObject({ action: 'coordinate' });
    });

    it('rejects stale observation bundles before coordinate fallback', () => {
        const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'browser-observation-stale.json'), 'utf8'));
        expect(() => assertFreshObservationBundle(fixture, fixture.current)).toThrow('COMPUTER_OBSERVATION_STALE');
        expect(() => assertFreshObservationBundle(fixture, {
            url: fixture.basis.url,
            targetId: fixture.basis.targetId,
        })).not.toThrow();
    });
});
