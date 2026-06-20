import { describe, expect, it } from 'vitest';
import {
    TIER_DEFAULT_TIMEOUT_SEC,
    PRO_TIMEOUT_SEC,
    tierDefaultTimeoutSec,
    deriveTimeoutTier,
    resolveTimeoutDefaultSec,
} from '../../web-ai/session.mjs';

describe('web-ai tier-aware default poll timeout', () => {
    it('exposes the locked tier table (pro = 3600)', () => {
        expect({ ...TIER_DEFAULT_TIMEOUT_SEC }).toEqual({
            instant: 120,
            thinking: 600,
            pro: 3600,
            'deep-research': 3600,
        });
        expect(PRO_TIMEOUT_SEC).toBe(3600);
    });

    it('derives the ChatGPT tier from model + research', () => {
        expect(deriveTimeoutTier('chatgpt', 'instant')).toBe('instant');
        expect(deriveTimeoutTier('chatgpt', 'thinking')).toBe('thinking');
        expect(deriveTimeoutTier('chatgpt', 'pro')).toBe('pro');
        expect(deriveTimeoutTier('chatgpt', 'pro', 'deep')).toBe('deep-research');
        expect(deriveTimeoutTier('chatgpt', 'thinking', 'deep')).toBe('deep-research');
        expect(deriveTimeoutTier('chatgpt', undefined)).toBe(null);
    });

    it('derives the Grok tier so heavy != expert', () => {
        expect(deriveTimeoutTier('grok', 'heavy')).toBe('pro');
        expect(deriveTimeoutTier('grok', 'expert')).toBe('thinking');
        expect(deriveTimeoutTier('grok', 'thinking')).toBe('thinking'); // alias -> expert
        expect(deriveTimeoutTier('grok', 'fast')).toBe('instant');
        expect(deriveTimeoutTier('grok', 'auto')).toBe('thinking');
    });

    it('derives the Gemini tier including deep-think', () => {
        expect(deriveTimeoutTier('gemini', 'deepthink')).toBe('deep-research');
        expect(deriveTimeoutTier('gemini', 'flash-lite')).toBe('instant');
        expect(deriveTimeoutTier('gemini', 'flash')).toBe('thinking');
        expect(deriveTimeoutTier('gemini', 'pro')).toBe('thinking');
    });

    it('maps tiers to seconds with vendor fallback for unknown models', () => {
        expect(tierDefaultTimeoutSec('pro')).toBe(3600);
        expect(tierDefaultTimeoutSec('instant')).toBe(120);
        expect(tierDefaultTimeoutSec('thinking')).toBe(600);
        expect(tierDefaultTimeoutSec('deep-research')).toBe(3600);
        expect(tierDefaultTimeoutSec(null, 'chatgpt')).toBe(1200);
        expect(tierDefaultTimeoutSec(null, 'grok')).toBe(600);
        expect(tierDefaultTimeoutSec(null, 'gemini')).toBe(1200);
    });

    it('resolves end-to-end defaults: pro=3600, grok heavy(3600) != grok expert(600)', () => {
        expect(resolveTimeoutDefaultSec({ model: 'pro' }, 'chatgpt')).toBe(3600);
        expect(resolveTimeoutDefaultSec({ model: 'instant' }, 'chatgpt')).toBe(120);
        expect(resolveTimeoutDefaultSec({ model: 'thinking' }, 'chatgpt')).toBe(600);
        expect(resolveTimeoutDefaultSec({ model: 'pro', research: 'deep' }, 'chatgpt')).toBe(3600);
        expect(resolveTimeoutDefaultSec({ model: 'heavy' }, 'grok')).toBe(3600);
        expect(resolveTimeoutDefaultSec({ model: 'expert' }, 'grok')).toBe(600);
        expect(resolveTimeoutDefaultSec({ model: 'deepthink' }, 'gemini')).toBe(3600);
        // unknown / resume without model -> vendor default (no regression below today's value)
        expect(resolveTimeoutDefaultSec({}, 'chatgpt')).toBe(1200);
        expect(resolveTimeoutDefaultSec({}, 'grok')).toBe(600);
    });
});
