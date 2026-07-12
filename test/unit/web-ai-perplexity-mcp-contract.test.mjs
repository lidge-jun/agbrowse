import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleMcpMessage } from '../../web-ai/mcp-server.mjs';
import {
  toolSchemaForMcp,
  validateProviderWebAiInput,
} from '../../web-ai/tool-schema.mjs';
import { featureDefinitionsForVendor } from '../../web-ai/doctor.mjs';
import {
  editorContractForVendor,
  PERPLEXITY_EDITOR_CONTRACT,
} from '../../web-ai/vendor-editor-contract.mjs';
import { PERPLEXITY_COPY_SELECTORS } from '../../web-ai/copy-markdown.mjs';
import { wrapError, optionConflictError } from '../../web-ai/errors.mjs';

describe('Perplexity MCP contract', () => {
  it('advertises Perplexity and binary Thinking aliases', () => {
    const schema = toolSchemaForMcp('web_ai_submit_prompt');
    expect(schema.inputSchema.properties.provider.enum).toContain('perplexity');
    expect(schema.inputSchema.properties.effort.enum).toEqual(expect.arrayContaining(['on', 'off']));
    expect(schema.description).toContain('Perplexity');
  });

  it('validates Perplexity semantic input and resolves equal aliases', () => {
    expect(validateProviderWebAiInput('web_ai_submit_prompt', {
      provider: 'perplexity',
      model: 'gpt-5.6-terra',
      effort: 'heavy',
      reasoningEffort: 'on',
      prompt: 'hello',
    })).toMatchObject({ provider: 'perplexity', reasoningEffort: 'on' });

    expect(() => validateProviderWebAiInput('web_ai_submit_prompt', {
      provider: 'perplexity', family: 'gpt-5.6-sol', prompt: 'hello',
    })).toThrow(expect.objectContaining({ errorCode: 'provider.model-mismatch' }));
    expect(() => validateProviderWebAiInput('web_ai_submit_prompt', {
      provider: 'perplexity', effort: 'on', prompt: 'hello',
    })).toThrow(expect.objectContaining({ errorCode: 'provider.model-mismatch' }));
    expect(() => validateProviderWebAiInput('web_ai_submit_prompt', {
      provider: 'perplexity', model: 'gpt-5.6-terra', effort: 'on', reasoningEffort: 'off', prompt: 'hello',
    })).toThrow(expect.objectContaining({ errorCode: 'provider.option-conflict', vendor: 'perplexity' }));
  });

  it('fails conflicting provider aliases before browser access and serializes typed errors', async () => {
    let browserAccess = 0;
    const response = await handleMcpMessage({
      jsonrpc: '2.0', id: 91, method: 'tools/call', params: {
        name: 'web_ai_submit_prompt',
        arguments: { provider: 'perplexity', vendor: 'grok', prompt: 'hello' },
      },
    }, {
      getPage: async () => { browserAccess += 1; throw new Error('unexpected'); },
      getTargetId: async () => { browserAccess += 1; throw new Error('unexpected'); },
    });

    expect(browserAccess).toBe(0);
    expect(response.result.isError).toBe(true);
    expect(response.result.structuredContent.error).toMatchObject({
      errorCode: 'provider.option-conflict',
      stage: 'provider-input-validation',
      vendor: 'perplexity',
      mutationAllowed: false,
    });
  });

  it('preserves an existing typed error instead of replacing its vendor with fallback context', () => {
    const original = optionConflictError('perplexity', 'effort', 'on', 'off');
    expect(wrapError(original, { vendor: 'chatgpt' })).toBe(original);
  });

  it('exposes Perplexity doctor features, semantic targets, and scoped copy selectors', () => {
    const features = featureDefinitionsForVendor('perplexity');
    expect(features.length).toBeGreaterThan(0);
    expect(features.map((entry) => entry.feature)).toEqual(expect.arrayContaining([
      'composer', 'model-picker', 'response-feed', 'copy-fallback', 'streaming-indicator',
    ]));
    expect(PERPLEXITY_COPY_SELECTORS.turnSelectors.length).toBeGreaterThan(0);
    expect(PERPLEXITY_COPY_SELECTORS.copyButtonSelectors).toEqual(['button']);
    expect(PERPLEXITY_COPY_SELECTORS.copyButtonNames).toEqual(['Copy']);
    const mcpSource = readFileSync(new URL('../../web-ai/mcp-server.mjs', import.meta.url), 'utf8');
    expect(mcpSource).toContain('resolveLatestPerplexityResponseRoot');
    expect(mcpSource).toMatch(/captureCopiedResponseText\([^;]+committedRoot/s);
    expect(editorContractForVendor('perplexity')).toBe(PERPLEXITY_EDITOR_CONTRACT);
    expect(PERPLEXITY_EDITOR_CONTRACT.semanticTargets.composer.cssFallbacks).toContain('#ask-input');
  });
});
