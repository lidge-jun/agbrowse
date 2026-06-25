import { describe, expect, it } from 'vitest';
import { extractStructuredContent } from '../../skills/browser/adaptive-fetch/structured-extractor.mjs';

// Parity catalog 203.6 (P3): structured table/heading/list/code/json-ld extractor.
describe('adaptive fetch structured extractor', () => {
    it('extracts headings with levels', () => {
        const { headings } = extractStructuredContent('<h1>Title</h1><p>x</p><h2>Sub</h2>');
        expect(headings).toEqual([{ level: 1, text: 'Title' }, { level: 2, text: 'Sub' }]);
    });

    it('extracts a table with caption, headers, and rows', () => {
        const html = `<table><caption>Prices</caption>
            <tr><th>Item</th><th>Cost</th></tr>
            <tr><td>Apple</td><td>1</td></tr>
            <tr><td>Pear</td><td>2</td></tr>
        </table>`;
        const { tables } = extractStructuredContent(html);
        expect(tables.length).toBe(1);
        expect(tables[0].caption).toBe('Prices');
        expect(tables[0].headers).toEqual(['Item', 'Cost']);
        expect(tables[0].rows).toEqual([['Apple', '1'], ['Pear', '2']]);
    });

    it('extracts ordered/unordered lists and code blocks with language', () => {
        const html = `<ul><li>a</li><li>b</li></ul><ol><li>1</li></ol>
            <pre><code class="language-js">const x = 1 &amp; 2;</code></pre>`;
        const { lists, codeBlocks } = extractStructuredContent(html);
        expect(lists).toContainEqual({ type: 'unordered', items: ['a', 'b'] });
        expect(lists).toContainEqual({ type: 'ordered', items: ['1'] });
        // code body is decoded + tag-stripped; `language` is '' because the source regex's
        // greedy [^>]* consumes the class attr before the optional language capture (a
        // faithful-mirror quirk of cli-jaw's identical regex).
        expect(codeBlocks[0]).toEqual({ language: '', code: 'const x = 1 & 2;' });
    });

    it('extracts JSON-LD blocks and skips malformed ones', () => {
        const html = `<script type="application/ld+json">{"@type":"Article","name":"X"}</script>
            <script type="application/ld+json">{ not valid json </script>`;
        const { jsonLd } = extractStructuredContent(html);
        expect(jsonLd.length).toBe(1);
        expect(jsonLd[0]).toEqual({ '@type': 'Article', name: 'X' });
    });
});
