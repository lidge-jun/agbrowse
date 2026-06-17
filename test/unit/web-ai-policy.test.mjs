import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { enforcePolicy } from '../../web-ai/policy/enforce.mjs';
import { loadPolicy, normalizePolicy } from '../../web-ai/policy/schema.mjs';

describe('web-ai policy', () => {
    it('rejects unknown policy keys and unsupported versions', () => {
        expect(() => normalizePolicy({ surprise: true })).toThrow(/unknown policy keys/);
        expect(() => normalizePolicy({ version: 2 })).toThrow(/version must be 1/);
    });

    it('rejects non-object policies with ruleId', () => {
        for (const value of [null, [], 1, 'policy']) {
            try {
                normalizePolicy(value);
                throw new Error('expected policy shape failure');
            } catch (error) {
                expect(error.toJSON()).toMatchObject({
                    errorCode: 'policy.invalid-shape',
                    ruleId: 'policySchema',
                });
            }
        }
    });

    it('denies risky actions before mutation', () => {
        expect(() => enforcePolicy({}, { clipboardWriteIntercept: true })).toThrow(/provider copy capture denied/);
        expect(enforcePolicy({}, { evaluate: true }).ok).toBe(true);
        expect(() => enforcePolicy({ allowEvaluate: false }, { evaluate: true })).toThrow(/evaluate denied/);
    });

    it('exposes ruleId in policy errors', () => {
        try {
            enforcePolicy({}, { clipboardWriteIntercept: true });
            throw new Error('expected policy failure');
        } catch (error) {
            expect(error.toJSON()).toMatchObject({
                mutationAllowed: false,
                ruleId: 'allowClipboardWrite',
                evidence: { ruleId: 'allowClipboardWrite' },
            });
        }
    });

    it('allows explicitly requested provider copy capture under default explicit-only clipboard write policy', () => {
        expect(
            enforcePolicy({}, { clipboardWriteIntercept: true, explicitClipboardWriteIntercept: true }).ok,
        ).toBe(true);
    });

    it('rejects explicitly requested provider copy capture when clipboard write is disabled by policy', () => {
        expect(() => enforcePolicy(
            { allowClipboardWrite: false },
            { clipboardWriteIntercept: true, explicitClipboardWriteIntercept: true },
        )).toThrow(/provider copy capture denied/);
    });

    it('accepts the legacy --unsafe-allow clipboard-read alias for one minor version', () => {
        expect(
            enforcePolicy({}, { clipboardWriteIntercept: true, unsafeAllow: ['clipboard-read'] }).ok,
        ).toBe(true);
    });

    it('accepts the new clipboard-write-intercept unsafe allowance', () => {
        expect(
            enforcePolicy({}, { clipboardWriteIntercept: true, unsafeAllow: ['clipboard-write-intercept'] }).ok,
        ).toBe(true);
    });

    it('copy fallback denial message no longer claims OS clipboard read', () => {
        try {
            enforcePolicy({}, { clipboardWriteIntercept: true });
            throw new Error('expected denial');
        } catch (error) {
            expect(error.message).not.toMatch(/OS clipboard|clipboard read/i);
            expect(error.message).toMatch(/provider copy capture/);
        }
    });

    it('exposes ruleId for schema and origin policy errors', async () => {
        try {
            normalizePolicy({ surprise: true });
            throw new Error('expected policy schema failure');
        } catch (error) {
            expect(error.toJSON()).toMatchObject({ ruleId: 'policySchema' });
        }
        try {
            enforcePolicy({ deniedOrigins: ['https://evil.test'] }, { url: 'https://evil.test/' });
            throw new Error('expected origin failure');
        } catch (error) {
            expect(error.toJSON()).toMatchObject({ ruleId: 'deniedOrigins' });
        }
        await expect(loadPolicy('../policy.json')).rejects.toMatchObject({ ruleId: 'policyPath' });
    });

    it('allows explicit safe origin and blocks denied origin', () => {
        expect(enforcePolicy({ allowedOrigins: ['https://chatgpt.com'] }, { url: 'https://chatgpt.com/' }).ok).toBe(true);
        expect(() => enforcePolicy({ deniedOrigins: ['https://evil.test'] }, { url: 'https://evil.test/' })).toThrow(/origin denied/);
    });

    it('fails closed when origin policy is configured without an action URL', () => {
        expect(() => enforcePolicy({ deniedOrigins: ['https://evil.test'] }, {})).toThrow(/origin is required/);
    });

    it('rejects policy path traversal', async () => {
        await expect(loadPolicy('../policy.json')).rejects.toThrow(/escapes current working directory/);
    });

    it('loads a local policy file', async () => {
        await fs.writeFile('tmp-policy.json', JSON.stringify({ version: 1, allowClipboardRead: true }));
        try {
            const { policy } = await loadPolicy('tmp-policy.json');
            expect(policy.allowClipboardRead).toBe(true);
        } finally {
            await fs.rm('tmp-policy.json', { force: true });
        }
    });
});
