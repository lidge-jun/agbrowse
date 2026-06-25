import { describe, expect, it } from 'vitest';
import { parsePublicFeed, formatFeedEvidence } from '../../skills/browser/adaptive-fetch/feed-parser.mjs';

// Parity catalog 203.4 (P2): RSS/Atom/JSON-feed parser.
describe('adaptive fetch feed parser', () => {
    it('returns null for non-feed text', () => {
        expect(parsePublicFeed('just a plain html page <div>hi</div>', null)).toBeNull();
    });

    it('parses an RSS feed into items', () => {
        const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
            <title>Example Blog</title>
            <description>news and notes</description>
            <link>https://example.com</link>
            <item><title>First Post</title><link>https://example.com/1</link><pubDate>Mon, 01 Jun 2026</pubDate><description><![CDATA[<p>hello &amp; welcome</p>]]></description><category>tech</category></item>
            <item><title>Second Post</title><link>https://example.com/2</link><dc:creator>Jane</dc:creator></item>
        </channel></rss>`;
        const feed = parsePublicFeed(rss, null);
        expect(feed.kind).toBe('rss-atom');
        expect(feed.title).toBe('Example Blog');
        expect(feed.items.length).toBe(2);
        expect(feed.items[0].title).toBe('First Post');
        expect(feed.items[0].url).toBe('https://example.com/1');
        expect(feed.items[0].summary).toMatch(/hello & welcome/); // CDATA + entity decode + strip html
        expect(feed.items[0].tags).toContain('tech');
        expect(feed.items[1].author).toBe('Jane');
    });

    it('parses a JSON feed', () => {
        const json = {
            title: 'JSON Feed Example',
            home_page_url: 'https://jsonfeed.example',
            items: [
                { title: 'Hi', url: 'https://jsonfeed.example/1', date_published: '2026-06-01', content_text: 'body text', tags: ['a', 'b'] },
            ],
        };
        const feed = parsePublicFeed('', json);
        expect(feed.kind).toBe('feed-json');
        expect(feed.title).toBe('JSON Feed Example');
        expect(feed.items[0].url).toBe('https://jsonfeed.example/1');
        expect(feed.items[0].tags).toEqual(['a', 'b']);
    });

    it('formatFeedEvidence produces text + metadata with item/media URLs', () => {
        const feed = parsePublicFeed('', {
            title: 'F', items: [{ title: 'X', url: 'https://e/1', attachments: [{ url: 'https://e/media.mp3' }] }],
        });
        const ev = formatFeedEvidence(feed);
        expect(ev.kind).toBe('feed-json');
        expect(ev.text).toMatch(/Feed: F/);
        expect(ev.metadata.itemUrls).toContain('https://e/1');
        expect(ev.metadata.mediaUrls).toContain('https://e/media.mp3');
    });
});
