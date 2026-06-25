import { describe, expect, it } from 'vitest';
import {
    createConstraintLedger,
    deriveAnchorConstraintId,
    registerRivals,
    hasSufficientRivals,
    markCandidateDisconfirmed,
    scoreConstraintSupport,
    updateLedgerWithEvidence,
    summarizeLedger,
} from '../../skills/browser/search-research/constraint-ledger.mjs';

// Parity catalog 202 A1: anchor-rarest + rivals + disconfirmation + weak flag.
describe('search constraint ledger (A1 enrichment)', () => {
    it('deriveAnchorConstraintId picks the most specific mandatory constraint', () => {
        const id = deriveAnchorConstraintId([
            { id: 'short', text: 'fast' },
            { id: 'specific', text: 'released in the late 1990s on a major label' },
            { id: 'opt', text: 'a very long but optional clue here indeed', mandatory: false },
        ]);
        expect(id).toBe('specific'); // longest mandatory wins over optional
    });

    it('createConstraintLedger sets a default anchor and an empty rivals slot', () => {
        const ledger = createConstraintLedger([{ id: 'a', text: 'the rarest clue text' }, { id: 'b', text: 'big' }]);
        expect(ledger.anchorConstraintId).toBe('a');
        expect(ledger.rivals).toEqual([]);
        // explicit override honored
        expect(createConstraintLedger([{ id: 'a', text: 'x' }], { anchorConstraintId: 'b' }).anchorConstraintId).toBe('b');
    });

    it('registerRivals dedups and accumulates; hasSufficientRivals counts rivals ∪ candidates', () => {
        let ledger = createConstraintLedger([{ id: 'c1', text: 'one' }]);
        ledger = registerRivals(ledger, ['Alpha', 'Beta', 'Alpha', ' ']);
        expect(ledger.rivals).toEqual(['Alpha', 'Beta']);
        expect(hasSufficientRivals(ledger, 3)).toBe(false);
        ledger = registerRivals(ledger, ['Gamma']);
        expect(hasSufficientRivals(ledger, 3)).toBe(true);
    });

    it('markCandidateDisconfirmed flags a candidate with a reason', () => {
        let ledger = createConstraintLedger([{ id: 'c1', text: 'one' }]);
        ledger = markCandidateDisconfirmed(ledger, 'Beta', 'failed era constraint');
        const beta = ledger.candidates.find(c => c.name === 'Beta');
        expect(beta.disconfirmed).toBe(true);
        expect(beta.disconfirmReason).toBe('failed era constraint');
    });

    it('scoreConstraintSupport flags weak at the threshold, strong above it', () => {
        expect(scoreConstraintSupport('a quantum computer device', 'quantum computer')).toMatchObject({ supported: true, weak: true });
        expect(scoreConstraintSupport('a red round fruit apple', 'red round fruit')).toMatchObject({ supported: true, weak: false });
        expect(scoreConstraintSupport('totally different text', 'quantum computer')).toMatchObject({ supported: false, weak: false });
    });

    it('summarizeLedger surfaces weak constraints + preserves existing fields', () => {
        let ledger = createConstraintLedger([
            { id: 'weakC', text: 'quantum computer' },
            { id: 'strongC', text: 'red round fruit' },
        ]);
        ledger = updateLedgerWithEvidence(ledger, { url: 'https://e/1', text: 'a quantum computer here' }); // weak (2 terms, 2 hits)
        ledger = updateLedgerWithEvidence(ledger, { url: 'https://e/2', text: 'a red round fruit basket' }); // strong (3 hits)
        const summary = summarizeLedger(ledger);
        // backward-compat fields intact
        expect(summary).toMatchObject({ ready: true, status: 'complete' });
        expect(summary.supported.sort()).toEqual(['strongC', 'weakC']);
        // A1 additions
        expect(summary.weak).toBe(true);
        expect(summary.weakConstraints).toEqual(['weakC']);
        expect(summary.anchorConstraintId).toBeTruthy();
    });

    it('explicit constraintIds are trusted (not flagged weak)', () => {
        let ledger = createConstraintLedger([{ id: 'c1', text: 'quantum computer' }]);
        ledger = updateLedgerWithEvidence(ledger, { url: 'https://e/1', constraintIds: ['c1'], text: '' });
        expect(summarizeLedger(ledger).weak).toBe(false);
    });
});
