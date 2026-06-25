import { describe, expect, it } from 'vitest';
import {
    listCapabilities,
    listCapabilitySchemas,
    listFrontendObservedCapabilities,
    lookupCapability,
    isCapabilityEnabled,
    requireCapabilityOrFailClosed,
} from '../../web-ai/capability-registry.mjs';
import { WebAiError } from '../../web-ai/errors.mjs';

// Parity catalog 201 #1/#1a/#2/#8 (P1): declarative capability registry cluster.
describe('web-ai capability registry', () => {
    it('lists the full registry including observed-tool backlog entries', () => {
        const all = listCapabilities();
        expect(all.length).toBeGreaterThanOrEqual(30);
        const ids = all.map((e) => e.id);
        expect(ids).toContain('chatgpt-model-selection');
        expect(ids).toContain('gemini-deep-think');
        // #8 observed-tool entries spread in
        expect(ids).toContain('gemini-canvas-tool');
        expect(ids).toContain('chatgpt-deep-research-tool');
    });

    it('lookupCapability returns a copy of a known entry, UNKNOWN for misses', () => {
        const entry = lookupCapability('chatgpt-model-selection');
        expect(entry.vendor).toBe('chatgpt');
        expect(entry.status).toBe('ported-cli-jaw');
        expect(entry.observation?.status).toBe('implemented');

        const unknown = lookupCapability('does-not-exist');
        expect(unknown.status).toBe('unknown');
        expect(unknown.id).toBe('does-not-exist');
        expect(unknown.browserMutationAllowed).toBe(false);
    });

    it('isCapabilityEnabled is true only for ported/implemented entries', () => {
        expect(isCapabilityEnabled('chatgpt-model-selection')).toBe(true); // ported-cli-jaw
        expect(isCapabilityEnabled('chatgpt-web-search-toggle')).toBe(false); // planned
        expect(isCapabilityEnabled('web-ai-model-selection')).toBe(false); // rejected-until-verified
        expect(isCapabilityEnabled('deep-research')).toBe(false); // deferred
        expect(isCapabilityEnabled('web-ai-captcha-bypass')).toBe(false); // out-of-scope
        expect(isCapabilityEnabled('nope')).toBe(false); // unknown
    });

    it('requireCapabilityOrFailClosed returns enabled entries and fail-closes the rest', () => {
        expect(requireCapabilityOrFailClosed('chatgpt-send-button').id).toBe('chatgpt-send-button');

        try {
            requireCapabilityOrFailClosed('chatgpt-web-search-toggle');
            expect.fail('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(WebAiError);
            expect(err.errorCode).toBe('capability.unsupported');
            expect(err.stage).toBe('capability-preflight');
            expect(err.retryHint).toBe('feature-fallback');
            expect(err.evidence.capabilityId).toBe('chatgpt-web-search-toggle');
            expect(err.evidence.ownerPrd).toBeTruthy();
        }
    });

    it('unknown capability fail-closes at the status stage', () => {
        try {
            requireCapabilityOrFailClosed('ghost');
            expect.fail('expected throw');
        } catch (err) {
            expect(err.errorCode).toBe('capability.unsupported');
            expect(err.stage).toBe('status');
            expect(err.message).toMatch(/unknown capability/);
        }
    });

    it('listCapabilitySchemas filters by vendor (incl. shared), family, frontendStatus', () => {
        const chatgpt = listCapabilitySchemas({ vendor: 'chatgpt' });
        expect(chatgpt.every((r) => r.providerId === 'chatgpt' || r.providerId === 'shared')).toBe(true);
        expect(chatgpt.find((r) => r.capabilityId === 'chatgpt-model-selection')?.family).toBe('modelSelection');

        const attachments = listCapabilitySchemas({ family: 'attachments' });
        expect(attachments.length).toBeGreaterThan(0);
        expect(attachments.every((r) => r.family === 'attachments')).toBe(true);

        const implemented = listCapabilitySchemas({ frontendStatus: 'implemented' });
        expect(implemented.every((r) => r.frontendStatus === 'implemented')).toBe(true);
    });

    it('listFrontendObservedCapabilities returns only entries with an observation (copied wrappers)', () => {
        const observed = listFrontendObservedCapabilities('gemini');
        expect(observed.length).toBeGreaterThan(0);
        expect(observed.every((e) => Boolean(e.observation))).toBe(true);
        // the entry + observation wrappers are fresh copies, so top-level field writes
        // do not leak back into the registry (faithful shallow-copy contract).
        observed[0].status = 'unknown';
        observed[0].observation.status = 'unstable';
        const fresh = listFrontendObservedCapabilities('gemini');
        expect(fresh[0].status).not.toBe('unknown');
        expect(fresh[0].observation.status).not.toBe('unstable');
    });
});
