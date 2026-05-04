import { describe, expect, it } from 'vitest';
import { auditSources, extractClaims, extractInlineSources } from '../../web-ai/source-audit.mjs';

describe('source audit', () => {
    it('extracts inline markdown and bare URL sources', () => {
        expect(extractInlineSources('A [primary](https://openai.com/docs). Also https://example.com/path.')).toEqual([
            'https://openai.com/docs',
            'https://example.com/path',
        ]);
    });

    it('reports unsourced claims and source quality rows', () => {
        const report = auditSources([
            'OpenAI documents the Responses API at [docs](https://platform.openai.com/docs/api-reference/responses).',
            'This second statement has no source.',
        ].join('\n'));

        expect(report.ok).toBe(false);
        expect(report.claims).toHaveLength(2);
        expect(report.claimsWithInlineSource).toHaveLength(1);
        expect(report.unsourcedClaims[0].text).toContain('no source');
        expect(report.sourceQualityRows[0]).toMatchObject({
            host: 'platform.openai.com',
            quality: 'primary',
        });
        expect(report.gaps.map(gap => gap.code)).toContain('unsourced-claims');
    });

    it('passes when every claim has an inline source', () => {
        const report = auditSources('Gemini docs are hosted by Google at https://ai.google.dev/.');

        expect(report.ok).toBe(true);
        expect(report.claims).toHaveLength(1);
        expect(report.unsourcedClaims).toHaveLength(0);
    });

    it('requires checked scope and date for absence claims', () => {
        const claim = 'No public benchmark exists for [this exact setup](https://example.com/check).';
        const missingScope = auditSources(claim);
        expect(missingScope.ok).toBe(false);
        expect(missingScope.gaps.map(gap => gap.code)).toContain('absence-scope-missing');

        const scoped = auditSources(claim, {
            checkedScope: 'project docs and public repo',
            checkedDate: '2026-05-05',
        });
        expect(scoped.ok).toBe(true);
    });

    it('ignores code fences and headings when extracting claims', () => {
        const claims = extractClaims([
            '# Heading',
            '```js',
            'const url = "https://example.com";',
            '```',
            'A real claim with https://example.com/source.',
        ].join('\n'));

        expect(claims).toHaveLength(1);
        expect(claims[0].text).toContain('A real claim');
    });
});
