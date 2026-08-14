// @ts-check
import { describe, it, expect } from 'vitest';
import { enforceNavigationPolicy, enforceFormActionPolicy } from '../../web-ai/policy/enforce.mjs';

describe('enforceNavigationPolicy (H-008)', () => {
    it('allows navigation to unlisted origin when no policy is set', () => {
        const result = enforceNavigationPolicy({}, { url: 'https://example.com/page' });
        expect(result.ok).toBe(true);
    });

    it('denies navigation to origin in deniedOrigins', () => {
        const policy = { deniedOrigins: ['https://evil.com'] };
        expect(() => enforceNavigationPolicy(policy, { url: 'https://evil.com/phish' }))
            .toThrow(/denied/);
    });

    it('denies navigation to origin not in allowedOrigins', () => {
        const policy = { allowedOrigins: ['https://trusted.com'] };
        expect(() => enforceNavigationPolicy(policy, { url: 'https://other.com' }))
            .toThrow(/not in allowlist/);
    });

    it('allows navigation to origin in allowedOrigins', () => {
        const policy = { allowedOrigins: ['https://trusted.com'] };
        const result = enforceNavigationPolicy(policy, { url: 'https://trusted.com/page' });
        expect(result.ok).toBe(true);
    });

    it('denies cross-origin navigation when policy is false', () => {
        const policy = { allowCrossOriginNavigation: false };
        expect(() => enforceNavigationPolicy(policy, {
            url: 'https://other.com',
            currentOrigin: 'https://current.com',
        })).toThrow(/cross-origin/);
    });

    it('allows same-origin navigation even when cross-origin is denied', () => {
        const policy = { allowCrossOriginNavigation: false };
        const result = enforceNavigationPolicy(policy, {
            url: 'https://current.com/other-page',
            currentOrigin: 'https://current.com',
        });
        expect(result.ok).toBe(true);
    });
});

describe('enforceFormActionPolicy (H-008)', () => {
    it('denies destructive form actions when policy is deny', () => {
        const policy = { destructiveFormPolicy: 'deny' };
        expect(() => enforceFormActionPolicy(policy, { actionType: 'submit-payment' }))
            .toThrow(/destructive/);
    });

    it('allows non-destructive actions even when policy is deny', () => {
        const policy = { destructiveFormPolicy: 'deny' };
        const result = enforceFormActionPolicy(policy, { actionType: 'search' });
        expect(result.ok).toBe(true);
    });

    it('detects destructive patterns in action types', () => {
        const policy = { destructiveFormPolicy: 'deny' };
        for (const action of ['delete-account', 'submit-form', 'purchase-item', 'cancel-subscription']) {
            expect(() => enforceFormActionPolicy(policy, { actionType: action }))
                .toThrow(/destructive/);
        }
    });
});
