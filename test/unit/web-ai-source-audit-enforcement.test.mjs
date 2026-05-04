import { describe, expect, it } from 'vitest';
import { applyRequiredSourceAudit, parseSourceAuditRatio } from '../../web-ai/cli.mjs';

describe('web-ai source audit enforcement', () => {
    it('attaches a passing source audit to completed answers', () => {
        const result = applyRequiredSourceAudit('query', {
            ok: true,
            vendor: 'grok',
            status: 'complete',
            answerText: 'Grok has a source audit mode [Source](https://x.ai).',
        }, {
            requireSourceAudit: true,
        });

        expect(result.sourceAudit.ok).toBe(true);
        expect(result.sourceAudit.claims).toHaveLength(1);
        expect(result.sourceAudit.unsourcedClaims).toHaveLength(0);
    });

    it('fails completed answers with unsourced claims', () => {
        expect(() => applyRequiredSourceAudit('query', {
            ok: true,
            vendor: 'grok',
            status: 'complete',
            answerText: 'Grok has a source audit mode.',
        }, {
            requireSourceAudit: true,
        })).toThrow(/source audit failed: unsourced-claims/);
    });

    it('requires checked scope and date for absence claims', () => {
        const result = {
            ok: true,
            vendor: 'grok',
            status: 'complete',
            answerText: 'No official response was found [Source](https://x.ai).',
        };

        expect(() => applyRequiredSourceAudit('query', result, {
            requireSourceAudit: true,
        })).toThrow(/absence-scope-missing/);

        const passed = applyRequiredSourceAudit('query', { ...result }, {
            requireSourceAudit: true,
            sourceAuditScope: 'x.ai official posts',
            sourceAuditDate: '2026-05-05',
        });
        expect(passed.sourceAudit.ok).toBe(true);
    });

    it('does not audit render/send results that have no answer text', () => {
        const result = applyRequiredSourceAudit('render', {
            ok: true,
            vendor: 'grok',
            status: 'rendered',
        }, {
            requireSourceAudit: true,
        });

        expect(result.sourceAudit).toBeUndefined();
    });

    it('validates source audit ratios', () => {
        expect(parseSourceAuditRatio(undefined)).toBe(1);
        expect(parseSourceAuditRatio('0.5')).toBe(0.5);
        expect(() => parseSourceAuditRatio('1.5')).toThrow(/between 0 and 1/);
    });
});
