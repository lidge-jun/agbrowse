import { describe, expect, it } from 'vitest';
import {
    artifactFromPollResult,
    createAnswerArtifact,
    summarizeAnswerArtifact,
    withAnswerArtifact,
} from '../../web-ai/answer-artifact.mjs';

describe('answer artifact', () => {
    it('normalizes copy-button captures with exactness score 1', () => {
        const artifact = createAnswerArtifact({
            provider: 'grok',
            sessionId: '01ABC',
            conversationUrl: 'https://grok.com/c/1',
            capturedBy: 'copy-button',
            markdown: 'Answer with [source](https://example.com).',
            responseStableMs: '1500',
        });

        expect(artifact).toMatchObject({
            provider: 'grok',
            sessionId: '01ABC',
            capturedBy: 'copy-button',
            text: 'Answer with [source](https://example.com).',
            exactnessScore: 1,
            responseStableMs: 1500,
        });
    });

    it('marks DOM fallbacks as lower exactness and preserves warnings', () => {
        const artifact = artifactFromPollResult({
            vendor: 'chatgpt',
            sessionId: '01DEF',
            answerText: 'DOM-only answer',
            warnings: ['copy button missing'],
        });

        expect(artifact.capturedBy).toBe('dom-fallback');
        expect(artifact.exactnessScore).toBe(0.75);
        expect(artifact.warnings).toEqual(['copy button missing']);
    });

    it('attaches artifacts to provider results without dropping legacy fields', () => {
        const result = withAnswerArtifact({
            ok: true,
            vendor: 'chatgpt',
            status: 'complete',
            url: 'https://chatgpt.com/c/fake',
            answerText: 'OK',
            usedFallbacks: [],
            warnings: [],
        });

        expect(result.answerText).toBe('OK');
        expect(result.answerArtifact).toMatchObject({
            provider: 'chatgpt',
            conversationUrl: 'https://chatgpt.com/c/fake',
            capturedBy: 'dom-fallback',
            markdown: 'OK',
            text: 'OK',
        });
    });

    it('summarizes artifacts without leaking answer text', () => {
        const summary = summarizeAnswerArtifact({
            provider: 'gemini',
            sessionId: '01XYZ',
            capturedBy: 'copy-button',
            markdown: 'secret answer',
            warnings: ['w1', 'w2'],
        });

        expect(summary).toEqual({
            provider: 'gemini',
            sessionId: '01XYZ',
            capturedBy: 'copy-button',
            markdownChars: 13,
            textChars: 13,
            exactnessScore: 1,
            warningCount: 2,
        });
    });
});
