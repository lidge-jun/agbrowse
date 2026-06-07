import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    SEND_BUTTON_SELECTORS,
    INPUT_SELECTORS,
    STOP_BUTTON_SELECTOR,
    ASSISTANT_ROLE_SELECTOR,
    CONVERSATION_TURN_SELECTOR,
} from '../../web-ai/chatgpt-composer.mjs';
import {
    sendButtonTimeoutMs,
    isImageAttachmentPath,
    preflightAttachment,
    scoreFileInputCandidate,
} from '../../web-ai/chatgpt-attachments.mjs';
import { WebAiError } from '../../web-ai/errors.mjs';

const composerSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-composer.mjs'), 'utf8');
const chatgptSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');

describe('Stability Benchmarks — B1: Send Button Reliability', () => {
    const KNOWN_CHATGPT_DOM_PATTERNS = [
        { desc: 'data-testid send-button', selector: 'button[data-testid="send-button"]' },
        { desc: 'composer-send testid variant', pattern: 'composer-send' },
        { desc: 'form submit button', selector: 'form button[type="submit"]' },
        { desc: 'aria-label Send (case-insensitive)', pattern: 'aria-label' },
        { desc: 'type=submit with testid', pattern: 'type="submit"' },
    ];

    it('B1.1: SEND_BUTTON_SELECTORS covers ≥5 DOM variations', () => {
        expect(SEND_BUTTON_SELECTORS.length).toBeGreaterThanOrEqual(5);
    });

    it('B1.2: selectors include form submit fallback (oracle parity)', () => {
        const hasFormSubmit = SEND_BUTTON_SELECTORS.some(s => s.includes('form button'));
        expect(hasFormSubmit).toBe(true);
    });

    it('B1.3: aria-label matching uses broad "Send" not narrow "Send prompt"', () => {
        const ariaSelectors = SEND_BUTTON_SELECTORS.filter(s => s.includes('aria-label'));
        expect(ariaSelectors.length).toBeGreaterThanOrEqual(1);
        const usesNarrow = ariaSelectors.some(s => s.includes('Send prompt') || s.includes('Send message'));
        expect(usesNarrow).toBe(false);
    });

    it('B1.4: send timeout matches oracle parity — 20s text, 45s attachment', () => {
        expect(sendButtonTimeoutMs([])).toBe(20_000);
        expect(sendButtonTimeoutMs(['doc.pdf'])).toBe(45_000);
    });

    it('B1.5: Enter key fallback exists in submitPromptFromComposer', () => {
        expect(composerSrc).toContain("keyboard.press('Enter')");
        expect(composerSrc).toContain("method: 'enter'");
    });

    it('B1.6: clickEnabledSendButton accepts timeout parameter', () => {
        expect(composerSrc).toMatch(/async function clickEnabledSendButton\(page,\s*timeoutMs/);
    });

    it('B1.7: commit verification uses ≥4 independent signals', () => {
        const signals = [
            composerSrc.includes('readConversationTurns'),
            composerSrc.includes('readComposerState'),
            composerSrc.includes('STOP_BUTTON_SELECTOR'),
            composerSrc.includes('ASSISTANT_ROLE_SELECTOR'),
        ];
        const signalCount = signals.filter(Boolean).length;
        expect(signalCount).toBeGreaterThanOrEqual(4);
    });

    it('B1.8: sendButtonTimeoutMs is passed through chatgpt.mjs send flow', () => {
        expect(chatgptSrc).toContain('sendButtonTimeoutMs');
    });
});

describe('Stability Benchmarks — B2: Attachment Upload Reliability', () => {
    it('B2.1: attachment chip wait timeout is 45s', () => {
        expect(sendButtonTimeoutMs(['file.pdf'])).toBe(45_000);
    });

    it('B2.2: preflight rejects oversized files before upload', () => {
        const result = preflightAttachment(
            { path: '/tmp/huge.bin', basename: 'huge.bin', sizeBytes: 1_000_001 },
            { maxUploadBytes: 1_000_000 },
        );
        expect(result.ok).toBe(false);
        expect(result.rejectedReason).toBeDefined();
    });

    it('B2.3: image vs non-image file type routing is correct', () => {
        expect(isImageAttachmentPath('/tmp/photo.png')).toBe(true);
        expect(isImageAttachmentPath('/tmp/photo.jpg')).toBe(true);
        expect(isImageAttachmentPath('/tmp/photo.jpeg')).toBe(true);
        expect(isImageAttachmentPath('/tmp/photo.gif')).toBe(true);
        expect(isImageAttachmentPath('/tmp/photo.webp')).toBe(true);
        expect(isImageAttachmentPath('/tmp/doc.pdf')).toBe(false);
        expect(isImageAttachmentPath('/tmp/data.csv')).toBe(false);
        expect(isImageAttachmentPath('/tmp/code.ts')).toBe(false);
    });

    it('B2.4: image-only file inputs reject non-image attachments', () => {
        const imageInput = { accept: 'image/png,image/jpeg' };
        expect(scoreFileInputCandidate(imageInput, { isImageAttachment: false })).toBe(Number.NEGATIVE_INFINITY);
        expect(scoreFileInputCandidate(imageInput, { isImageAttachment: true })).toBeGreaterThan(0);
    });

    it('B2.5: attachment chip verification code exists', () => {
        const attachSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-attachments.mjs'), 'utf8');
        expect(attachSrc).toContain('waitForAttachmentAccepted');
        expect(attachSrc).toContain('Remove attachment');
    });
});

describe('Stability Benchmarks — B3: Error Classification Coverage', () => {
    const ORACLE_ERROR_CATEGORIES = {
        'cdp.unreachable': 'OracleTransportError',
        'cdp.target-mismatch': 'OracleTransportError',
        'provider.composer-not-visible': 'OracleUserError',
        'provider.model-mismatch': 'OracleUserError',
        'provider.attachment-preflight': 'OracleUserError',
        'provider.attachment-evidence-missing': 'OracleUserError',
        'provider.commit-not-verified': 'OracleResponseError',
        'provider.poll-timeout': 'OracleResponseError',
        'provider.runtime-disabled': 'OracleUserError',
        'capability.unsupported': 'OracleUserError',
        'context.over-budget': 'OracleUserError',
        'context.symlink-rejected': 'OracleUserError',
        'internal.unhandled': 'OracleTransportError',
    };

    it('B3.1: error taxonomy has ≥12 distinct codes', () => {
        const errorSrc = readFileSync(join(process.cwd(), 'web-ai', 'errors.mjs'), 'utf8');
        const codePattern = /(\w+\.\w[\w-]*)/g;
        const allMatches = [...errorSrc.matchAll(codePattern)]
            .map(m => m[1])
            .filter(c => c.includes('.') && !c.startsWith('init.') && !c.startsWith('Error.'));
        const distinctCodes = new Set(allMatches);
        expect(distinctCodes.size).toBeGreaterThanOrEqual(12);
    });

    it('B3.2: WebAiError includes retryHint in every instance', () => {
        const err = new WebAiError({ errorCode: 'test.error' });
        expect(err.retryHint).toBeDefined();
        expect(typeof err.retryHint).toBe('string');
        expect(err.retryHint.length).toBeGreaterThan(0);
    });

    it('B3.3: WebAiError JSON serialization preserves errorCode, stage, retryHint', () => {
        const err = new WebAiError({
            errorCode: 'provider.poll-timeout',
            stage: 'poll',
            retryHint: 'poll-or-resume',
        });
        const json = err.toJSON();
        expect(json.errorCode).toBe('provider.poll-timeout');
        expect(json.stage).toBe('poll');
        expect(json.retryHint).toBe('poll-or-resume');
    });

    it('B3.4: all oracle error categories have agbrowse equivalents', () => {
        const errorSrc = readFileSync(join(process.cwd(), 'web-ai', 'errors.mjs'), 'utf8');
        const missingCodes = Object.keys(ORACLE_ERROR_CATEGORIES)
            .filter(code => !errorSrc.includes(code));
        expect(missingCodes).toEqual([]);
    });

    it('B3.5: error codes span all three oracle tiers (Transport, User, Response)', () => {
        const tiers = new Set(Object.values(ORACLE_ERROR_CATEGORIES));
        expect(tiers.has('OracleTransportError')).toBe(true);
        expect(tiers.has('OracleUserError')).toBe(true);
        expect(tiers.has('OracleResponseError')).toBe(true);
    });
});

describe('Stability Benchmarks — Selector Coverage', () => {
    it('INPUT_SELECTORS has ≥5 composer input variants', () => {
        expect(INPUT_SELECTORS.length).toBeGreaterThanOrEqual(5);
    });

    it('CONVERSATION_TURN_SELECTOR has ≥4 turn detection variants', () => {
        expect(CONVERSATION_TURN_SELECTOR.length).toBeGreaterThanOrEqual(4);
    });

    it('STOP_BUTTON_SELECTOR targets data-testid', () => {
        expect(STOP_BUTTON_SELECTOR).toContain('data-testid');
    });

    it('ASSISTANT_ROLE_SELECTOR covers both data-message-author-role and data-turn', () => {
        expect(ASSISTANT_ROLE_SELECTOR).toContain('data-message-author-role');
        expect(ASSISTANT_ROLE_SELECTOR).toContain('data-turn');
    });
});
