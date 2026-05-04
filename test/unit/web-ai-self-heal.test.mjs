import { describe, expect, it, vi } from 'vitest';
import {
    ResolutionSource,
    resolveIntentFeature,
    resolveActionTarget,
    validateResolvedTarget,
    locatorForResolvedTarget,
} from '../../web-ai/self-heal.mjs';

describe('web-ai self-heal', () => {
    describe('resolveIntentFeature', () => {
        it('maps known intents to feature keys', () => {
            expect(resolveIntentFeature('composer.fill')).toBe('composer');
            expect(resolveIntentFeature('send.click')).toBe('sendButton');
            expect(resolveIntentFeature('copy.lastResponse')).toBe('copyButton');
            expect(resolveIntentFeature('modelPicker.open')).toBe('modelPicker');
        });

        it('returns null for unknown intents', () => {
            expect(resolveIntentFeature('unknown.action')).toBeNull();
        });

        it('returns featureOverride when provided', () => {
            expect(resolveIntentFeature('anything', 'customFeature')).toBe('customFeature');
        });
    });

    describe('resolveActionTarget', () => {
        function mockPage(overrides = {}) {
            const locators = new Map();
            return {
                url: vi.fn(() => overrides.url || 'https://chatgpt.com/'),
                locator: vi.fn((sel) => {
                    if (!locators.has(sel)) {
                        locators.set(sel, {
                            count: vi.fn(() => Promise.resolve(overrides.count ?? 1)),
                            first: vi.fn(() => ({
                                isVisible: vi.fn(() => Promise.resolve(overrides.visible ?? true)),
                                isEnabled: vi.fn(() => Promise.resolve(overrides.enabled ?? true)),
                                isEditable: vi.fn(() => Promise.resolve(overrides.editable ?? true)),
                                evaluate: vi.fn(() => Promise.resolve({ role: 'button', label: 'Send' })),
                            })),
                        });
                    }
                    return locators.get(sel);
                }),
                getByRole: vi.fn((role, { name }) => ({
                    count: vi.fn(() => Promise.resolve(overrides.roleCount ?? 1)),
                    first: vi.fn(() => ({
                        isVisible: vi.fn(() => Promise.resolve(overrides.visible ?? true)),
                        isEnabled: vi.fn(() => Promise.resolve(overrides.enabled ?? true)),
                        isEditable: vi.fn(() => Promise.resolve(overrides.editable ?? true)),
                    })),
                })),
            };
        }

        it('returns cache hit when cache provides valid entry and validation passes', async () => {
            const page = mockPage();
            const cache = {
                get: vi.fn(() => ({
                    target: { selector: '#cached', role: 'button', name: 'Send' },
                    key: 'k1',
                    entry: { stats: { hitCount: 1 } },
                })),
            };

            const result = await resolveActionTarget(page, {
                provider: 'chatgpt',
                intent: 'composer.fill',
                cache,
            });

            expect(result.ok).toBe(true);
            expect(result.target.resolution).toBe(ResolutionSource.CACHE);
            expect(cache.get).toHaveBeenCalled();
        });

        it('falls through cache when cache validation fails', async () => {
            const page = mockPage({ visible: false });
            const cache = {
                get: vi.fn(() => ({
                    target: { selector: '#cached', role: 'button', name: 'Send' },
                    key: 'k1',
                    entry: { stats: { hitCount: 1 } },
                })),
            };

            const result = await resolveActionTarget(page, {
                provider: 'chatgpt',
                intent: 'composer.fill',
                cache,
                selectors: ['#fallback'],
            });

            expect(result.ok).toBe(false);
            expect(result.errorCode).toBe('TARGET_UNRESOLVED');
            expect(result.attempts.length).toBeGreaterThanOrEqual(1);
            expect(result.attempts[0].source).toBe(ResolutionSource.CACHE);
        });

        it('returns TARGET_UNRESOLVED when all layers fail', async () => {
            const page = mockPage({ count: 0 });
            const result = await resolveActionTarget(page, {
                provider: 'chatgpt',
                intent: 'composer.fill',
                selectors: ['#missing'],
            });

            expect(result.ok).toBe(false);
            expect(result.errorCode).toBe('TARGET_UNRESOLVED');
            // When count is 0, no candidates are collected, so attempts may be empty
            expect(result.attempts.length).toBe(0);
        });

        it('populates attempts array with tried sources', async () => {
            const page = mockPage({ count: 1, visible: false });
            const result = await resolveActionTarget(page, {
                provider: 'chatgpt',
                intent: 'composer.fill',
                selectors: ['#missing1', '#missing2'],
            });

            expect(result.attempts.some(a => a.source === ResolutionSource.CSS_FALLBACK)).toBe(true);
        });
    });

    describe('validateResolvedTarget', () => {
        function mockPage(overrides = {}) {
            const locators = new Map();
            return {
                url: vi.fn(() => 'https://chatgpt.com/'),
                locator: vi.fn((sel) => {
                    if (!locators.has(sel)) {
                        locators.set(sel, {
                            count: vi.fn(() => Promise.resolve(overrides.count ?? 1)),
                            first: vi.fn(() => ({
                                isVisible: vi.fn(() => Promise.resolve(overrides.visible ?? true)),
                                isEnabled: vi.fn(() => Promise.resolve(overrides.enabled ?? true)),
                                isEditable: vi.fn(() => Promise.resolve(overrides.editable ?? true)),
                                evaluate: vi.fn(() => Promise.resolve(overrides.evalResult ?? { role: 'button', label: 'Send' })),
                            })),
                        });
                    }
                    return locators.get(sel);
                }),
                getByRole: vi.fn((role, { name }) => ({
                    count: vi.fn(() => Promise.resolve(overrides.roleCount ?? 1)),
                    first: vi.fn(() => ({
                        isVisible: vi.fn(() => Promise.resolve(overrides.visible ?? true)),
                        isEnabled: vi.fn(() => Promise.resolve(overrides.enabled ?? true)),
                        isEditable: vi.fn(() => Promise.resolve(overrides.editable ?? true)),
                    })),
                })),
            };
        }

        it('rejects invisible elements', async () => {
            const page = mockPage({ visible: false });
            const result = await validateResolvedTarget(page, { selector: '#btn' });
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('not-visible');
        });

        it('rejects disabled elements for fill action', async () => {
            const page = mockPage({ enabled: false, editable: false });
            const result = await validateResolvedTarget(page, { selector: '#input' }, { actionKind: 'fill' });
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('not-enabled');
        });

        it('rejects non-editable elements for fill action', async () => {
            const page = mockPage({ editable: false });
            const result = await validateResolvedTarget(page, { selector: '#input' }, { actionKind: 'fill' });
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('not-editable');
        });

        it('accepts visible elements for click action', async () => {
            const page = mockPage();
            const result = await validateResolvedTarget(page, { selector: '#btn' }, { actionKind: 'click' });
            expect(result.ok).toBe(true);
        });

        it('rejects elements not matching semantic target', async () => {
            const page = mockPage({
                evalResult: { role: 'link', label: 'Cancel' },
            });
            const result = await validateResolvedTarget(page, { selector: '#btn' }, {
                semanticTarget: { roles: ['button'], names: [/^send/i] },
            });
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('low-confidence');
        });

        it('accepts elements matching semantic target roles', async () => {
            const page = mockPage({
                evalResult: { role: 'button', label: 'Send Message' },
            });
            const result = await validateResolvedTarget(page, { selector: '#btn' }, {
                semanticTarget: { roles: ['button'], names: [/^send/i] },
            });
            expect(result.ok).toBe(true);
        });

        it('rejects elements matching excludeNames even if role matches', async () => {
            const page = mockPage({
                evalResult: { role: 'button', label: 'Cancel' },
            });
            const result = await validateResolvedTarget(page, { selector: '#btn' }, {
                semanticTarget: { roles: ['button'], excludeNames: [/cancel/i] },
            });
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('low-confidence');
        });

        it('returns ref-stale when registry is stale', async () => {
            const page = mockPage();
            const registry = { stale: true };
            const result = await validateResolvedTarget(page, { ref: '@e1' }, { registry });
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('ref-stale');
        });

        it('returns missing-selector when target has neither selector nor ref', async () => {
            const page = mockPage();
            const result = await validateResolvedTarget(page, {});
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('missing-selector');
        });
    });

    describe('locatorForResolvedTarget', () => {
        function mockPage() {
            const locatorMock = {
                first: vi.fn(() => 'locator-first'),
            };
            return {
                locator: vi.fn(() => locatorMock),
                getByRole: vi.fn(() => locatorMock),
            };
        }

        it('returns locator for selector-based target', async () => {
            const page = mockPage();
            const result = await locatorForResolvedTarget(page, { selector: '#btn' });
            expect(page.locator).toHaveBeenCalledWith('#btn');
            expect(result).toBe('locator-first');
        });

        it('throws when ref target lacks registry', async () => {
            const page = mockPage();
            await expect(
                locatorForResolvedTarget(page, { ref: '@e1' })
            ).rejects.toThrow(/requires a registry/);
        });

        it('throws when target has neither selector nor ref', async () => {
            const page = mockPage();
            await expect(
                locatorForResolvedTarget(page, {})
            ).rejects.toThrow(/neither selector nor ref/);
        });
    });
});
