// @ts-check
import { describe, it, expect } from 'vitest';
import {
    parseWebVoyagerJsonl,
    rowToDescriptor,
    dryRunWebVoyager,
    EVAL_ADAPTER_VERSION,
} from '../../web-ai/eval-adapters/webvoyager.mjs';

const FIXTURE_JSONL = [
    JSON.stringify({ id: 'wv-1', url: 'https://example.com', instruction: 'find the about page' }),
    JSON.stringify({ id: 'wv-2', web: 'https://shop.example.com', ques: 'what is the price of item X' }),
    '',
    JSON.stringify({ id: 'wv-3', url: 'https://news.example.com', instruction: 'find latest article' }),
].join('\n');

describe('G08 webvoyager eval adapter', () => {
    it('schema version is frozen', () => {
        expect(EVAL_ADAPTER_VERSION).toBe('webvoyager-adapter-v1');
    });

    it('parses JSONL rows ignoring blank lines', () => {
        const rows = parseWebVoyagerJsonl(FIXTURE_JSONL);
        expect(rows.length).toBe(3);
        expect(rows[0].id).toBe('wv-1');
    });

    it('rowToDescriptor maps url/instruction with scoreClaim=null', () => {
        const d = rowToDescriptor({ id: 'x', url: 'https://x.com', instruction: 'do thing' });
        expect(d.scoreClaim).toBe(null);
        expect(d.adapter).toBe('webvoyager');
        expect(d.url).toBe('https://x.com');
    });

    it('dryRunWebVoyager respects limit and never claims a score', () => {
        const r = dryRunWebVoyager(FIXTURE_JSONL, { limit: 2 });
        expect(r.total).toBe(3);
        expect(r.materialised).toBe(2);
        expect(r.scoreClaim).toBe(null);
        for (const d of r.descriptors) expect(d.scoreClaim).toBe(null);
    });

    it('rejects malformed JSONL with eval.malformed', () => {
        expect(() => parseWebVoyagerJsonl('not json at all\n')).toThrow(/malformed/);
    });

    it('rejects rows missing url/instruction with eval.incomplete', () => {
        expect(() => rowToDescriptor({ id: 'bad' })).toThrow(/missing url/);
    });
});
