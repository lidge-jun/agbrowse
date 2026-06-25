// @ts-check

// Parity catalog 202 A1 (search candidate-space discipline). cli-jaw's search SKILL
// "anchor on the rarest clue, enumerate 3+ rivals, candidate×constraint matrix,
// disconfirmation pass, WEAK-match flag" — the matrix + supported/pending already exist;
// this adds the algorithmic pieces the ledger lacked: anchorConstraintId, a rivals[] slot,
// a disconfirmation pass, and a weak-evidence flag.

/**
 * @param {Array<{ id: string, text: string, mandatory?: boolean }>} constraints
 * @param {{ anchorConstraintId?: string }} [options]
 */
export function createConstraintLedger(constraints = [], options = {}) {
    return {
        constraints: constraints.map(constraint => ({
            id: constraint.id,
            text: constraint.text,
            mandatory: constraint.mandatory !== false,
            status: 'pending',
            evidence: [],
        })),
        candidates: [],
        // A1: anchor on the rarest (most specific) clue; rivals are enumerated separately.
        anchorConstraintId: options.anchorConstraintId || deriveAnchorConstraintId(constraints),
        rivals: [],
        pending: constraints.map(constraint => constraint.id),
        supported: [],
        ready: false,
    };
}

/**
 * A1: pick the rarest/most-discriminating constraint to anchor on. Heuristic: the mandatory
 * constraint with the most specific (longest normalized) text; falls back to the first.
 * @param {Array<{ id: string, text: string, mandatory?: boolean }>} constraints
 * @returns {string|null}
 */
export function deriveAnchorConstraintId(constraints = []) {
    if (!constraints.length) return null;
    const ranked = [...constraints]
        .map((c, index) => ({ id: c.id, index, mandatory: c.mandatory !== false, weight: normalizeForMatch(c.text).length }))
        .sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || b.weight - a.weight || a.index - b.index);
    return ranked[0]?.id ?? null;
}

/**
 * A1: register enumerated rival candidate names (M2 "enumerate 3+ rivals"). Immutable.
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 * @param {string[]} names
 */
export function registerRivals(ledger, names = []) {
    const next = cloneLedger(ledger);
    const seen = new Set(next.rivals || []);
    for (const name of names) {
        const trimmed = String(name || '').trim();
        if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            (next.rivals ||= []).push(trimmed);
        }
    }
    return next;
}

/**
 * A1: have at least `min` distinct candidates been considered (rivals ∪ matrix candidates)?
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 * @param {number} [min]
 * @returns {boolean}
 */
export function hasSufficientRivals(ledger, min = 3) {
    const names = new Set([...(ledger.rivals || []), ...ledger.candidates.map(c => c.name)]);
    return names.size >= min;
}

/**
 * A1: disconfirmation pass — flag a candidate as ruled out so it is excluded from selection.
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 * @param {string} name
 * @param {string} [reason]
 */
export function markCandidateDisconfirmed(ledger, name, reason = '') {
    const next = cloneLedger(ledger);
    const candidate = getOrCreateCandidate(next, name);
    candidate.disconfirmed = true;
    candidate.disconfirmReason = reason;
    return next;
}

/**
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 * @param {{ url: string, title?: string, text?: string, candidate?: string, constraintIds?: string[], source?: string }} evidence
 */
export function updateLedgerWithEvidence(ledger, evidence) {
    const next = cloneLedger(ledger);
    const body = `${evidence.title || ''}\n${evidence.text || ''}`;
    const explicit = Boolean(evidence.constraintIds?.length);
    // A1: capture per-constraint weak (borderline) status when deriving from text. Explicit
    // constraintIds are caller-asserted and trusted (not weak).
    const scores = new Map(
        next.constraints.map(constraint => [constraint.id, scoreConstraintSupport(body, constraint.text)]),
    );
    const supportedIds = explicit
        ? /** @type {string[]} */ (evidence.constraintIds)
        : next.constraints.filter(constraint => scores.get(constraint.id)?.supported).map(constraint => constraint.id);

    for (const constraint of next.constraints) {
        if (!supportedIds.includes(constraint.id)) continue;
        constraint.status = 'supported';
        constraint.evidence.push({
            url: evidence.url,
            title: evidence.title || '',
            source: evidence.source || 'fetch',
            weak: explicit ? false : Boolean(scores.get(constraint.id)?.weak),
        });
    }

    if (evidence.candidate) {
        const candidate = getOrCreateCandidate(next, evidence.candidate);
        for (const constraintId of supportedIds) {
            candidate.support[constraintId] ||= [];
            candidate.support[constraintId].push(evidence.url);
        }
    }

    return refreshLedgerStatus(next);
}

/**
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 */
export function summarizeLedger(ledger) {
    const refreshed = refreshLedgerStatus(cloneLedger(ledger));
    // A1: a supported constraint is "weak" when it has evidence yet every entry is borderline.
    const weakConstraints = refreshed.constraints
        .filter(c => c.status === 'supported' && c.evidence.length > 0 && c.evidence.every(e => e.weak === true))
        .map(c => c.id);
    return {
        ready: refreshed.ready,
        supported: refreshed.supported,
        pending: refreshed.pending,
        status: refreshed.ready ? 'complete' : 'insufficient-evidence',
        anchorConstraintId: refreshed.anchorConstraintId ?? null,
        rivals: refreshed.rivals || [],
        weak: weakConstraints.length > 0,
        weakConstraints,
    };
}

/**
 * Score how well text supports a constraint. `weak` (A1) marks a borderline match — exactly
 * at the minimum hit threshold — so thin evidence can be flagged rather than silently trusted.
 * @param {string} text
 * @param {string} constraint
 * @returns {{ supported: boolean, weak: boolean, hits: number, threshold: number }}
 */
export function scoreConstraintSupport(text = '', constraint = '') {
    const haystack = normalizeForMatch(text);
    const terms = normalizeForMatch(constraint)
        .split(' ')
        .filter(term => term.length >= 2)
        .filter(term => !['그리고', '또는', '모두', '동시에', '확인', '필요'].includes(term));
    if (terms.length === 0) return { supported: false, weak: false, hits: 0, threshold: 0 };
    const hits = terms.filter(term => haystack.includes(term)).length;
    const threshold = Math.min(2, terms.length);
    const supported = hits >= threshold;
    return { supported, weak: supported && hits === threshold, hits, threshold };
}

/**
 * @param {string} text
 * @param {string} constraint
 */
export function textSupportsConstraint(text = '', constraint = '') {
    return scoreConstraintSupport(text, constraint).supported;
}

/**
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 * @param {string} name
 */
function getOrCreateCandidate(ledger, name) {
    let candidate = ledger.candidates.find(item => item.name === name);
    if (!candidate) {
        candidate = { name, support: {} };
        ledger.candidates.push(candidate);
    }
    return candidate;
}

/**
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 */
function refreshLedgerStatus(ledger) {
    ledger.supported = ledger.constraints
        .filter(constraint => constraint.status === 'supported')
        .map(constraint => constraint.id);
    ledger.pending = ledger.constraints
        .filter(constraint => constraint.mandatory && constraint.status !== 'supported')
        .map(constraint => constraint.id);
    ledger.ready = ledger.pending.length === 0;
    return ledger;
}

/**
 * @param {ReturnType<typeof createConstraintLedger>} ledger
 */
function cloneLedger(ledger) {
    return JSON.parse(JSON.stringify(ledger));
}

/**
 * @param {string} text
 */
function normalizeForMatch(text) {
    return String(text || '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
