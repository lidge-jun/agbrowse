import { describe, expect, it } from 'vitest';
import { resolveTimeoutBudgetSec, resolveTimeoutDefaultSec, summarizeEnvelope } from '../../web-ai/session.mjs';

describe('Perplexity timeout defaults', () => {
  it('uses 1200 seconds normally and 3600 seconds for canonical Thinking on', () => {
    expect(resolveTimeoutDefaultSec({}, 'perplexity')).toBe(1200);
    expect(resolveTimeoutDefaultSec({ model: 'gpt-5.6-terra', reasoningEffort: 'on' }, 'perplexity')).toBe(3600);
  });

  it('restores Thinking timeout from session summary', () => {
    expect(resolveTimeoutBudgetSec({}, {
      vendor: 'perplexity', deadlineAt: null,
      envelopeSummary: { model: 'gpt-5.6-terra', reasoningEffort: 'on' },
    }, 'perplexity', Date.now())).toBe(3600);
  });

  it('persists canonical reasoning effort in the envelope summary', () => {
    expect(summarizeEnvelope({ model: 'gpt-5.6-terra', reasoningEffort: 'on' })).toMatchObject({
      model: 'gpt-5.6-terra', reasoningEffort: 'on',
    });
  });
});
