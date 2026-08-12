import { describe, expect, it } from 'vitest';
import {
    normalizeDeepResearchReportText,
    isIncompleteDeepResearchText,
    chooseDeepResearchReportRead,
    looksLikeDeepResearchToolCallCapture,
} from '../../web-ai/chatgpt-deep-research-report.mjs';

const REAL_REPORT = [
    '# Market Analysis: Electric Vehicles 2026',
    '',
    'The global EV market grew 28% year-over-year, driven by falling battery',
    'costs and expanded charging infrastructure across North America and the EU.',
    'Key findings below summarize adoption, pricing, and policy trends with',
    'citations to primary sources and manufacturer disclosures.',
].join('\n');

describe('normalizeDeepResearchReportText', () => {
    it('normalizes CRLF, collapses blank lines, and trims', () => {
        expect(normalizeDeepResearchReportText('\r\n a \r\n\r\n\r\n b \r\n')).toBe('a \n\n b');
    });
    it('returns empty string for non-string input', () => {
        // @ts-expect-error intentional wrong type
        expect(normalizeDeepResearchReportText(null)).toBe('');
        // @ts-expect-error intentional wrong type
        expect(normalizeDeepResearchReportText(42)).toBe('');
    });
});

describe('isIncompleteDeepResearchText', () => {
    it('treats short text as incomplete', () => {
        expect(isIncompleteDeepResearchText('Researched 12 sources')).toBe(true);
        expect(isIncompleteDeepResearchText('')).toBe(true);
        expect(isIncompleteDeepResearchText('Done.')).toBe(true);
    });

    it('treats planning / progress / status leads as incomplete', () => {
        const padded = (lead) => `${lead}\n` + 'x'.repeat(200);
        expect(isIncompleteDeepResearchText(padded('Researching the web for relevant data'))).toBe(true);
        expect(isIncompleteDeepResearchText(padded('Thinking about how to approach this'))).toBe(true);
        expect(isIncompleteDeepResearchText(padded('Starting deep research now'))).toBe(true);
        expect(isIncompleteDeepResearchText(padded("I'll research the latest figures"))).toBe(true);
        expect(isIncompleteDeepResearchText(padded("Here's my research plan"))).toBe(true);
        expect(isIncompleteDeepResearchText(padded('Research plan'))).toBe(true);
    });

    it('treats a long-form report without a status lead as complete', () => {
        expect(isIncompleteDeepResearchText(REAL_REPORT)).toBe(false);
    });
});

describe('chooseDeepResearchReportRead', () => {
    it('prefers a completed target read over a completed frame read', () => {
        const chosen = chooseDeepResearchReportRead(
            { text: REAL_REPORT, sources: ['https://a'], from: 'target' },
            { text: REAL_REPORT + '\n\nframe copy', sources: [], from: 'frame' },
        );
        expect(chosen).not.toBeNull();
        expect(chosen.from).toBe('target');
        expect(chosen.completed).toBe(true);
        expect(chosen.sources).toEqual(['https://a']);
    });

    it('falls back to a completed frame when the target is missing or incomplete', () => {
        const chosen = chooseDeepResearchReportRead(
            { text: 'Researching...', from: 'target' },
            { text: REAL_REPORT, sources: ['https://b'], from: 'frame' },
        );
        expect(chosen.from).toBe('frame');
        expect(chosen.completed).toBe(true);
    });

    it('never treats planning/status text as completed', () => {
        const chosen = chooseDeepResearchReportRead(
            { text: 'Starting deep research now', from: 'target' },
            { text: 'Reading sources', from: 'frame' },
        );
        expect(chosen).not.toBeNull();
        expect(chosen.completed).toBe(false);
        // returns the longer of the two incomplete candidates
        expect(chosen.text).toBe('Starting deep research now');
    });

    it('returns null when both reads are empty', () => {
        expect(chooseDeepResearchReportRead({ text: '' }, { text: '   ' })).toBeNull();
        expect(chooseDeepResearchReportRead(null, null)).toBeNull();
    });

    it('defaults the `from` label when not provided', () => {
        const chosen = chooseDeepResearchReportRead({ text: REAL_REPORT }, null);
        expect(chosen.from).toBe('target');
        expect(chosen.completed).toBe(true);
    });
});

describe('Deep Research tool-call placeholder capture (G28)', () => {
    // Long enough that the 120-char floor cannot mask the marker path.
    const pad = ' Deep Research App. Response { session_id: abc-123, status: running }'
        + ' The connector is still working through its sources and has not produced a report yet.';
    const wrapper = (marker) => `${marker}${pad}`;

    it.each([
        ['called tool'],
        ['Called tool'],
        ['CALLED TOOL'],
        ['used tool'],
        ['Użyto narzędzia'],
        ['Narzędzie wywołane'],
    ])('recognizes %s as a tool-call capture', (marker) => {
        expect(looksLikeDeepResearchToolCallCapture(wrapper(marker))).toBe(true);
    });

    it('strips an Answer: prefix before matching', () => {
        expect(looksLikeDeepResearchToolCallCapture(`Answer: ${wrapper('Called tool')}`)).toBe(true);
    });

    it('collapses irregular whitespace before matching', () => {
        expect(looksLikeDeepResearchToolCallCapture(`Called   tool\n\n${pad}`)).toBe(true);
    });

    it.each([
        ['called tool'],
        ['Answer: Called tool'],
        ['Called   tool'],
    ])('flags %s as incomplete once padded past the length floor', (marker) => {
        const padded = `${marker}${pad}`;
        expect(padded.length).toBeGreaterThan(120);
        expect(isIncompleteDeepResearchText(padded)).toBe(true);
    });

    it('keeps a genuine report that mentions called tool mid-body', () => {
        const report = 'The agent called tool endpoints repeatedly during the研究 phase. '
            + 'This section documents how each provider responded, which sources were retained, '
            + 'and what the aggregate findings imply for the 2026 outlook across every region studied.';
        expect(report.length).toBeGreaterThan(120);
        expect(looksLikeDeepResearchToolCallCapture(report)).toBe(false);
        expect(isIncompleteDeepResearchText(report)).toBe(false);
    });

    it('keeps a genuine report that opens with JSON or a fence', () => {
        const jsonReport = '{"title":"API Research","sections":[{"name":"latency"}]} '
            + 'The remainder of this report analyses each endpoint in turn, with measured latency '
            + 'percentiles and a recommendation for the rollout sequence across the three regions.';
        const fenced = '```json\n{"revenue":10}\n```\n\nRevenue grew across every segment we measured, '
            + 'and the detailed breakdown below explains the drivers behind each of those movements '
            + 'together with the confidence we place in the underlying sources.';
        for (const text of [jsonReport, fenced]) {
            expect(text.length).toBeGreaterThan(120);
            expect(looksLikeDeepResearchToolCallCapture(text)).toBe(false);
            expect(isIncompleteDeepResearchText(text)).toBe(false);
        }
    });

    it('prefers a complete frame over a tool-call target', () => {
        const target = { text: wrapper('Called tool'), sources: [], from: 'target' };
        const frame = { text: REAL_REPORT, sources: ['https://example.com'], from: 'frame' };
        const chosen = chooseDeepResearchReportRead(target, frame);
        expect(chosen).toMatchObject({ from: 'frame', completed: true });
    });

    it('returns the longer wrapper flagged incomplete when both are tool-calls', () => {
        const target = { text: wrapper('Called tool'), sources: [], from: 'target' };
        const frame = { text: `${wrapper('Used tool')} and a little more text here`, sources: [], from: 'frame' };
        const chosen = chooseDeepResearchReportRead(target, frame);
        expect(chosen.completed).toBe(false);
        expect(chosen.from).toBe('frame');
    });
});

describe('Deep Research marker boundary (G28 false-positive guard)', () => {
    const body = ' This report compares the instruments used across three treatment centres, '
        + 'documents how each cohort was selected, and summarises the outcomes observed over the study period.';

    it.each([
        ['Used Tools in Modern Oncology: A Comparative Research Report'],
        ['Called Tools and Their Limits: A Survey'],
        ['Used Tooling Across the Industry'],
    ])('keeps a genuine report titled %s', (title) => {
        const report = `${title}.${body}`;
        expect(report.length).toBeGreaterThan(120);
        expect(looksLikeDeepResearchToolCallCapture(report)).toBe(false);
        expect(isIncompleteDeepResearchText(report)).toBe(false);
    });

    it.each([
        ['Called tool\nDeep Research App'],
        ['Used tool: web.run'],
        ['Called tool.'],
    ])('still recognizes the wrapper shape %s', (head) => {
        const wrapper = `${head}${body}`;
        expect(looksLikeDeepResearchToolCallCapture(wrapper)).toBe(true);
    });
});
