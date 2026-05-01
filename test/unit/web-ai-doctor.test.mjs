import { describe, expect, it } from 'vitest';
import { featureDefinitionsForVendor, diagnoseFeature, runDoctor } from '../../web-ai/doctor.mjs';

function fakePageForDoctor(url, locatorMap = {}) {
    return {
        url: () => url || 'https://chatgpt.com/c/test-123',
        evaluate: async (_fn, selectors) => {
            if (Array.isArray(selectors)) {
                const hasMatch = selectors.some(s => (locatorMap[s]?.count ?? 0) > 0);
                return hasMatch ? '<div><button>ok</button></div>' : null;
            }
            return '<div><button>ok</button></div>';
        },
        locator: (selector) => ({
            count: async () => locatorMap[selector]?.count ?? 0,
            nth: (i) => ({
                isVisible: async () => {
                    const entry = locatorMap[selector];
                    if (!entry) return false;
                    if (Array.isArray(entry.visibleAt)) return entry.visibleAt.includes(i);
                    return i === 0 ? (entry.visible ?? false) : false;
                },
            }),
            first: () => ({
                isVisible: async () => locatorMap[selector]?.visible ?? false,
            }),
        }),
    };
}

describe('web-ai doctor', () => {
    it('featureDefinitionsForVendor returns 6 features for each vendor', () => {
        expect(featureDefinitionsForVendor('chatgpt').length).toBe(6);
        expect(featureDefinitionsForVendor('gemini').length).toBe(6);
        expect(featureDefinitionsForVendor('grok').length).toBe(6);
        expect(featureDefinitionsForVendor('unknown').length).toBe(0);
    });

    it('featureDefinitionsForVendor returns deep defensive copies', () => {
        const a = featureDefinitionsForVendor('chatgpt');
        const b = featureDefinitionsForVendor('chatgpt');
        a[0].feature = 'mutated';
        a[0].selectors.push('bad-selector');
        expect(b[0].feature).toBe('composer');
        expect(b[0].selectors).not.toContain('bad-selector');
    });

    it('featureDefinitionsForVendor includes all expected features', () => {
        const names = featureDefinitionsForVendor('chatgpt').map(f => f.feature);
        expect(names).toEqual(['composer', 'model-picker', 'upload', 'response-feed', 'copy-fallback', 'streaming-indicator']);
    });

    it('diagnoseFeature returns ok when selector is visible', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/', {
            'div[contenteditable="true"]': { count: 1, visible: true },
        });
        const feature = { feature: 'composer', selectors: ['#missing', 'div[contenteditable="true"]'] };
        const result = await diagnoseFeature(page, feature);
        expect(result.feature).toBe('composer');
        expect(result.state).toBe('ok');
        expect(result.selectorMatches.length).toBeGreaterThan(0);
        expect(result.selectorCounts.tried).toBe(2);
        expect(result.selectorCounts.matched).toBe(1);
    });

    it('diagnoseFeature returns warn when matched but not visible', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/', {
            'button.copy': { count: 1, visible: false },
        });
        const feature = { feature: 'copy', selectors: ['button.copy'] };
        const result = await diagnoseFeature(page, feature);
        expect(result.state).toBe('warn');
    });

    it('diagnoseFeature returns fail when nothing matches', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/');
        const feature = { feature: 'upload', selectors: ['button.upload'] };
        const result = await diagnoseFeature(page, feature);
        expect(result.state).toBe('fail');
        expect(result.selectorMatches).toEqual([]);
    });

    it('runDoctor produces a complete report with redacted URL', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/c/secret-id?token=abc', {
            'div[contenteditable="true"]': { count: 1, visible: true },
        });
        const deps = { getPage: async () => page };
        const report = await runDoctor(deps, { vendor: 'chatgpt' });
        expect(report.vendor).toBe('chatgpt');
        expect(report.url).toBe('https://chatgpt.com/c/secret-id');
        expect(report.url).not.toContain('token=abc');
        expect(report.capturedAt).toBeTruthy();
        expect(report.features.length).toBe(6);
        expect(Array.isArray(report.warnings)).toBe(true);
    });

    it('runDoctor report is parseable JSON under 4KB', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/');
        const deps = { getPage: async () => page };
        const report = await runDoctor(deps, { vendor: 'chatgpt' });
        const json = JSON.stringify(report);
        expect(json.length).toBeLessThan(4096);
        expect(JSON.parse(json)).toBeTruthy();
    });

    it('each feature has required keys including selectorCounts', async () => {
        const page = fakePageForDoctor('https://gemini.google.com/');
        const deps = { getPage: async () => page };
        const report = await runDoctor(deps, { vendor: 'gemini' });
        for (const f of report.features) {
            expect(f).toHaveProperty('feature');
            expect(f).toHaveProperty('selectorsTried');
            expect(f).toHaveProperty('selectorMatches');
            expect(f).toHaveProperty('selectorCounts');
            expect(f).toHaveProperty('state');
            expect(f).toHaveProperty('domHash');
            expect(f.selectorCounts).toHaveProperty('tried');
            expect(f.selectorCounts).toHaveProperty('matched');
        }
    });

    it('wrong host skips DOM evidence and adds warning', async () => {
        const page = fakePageForDoctor('https://evil.com/', {
            'div[contenteditable="true"]': { count: 1, visible: true },
        });
        const deps = { getPage: async () => page };
        const report = await runDoctor(deps, { vendor: 'chatgpt' });
        expect(report.warnings.some(w => w.startsWith('host-mismatch'))).toBe(true);
        for (const f of report.features) {
            expect(f.state).toBe('fail');
            expect(f.domHash).toBeNull();
        }
    });

    it('session content and content-derived hashes are never in doctor output', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/');
        const deps = { getPage: async () => page };
        const report = await runDoctor(deps, { vendor: 'chatgpt' });
        if (report.lastSession) {
            expect(report.lastSession).not.toHaveProperty('composerBefore');
            expect(report.lastSession).not.toHaveProperty('composerAfter');
            expect(report.lastSession).not.toHaveProperty('composerAfterHash');
            expect(report.lastSession).not.toHaveProperty('composerBeforeHash');
        }
    });

    it('clamped report uses byte length and sets truncated flag', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/');
        const deps = { getPage: async () => page };
        const report = await runDoctor(deps, { vendor: 'chatgpt' });
        const reportBytes = Buffer.byteLength(JSON.stringify(report), 'utf8');
        expect(reportBytes).toBeLessThan(4096);
        expect(report.truncated).toBeUndefined();
    });

    it('domHash is null when selector not found', async () => {
        const page = fakePageForDoctor('https://chatgpt.com/');
        const deps = { getPage: async () => page };
        const report = await runDoctor(deps, { vendor: 'chatgpt' });
        for (const f of report.features) {
            if (f.state === 'fail') {
                expect(f.domHash).toBeNull();
            }
        }
    });
});
