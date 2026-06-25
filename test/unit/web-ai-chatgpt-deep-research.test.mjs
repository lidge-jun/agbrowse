import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { autoConfirmPlan, extractResearchReport } from '../../web-ai/chatgpt-deep-research.mjs';

const chatgptDeepResearchSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-deep-research.mjs'), 'utf8');

describe('web-ai ChatGPT Deep Research flow', () => {
    it('auto-confirms the post-submit Deep Research Start plan card on the page', async () => {
        const clicked = [];
        const page = {
            locator(selector) {
                return {
                    first() {
                        return this;
                    },
                    async isVisible() {
                        return selector === 'button:has-text("Start")';
                    },
                    async click() {
                        clicked.push(selector);
                    },
                };
            },
            frames() {
                return [];
            },
            async waitForTimeout() {
                throw new Error('should not wait once Start is visible');
            },
        };

        await expect(autoConfirmPlan(page, 70_000)).resolves.toBe(true);
        expect(clicked).toEqual(['button:has-text("Start")']);
    });

    it('auto-confirms the Deep Research Start card inside the app iframe', async () => {
        const clicked = [];
        const invisibleContext = {
            locator() {
                return {
                    first() {
                        return this;
                    },
                    async isVisible() {
                        return false;
                    },
                    async click() {
                        throw new Error('should not click the page context');
                    },
                };
            },
        };
        const frameContext = {
            locator(selector) {
                return {
                    first() {
                        return this;
                    },
                    async isVisible() {
                        return selector === 'button:has-text("Start")';
                    },
                    async click() {
                        clicked.push(selector);
                    },
                };
            },
        };
        const page = {
            ...invisibleContext,
            frames() {
                return [frameContext];
            },
            async waitForTimeout() {
                throw new Error('should not wait once iframe Start is visible');
            },
        };

        await expect(autoConfirmPlan(page, 70_000)).resolves.toBe(true);
        expect(clicked).toEqual(['button:has-text("Start")']);
    });

    it('uses the live-observed post-submit confirmation window and labels', () => {
        expect(chatgptDeepResearchSrc).toContain('button:has-text("Start research")');
        expect(chatgptDeepResearchSrc).toContain('button:has-text("Start")');
        expect(chatgptDeepResearchSrc).toContain('button:has-text("시작")');
        expect(chatgptDeepResearchSrc).toContain('timeoutMs = 70_000');
        expect(chatgptDeepResearchSrc).toContain('page.frames()');
        expect(chatgptDeepResearchSrc).toContain('await page.waitForTimeout(250)');
    });
});

describe('extractResearchReport — target-scoped selection', () => {
    const REAL_REPORT = [
        '# Findings: Renewable Energy 2026',
        '',
        'Solar capacity additions outpaced every prior year, with utility-scale',
        'deployments concentrated in three regions. The detailed breakdown below',
        'cites primary grid-operator filings and manufacturer disclosures.',
    ].join('\n');

    const fakeFrame = (url, text) => ({ url: () => url, evaluate: async () => text });
    const fakePage = ({ assistant = '', sources = [], frames = [] }) => ({
        locator: () => ({
            all: async () => (assistant ? [{ innerText: async () => assistant }] : []),
        }),
        evaluate: async () => sources,
        frames: () => frames,
        url: () => 'https://chatgpt.com/c/abc',
    });

    it('returns the completed assistant target report', async () => {
        const r = await extractResearchReport(fakePage({ assistant: REAL_REPORT, sources: ['https://x'] }), {});
        expect(r).not.toBeNull();
        expect(r.from).toBe('assistant');
        expect(r.completed).toBe(true);
        expect(r.sources).toEqual(['https://x']);
    });

    it('falls back to a completed deep-research frame when the assistant text is incomplete', async () => {
        const page = fakePage({
            assistant: 'Researching...',
            frames: [fakeFrame('https://chatgpt.com/deep-research/app', REAL_REPORT)],
        });
        const r = await extractResearchReport(page, {});
        expect(r.from).toBe('frame');
        expect(r.completed).toBe(true);
    });

    it('marks completed:false when only incomplete text is available', async () => {
        const r = await extractResearchReport(fakePage({ assistant: 'Reading sources' }), {});
        expect(r).not.toBeNull();
        expect(r.completed).toBe(false);
    });

    it('returns null when nothing is readable', async () => {
        const r = await extractResearchReport(fakePage({ assistant: '', frames: [] }), {});
        expect(r).toBeNull();
    });

    it('ignores non deep-research frames', async () => {
        const page = fakePage({
            assistant: '',
            frames: [fakeFrame('https://chatgpt.com/some-other-app', REAL_REPORT)],
        });
        const r = await extractResearchReport(page, {});
        expect(r).toBeNull();
    });
});
