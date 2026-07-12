import { describe, expect, it } from 'vitest';
import { buildLeaseKey, canonicalLeaseOrigin, originFromUrl } from '../../web-ai/tab-lease-store.mjs';

describe('Perplexity lease origin identity', () => {
  it('canonicalizes bare and www HTTPS URLs to one provider origin', () => {
    expect(canonicalLeaseOrigin('perplexity', 'https://perplexity.ai/search/x')).toBe('https://www.perplexity.ai');
    expect(canonicalLeaseOrigin('perplexity', 'https://www.perplexity.ai/')).toBe('https://www.perplexity.ai');
    expect(originFromUrl('https://perplexity.ai/search/x', 'perplexity')).toBe('https://www.perplexity.ai');
  });

  it('uses one lease key in both host directions', () => {
    const common = { owner: 'web-ai', vendor: 'perplexity', sessionType: 'send-poll', port: 9222 };
    expect(buildLeaseKey({ ...common, url: 'https://perplexity.ai/' }))
      .toBe(buildLeaseKey({ ...common, url: 'https://www.perplexity.ai/search/x' }));
  });

  it('preserves existing provider lease key strings', () => {
    expect(buildLeaseKey({ vendor: 'chatgpt', url: 'https://chatgpt.com/c/x', port: 9222 }))
      .toBe('web-ai:chatgpt:send-poll:https://chatgpt.com:9222');
    expect(buildLeaseKey({ vendor: 'gemini', url: 'https://gemini.google.com/app/x', port: 9222 }))
      .toBe('web-ai:gemini:send-poll:https://gemini.google.com:9222');
    expect(buildLeaseKey({ vendor: 'grok', url: 'https://grok.com/x', port: 9222 }))
      .toBe('web-ai:grok:send-poll:https://grok.com:9222');
  });
});
