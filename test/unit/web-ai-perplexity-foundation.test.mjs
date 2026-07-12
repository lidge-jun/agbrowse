import { describe, expect, it } from 'vitest';
import { WEB_AI_VENDOR } from '../../web-ai/types.mjs';
import { normalizeEnvelope } from '../../web-ai/question.mjs';
import { normalizeEvalVendor } from '../../web-ai/eval/types.mjs';
import {
  invalidEffortError,
  modeUnavailableError,
  modelEntitlementError,
  modelMismatchError,
  optionConflictError,
  sessionVendorMismatchError,
} from '../../web-ai/errors.mjs';
import { listCapabilitySchemas } from '../../web-ai/capability-registry.mjs';

describe('Perplexity provider foundation', () => {
  it('registers the provider identity across question and eval contracts', () => {
    expect(WEB_AI_VENDOR.PERPLEXITY).toBe('perplexity');
    expect(normalizeEnvelope({ vendor: 'perplexity', prompt: 'hello' }).vendor).toBe('perplexity');
    expect(normalizeEvalVendor('perplexity')).toBe('perplexity');
  });

  it('serializes fail-closed provider errors', () => {
    expect(modelMismatchError('perplexity', 'unknown').toJSON()).toMatchObject({
      errorCode: 'provider.model-mismatch', retryHint: 'model-fallback', vendor: 'perplexity', mutationAllowed: false,
    });
    expect(modelEntitlementError('perplexity', 'gpt-5.6-sol').toJSON()).toMatchObject({
      errorCode: 'provider.model-entitlement', retryHint: 'choose-unlocked-model', vendor: 'perplexity', mutationAllowed: false,
    });
    expect(modeUnavailableError('perplexity', 'gpt-5.6-terra', 'on').toJSON()).toMatchObject({
      errorCode: 'provider.mode-unavailable', retryHint: 'omit-effort-or-change-model', vendor: 'perplexity', mutationAllowed: false,
    });
    expect(invalidEffortError('perplexity', 'turbo').toJSON()).toMatchObject({
      errorCode: 'provider.invalid-effort', retryHint: 'use-on-off-effort-aliases', vendor: 'perplexity', mutationAllowed: false,
    });
    expect(optionConflictError('perplexity', 'effort', 'on', 'off').toJSON()).toMatchObject({
      errorCode: 'provider.option-conflict', stage: 'provider-input-validation', vendor: 'perplexity', mutationAllowed: false,
    });
    expect(sessionVendorMismatchError('perplexity', 'chatgpt', 'session-1').toJSON()).toMatchObject({
      errorCode: 'provider.session-vendor-mismatch', stage: 'session-resolve', vendor: 'perplexity', mutationAllowed: false,
    });
  });

  it('exposes six planned Perplexity capability rows', () => {
    const rows = listCapabilitySchemas({ vendor: 'perplexity' }).filter((row) => row.providerId === 'perplexity');
    expect(rows.map((row) => row.capabilityId)).toEqual(expect.arrayContaining([
      'perplexity-active-tab-verification',
      'perplexity-composer-visible',
      'perplexity-model-alias-selectable',
      'perplexity-upload-surface-visible',
      'perplexity-copy-button-present',
      'perplexity-response-streaming',
    ]));
  });
});
