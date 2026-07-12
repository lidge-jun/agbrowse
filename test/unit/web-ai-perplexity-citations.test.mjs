import { describe, expect, it } from 'vitest';
import { normalizePerplexityCitations } from '../../web-ai/perplexity-citations.mjs';

const base = 'https://www.perplexity.ai/search/123e4567-e89b-12d3-a456-426614174000';

describe('normalizePerplexityCitations', () => {
  it('resolves relative URLs, strips fragments, and preserves queries', () => {
    expect(normalizePerplexityCitations([
      { title: 'A', url: '/source?a=1#section', index: 3 },
    ], base)).toEqual([{ title: 'A', url: 'https://www.perplexity.ai/source?a=1', index: 3 }]);
  });

  it('accepts only HTTP(S), rejects internal search memories, and preserves first visual order', () => {
    expect(normalizePerplexityCitations([
      { title: 'One', url: 'https://example.com/a#x' },
      { title: 'Duplicate', url: 'https://example.com/a#y' },
      { title: 'Internal', url: '/search/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      { title: 'JS', url: 'javascript:alert(1)' },
      { title: 'Two', url: 'http://example.org/b?q=2' },
    ], base)).toEqual([
      { title: 'One', url: 'https://example.com/a', index: null },
      { title: 'Two', url: 'http://example.org/b?q=2', index: null },
    ]);
  });

  it('uses null when no explicit positive numeric index exists', () => {
    expect(normalizePerplexityCitations([
      { title: 'Zero', url: 'https://example.com/0', index: 0 },
      { title: 'Text', url: 'https://example.com/t', index: 'source' },
      'https://example.com/string',
    ], base)).toEqual([
      { title: 'Zero', url: 'https://example.com/0', index: null },
      { title: 'Text', url: 'https://example.com/t', index: null },
      { title: '', url: 'https://example.com/string', index: null },
    ]);
  });
});
