import { describe, expect, it } from 'vitest';
import {
  isProviderOriginUrl,
  isSafePerplexityConversationUrl,
  isSafeProviderConversationUrl,
  perplexityConversationId,
  providerUrlsCompatible,
} from '../../web-ai/provider-url-identity.mjs';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('provider URL identity', () => {
  it('accepts only exact Perplexity search UUID routes on bare or www hosts', () => {
    for (const url of [
      `https://perplexity.ai/search/${UUID}`,
      `https://www.perplexity.ai/search/${UUID}/`,
      `https://www.perplexity.ai/search/${UUID.toUpperCase()}`,
    ]) expect(isSafePerplexityConversationUrl(url)).toBe(true);

    for (const url of [
      'http://www.perplexity.ai/search/' + UUID,
      'https://evil.example/search/' + UUID,
      'https://www.perplexity.ai/',
      'https://user@www.perplexity.ai/search/' + UUID,
      'https://www.perplexity.ai:443/search/' + UUID,
      'https://www.perplexity.ai/search/' + UUID + '?q=1',
      'https://www.perplexity.ai/search/' + UUID + '#x',
      'https://www.perplexity.ai/foo/search/' + UUID,
      'https://www.perplexity.ai/search/../search/' + UUID,
      'https://www.perplexity.ai/search/%2e%2e/search/' + UUID,
      'https://www.perplexity.ai/search/' + UUID.replace('-', '%2D'),
      'https://www.perplexity.ai/search/' + UUID.replace('-', '%252D'),
      'https://www.perplexity.ai/search/' + UUID.replace('-', '%2F'),
      'https://www.perplexity.ai/search/abc',
      'https://www.perplexity.ai/search/' + UUID + 'x',
      'https://www.perplexity.ai/search/' + UUID + '\\x',
    ]) expect(isSafePerplexityConversationUrl(url), url).toBe(false);
  });

  it('canonicalizes IDs and compatible bare/www URLs', () => {
    const bare = `https://perplexity.ai/search/${UUID}`;
    const www = `https://www.perplexity.ai/search/${UUID.toUpperCase()}/`;
    expect(perplexityConversationId(www)).toBe(UUID);
    expect(providerUrlsCompatible(bare, www, 'perplexity')).toBe(true);
    expect(providerUrlsCompatible(bare, `https://www.perplexity.ai/search/223e4567-e89b-12d3-a456-426614174000`, 'perplexity')).toBe(false);
  });

  it('recognizes safe provider origins and dispatches guards', () => {
    expect(isProviderOriginUrl('perplexity', 'https://perplexity.ai/')).toBe(true);
    expect(isProviderOriginUrl('perplexity', 'https://www.perplexity.ai/search/' + UUID)).toBe(true);
    expect(isProviderOriginUrl('perplexity', 'https://www.perplexity.ai:443/')).toBe(false);
    expect(isSafeProviderConversationUrl('perplexity', `https://www.perplexity.ai/search/${UUID}`)).toBe(true);
    expect(isSafeProviderConversationUrl('gemini', 'https://gemini.google.com/app/abc')).toBe(false);
  });
});
