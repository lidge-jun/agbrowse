import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { grokModelLabelPattern, normalizeGrokModelChoice } from '../../web-ai/grok-model.mjs';

const root = process.cwd();
const grokLiveSrc = readFileSync(join(root, 'web-ai/grok-live.mjs'), 'utf8');
const copyMarkdownSrc = readFileSync(join(root, 'web-ai/copy-markdown.mjs'), 'utf8');
const grokModelSrc = readFileSync(join(root, 'web-ai/grok-model.mjs'), 'utf8');

describe('web-ai grok live policy', () => {
    it('matches Korean and English model labels at a word boundary', () => {
        expect(grokModelLabelPattern('전문가').test('전문가 깊이 생각합니다')).toBe(true);
        expect(grokModelLabelPattern('자동').test('자동')).toBe(true);
        expect(grokModelLabelPattern('Expert').test('Expert Thinks hard')).toBe(true);
        expect(grokModelLabelPattern('Fast').test('Faster responses')).toBe(false);
        expect(grokModelLabelPattern('Grok 4.3').test('Grok 4.3 beta')).toBe(true);
        expect(grokModelLabelPattern('Grok 4.3').test('Grok 4.31')).toBe(false);
        expect(normalizeGrokModelChoice('헤비')).toBe('heavy');
        expect(normalizeGrokModelChoice('빠른')).toBe('fast');
    });

    it('uses observed Grok DOM selectors', () => {
        expect(grokLiveSrc).toMatch(/\.ProseMirror\[contenteditable="true"\]/);
        expect(grokLiveSrc).toMatch(/\[data-testid="new-chat"\]/);
        expect(grokLiveSrc).toMatch(/\[data-testid="assistant-message"\]/);
        expect(grokLiveSrc).toMatch(/response-content-markdown/);
    });

    it('verifies Grok uploads with visible and sent-turn evidence', () => {
        expect(grokLiveSrc).toMatch(/attachLocalFileLive/);
        expect(grokLiveSrc).toMatch(/verifyGrokSentTurnAttachment/);
        expect(grokLiveSrc).toMatch(/closest\('\[id\^="response-"\]'\)/);
        expect(grokLiveSrc).toMatch(/waitForTimeout\(250\)/);
        expect(grokLiveSrc).toMatch(/Grok sent turn has no attachment evidence/);
        expect(grokLiveSrc).toMatch(/data-testid\*="file"/);
    });

    it('supports opt-in copy markdown fallback', () => {
        expect(copyMarkdownSrc).toMatch(/GROK_COPY_SELECTORS/);
        expect(copyMarkdownSrc).toMatch(/\[data-testid="assistant-message"\]/);
        expect(copyMarkdownSrc).toMatch(/button\[aria-label="Copy"\]/);
        expect(grokLiveSrc).toMatch(/captureCopiedResponseText\(page, GROK_COPY_SELECTORS\)/);
        expect(grokLiveSrc).toMatch(/copy-markdown/);
    });

    it('supports observed model picker choices', () => {
        expect(grokModelSrc).toMatch(/button\[aria-label="Model select"\]/);
        for (const label of ['auto', 'fast', 'expert', 'grok-4.3', 'heavy']) {
            expect(grokModelSrc).toMatch(new RegExp(label.replace('.', '\\.')));
        }
        expect(grokLiveSrc).toMatch(/selectGrokModel/);
        expect(grokLiveSrc).toMatch(/model selected:/);
    });

    it('hard-gates Grok context packaging unless --allow-grok-context-pack is passed', () => {
        expect(grokLiveSrc).toMatch(/hasContextPackaging\(input\) && input\.allowGrokContextPack !== true/);
        expect(grokLiveSrc).toMatch(/grok context-pack disabled by default/);
        expect(grokLiveSrc).toMatch(/'grok-context-pack-not-allowed'/);
        expect(grokLiveSrc).toMatch(/errorCode: 'grok\.context-pack-not-allowed'/);
        expect(grokLiveSrc).toMatch(/retryHint: 'inline-only-or-allow-flag'/);
    });

    it('uses WebAiError for every Node-side public throw site', () => {
        expect(grokLiveSrc).toMatch(/import \{ WebAiError \}/);
        // The only remaining `throw new Error(` is inside a page.evaluate browser-side callback,
        // where WebAiError cannot be serialized across the CDP boundary.
        const browserSideEvaluate = /page\.evaluate\([^]*?if \(!el\) throw new Error/;
        expect(grokLiveSrc).toMatch(browserSideEvaluate);
        // Provider preflight, baseline, composer, attachment, and submit throws all use WebAiError.
        expect(grokLiveSrc.match(/errorCode:/g)?.length || 0).toBeGreaterThanOrEqual(8);
    });

    it('only pushes the soft warning when the override flag is set', () => {
        expect(grokLiveSrc).toMatch(/grok-context-pack-not-recommended/);
        expect(grokLiveSrc).toMatch(/hasContextPackaging\(input\) && input\.allowGrokContextPack === true/);
        expect(grokLiveSrc).toMatch(/warnings\.push\(GROK_CONTEXT_PACK_WARNING\)/);
    });
});
