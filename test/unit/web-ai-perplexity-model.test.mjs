import { describe, expect, it } from 'vitest';
import {
  PERPLEXITY_MODEL_CATALOG,
  inspectPerplexityModels,
  normalizePerplexityEffort,
  normalizePerplexityModelChoice,
  selectPerplexityModel,
  validatePerplexitySelectionRequest,
} from '../../web-ai/perplexity-model.mjs';
import { createPerplexityModelPageFixture } from '../helpers/perplexity-page-fixture.mjs';

describe('Perplexity model request contract', () => {
  it('normalizes every observed selectable model', () => {
    expect(normalizePerplexityModelChoice('Best')).toBe('best');
    expect(normalizePerplexityModelChoice('Sonar 2')).toBe('sonar-2');
    expect(normalizePerplexityModelChoice('GPT-5.6 Terra')).toBe('gpt-5.6-terra');
    expect(normalizePerplexityModelChoice('Gemini 3.1 Pro')).toBe('gemini-3.1-pro');
    expect(normalizePerplexityModelChoice('Claude Sonnet 5')).toBe('claude-sonnet-5');
    expect(normalizePerplexityModelChoice('GLM 5.2')).toBe('glm-5.2');
    expect(normalizePerplexityModelChoice('Kimi K2.6')).toBe('kimi-k2.6');
    expect(normalizePerplexityModelChoice('Nemotron 3 Ultra')).toBe('nemotron-3-ultra');
  });

  it('keeps observed locked models in the catalog', () => {
    expect(PERPLEXITY_MODEL_CATALOG['gpt-5.6-sol'].locked).toBe(true);
    expect(PERPLEXITY_MODEL_CATALOG['claude-opus-4.8'].locked).toBe(true);
  });

  it('marks Sonar 2 as not Thinking-capable and rejects Thinking before browser access', () => {
    expect(PERPLEXITY_MODEL_CATALOG['sonar-2'].supportsThinking).toBe(false);
    for (const effort of ['on', 'off']) {
      expect(() => validatePerplexitySelectionRequest('sonar-2', effort)).toThrow(
        expect.objectContaining({
          errorCode: 'provider.mode-unavailable',
          mutationAllowed: false,
        }),
      );
    }
  });

  it('normalizes effort aliases to the observed binary Thinking state', () => {
    expect(normalizePerplexityEffort('heavy')).toBe('on');
    expect(normalizePerplexityEffort('extended')).toBe('on');
    expect(normalizePerplexityEffort('normal')).toBe('off');
    expect(normalizePerplexityEffort('standard')).toBe('off');
    expect(normalizePerplexityEffort('wild')).toBeNull();
  });

  it('requires an explicit model before effort and makes no mutation claim', () => {
    expect(() => validatePerplexitySelectionRequest(undefined, 'on')).toThrow(
      expect.objectContaining({ errorCode: 'provider.model-mismatch', mutationAllowed: false }),
    );
  });

  it('rejects unsupported model and effort aliases', () => {
    expect(() => validatePerplexitySelectionRequest('unknown-model', undefined)).toThrow(
      expect.objectContaining({ errorCode: 'provider.model-mismatch', mutationAllowed: false }),
    );
    expect(() => validatePerplexitySelectionRequest('sonar-2', 'maximum')).toThrow(
      expect.objectContaining({ errorCode: 'provider.invalid-effort', mutationAllowed: false }),
    );
  });

  it('returns canonical validated selection', () => {
    expect(validatePerplexitySelectionRequest('GPT-5.6 Terra', 'heavy')).toEqual({
      requestedModel: 'gpt-5.6-terra',
      requestedThinking: 'on',
    });
  });

  it('records Thinking capability separately from Thinking-only models', () => {
    expect(PERPLEXITY_MODEL_CATALOG['sonar-2'].supportsThinking).toBe(false);
    expect(Object.values(PERPLEXITY_MODEL_CATALOG)
      .filter((entry) => entry.alias !== 'sonar-2')
      .every((entry) => entry.supportsThinking === true)).toBe(true);
    expect(PERPLEXITY_MODEL_CATALOG['glm-5.2'].thinkingOnly).toBe(true);
    expect(PERPLEXITY_MODEL_CATALOG['nemotron-3-ultra'].thinkingOnly).toBe(true);
    expect(PERPLEXITY_MODEL_CATALOG['claude-sonnet-5'].thinkingOnly).toBeFalsy();
  });

  it.each(['glm-5.2', 'nemotron-3-ultra'])('rejects Thinking OFF for %s before browser access', (model) => {
    expect(() => validatePerplexitySelectionRequest(model, 'off')).toThrow(
      expect.objectContaining({
        errorCode: 'provider.mode-unavailable',
        mutationAllowed: false,
        evidence: expect.objectContaining({ reason: 'thinking-only-model' }),
      }),
    );
  });
});

it('keeps reviewed English and Korean picker fixtures at observed Thinking OFF by default', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const [name, label] of [
    ['perplexity-model-picker-en.html', 'Thinking'],
    ['perplexity-model-picker-ko.html', '사고'],
  ]) {
    const html = await readFile(new URL(`../fixtures/provider-dom/${name}`, import.meta.url), 'utf8');
    expect(html).toContain(`role="switch" aria-label="${label}" aria-checked="false"`);
    expect((html.match(/role="menuitemcheckbox"/g) || []).length).toBe(8);
    expect(html).toContain('data-thinking-owner="glm-5.2" aria-checked="true" aria-disabled="true"');
    expect(html).toContain('data-thinking-owner="nemotron-3-ultra" aria-checked="true" aria-disabled="true"');
  }
});

it('keeps derived picker fixtures aligned with the reviewed role and state contract', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../fixtures/provider-dom/perplexity-model-picker-en.html', import.meta.url), 'utf8');
  expect(html).toContain('role="menu"');
  expect((html.match(/role="menuitemradio"/g) || []).length).toBe(8);
  expect(html).toContain('role="menuitemradio" aria-checked="true" data-state="checked"');
  expect(html).toContain('role="switch" aria-label="Thinking" aria-checked="false" data-state="unchecked"');
  expect(html).toContain('<use href="#pplx-icon-lock"></use>');
});

it('verifies the picker closed state while its live menu exit node remains mounted', async () => {
  const fixture = createPerplexityModelPageFixture({
    selectedModel: 'claude-sonnet-5',
    thinking: 'off',
    triggerClose: false,
    menuCloseByState: true,
  });

  await expect(inspectPerplexityModels(fixture.page)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ alias: 'claude-sonnet-5', selected: true, thinkingControlPresent: false }),
    ]),
  );
  expect(fixture.state).toMatchObject({
    selectedModel: 'claude-sonnet-5', thinking: 'off', menuOpen: true, menuState: 'closed',
  });
  expect(fixture.actions).toEqual([
    'trigger:Claude Sonnet 5',
    'keyboard:Escape',
  ]);
});

it.each([
  ['English', 'Thinking'],
  ['Korean', '사고'],
])('recognizes the %s Claude Sonnet 5 Thinking switch and can enable it', async (_locale, thinkingLabel) => {
  expect(PERPLEXITY_MODEL_CATALOG['claude-sonnet-5'].supportsThinking).toBe(true);
  const fixture = createPerplexityModelPageFixture({
    selectedModel: 'claude-sonnet-5',
    thinking: 'off',
    thinkingModel: 'claude-sonnet-5',
    thinkingLabel,
    menuOpen: true,
  });

  await expect(selectPerplexityModel(fixture.page, {
    requestedModel: 'claude-sonnet-5',
    requestedThinking: 'on',
  })).resolves.toMatchObject({
    resolvedModel: 'claude-sonnet-5',
    thinking: 'on',
    verified: true,
  });
  expect(fixture.actions).toEqual(['thinking:on']);
});

it('reads an already-on disabled Thinking-only switch without treating status as unavailable', async () => {
  const fixture = createPerplexityModelPageFixture({
    selectedModel: 'glm-5.2',
    thinking: 'on',
    thinkingModel: 'glm-5.2',
    thinkingDisabled: true,
    menuOpen: true,
  });

  await expect(inspectPerplexityModels(fixture.page)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        alias: 'glm-5.2',
        selected: true,
        supportsThinking: true,
        thinkingControlPresent: true,
      }),
    ]),
  );
  expect(fixture.actions).toEqual(['keyboard:Escape']);
});

it('accepts the live hyphenated GLM trigger label', async () => {
  const fixture = createPerplexityModelPageFixture({
    selectedModel: 'glm-5.2',
    thinking: 'on',
    thinkingModel: 'glm-5.2',
    thinkingDisabled: true,
    triggerLabel: 'GLM-5.2',
  });

  await expect(selectPerplexityModel(fixture.page, {
    requestedModel: 'glm-5.2',
    requestedThinking: 'on',
  })).resolves.toMatchObject({ resolvedModel: 'glm-5.2', thinking: 'on', verified: true });
  expect(fixture.actions).toEqual(['trigger:GLM-5.2']);
});

it('accepts a trigger label with the active English Thinking suffix', async () => {
  const fixture = createPerplexityModelPageFixture({
    selectedModel: 'claude-sonnet-5',
    thinking: 'on',
    thinkingModel: 'claude-sonnet-5',
    triggerLabel: 'Claude Sonnet 5 Thinking',
  });

  await expect(selectPerplexityModel(fixture.page, {
    requestedModel: 'claude-sonnet-5',
    requestedThinking: 'on',
  })).resolves.toMatchObject({ resolvedModel: 'claude-sonnet-5', thinking: 'on', verified: true });
  expect(fixture.actions).toEqual(['trigger:Claude Sonnet 5 Thinking']);
});


describe('Perplexity model mutation action log', () => {
  it('reacquires remounted rows and verifies model plus Thinking postconditions', async () => {
    const fixture = createPerplexityModelPageFixture({ selectedModel: 'best', thinking: 'off', menuOpen: true });
    await expect(selectPerplexityModel(fixture.page, {
      requestedModel: 'gpt-5.6-terra', requestedThinking: 'on',
    })).resolves.toEqual({
      requestedModel: 'gpt-5.6-terra',
      resolvedModel: 'gpt-5.6-terra',
      resolvedLabel: 'GPT-5.6 Terra',
      locked: false,
      thinking: 'on',
      verified: true,
    });
    expect(fixture.actions).toEqual([
      'model:gpt-5.6-terra',
      'trigger:GPT-5.6 Terra',
      'thinking:on',
    ]);
  });

  it('does not click locked models or ambiguous Thinking switches', async () => {
    const locked = createPerplexityModelPageFixture({ selectedModel: 'best', menuOpen: true });
    await expect(selectPerplexityModel(locked.page, {
      requestedModel: 'gpt-5.6-sol', requestedThinking: null,
    })).rejects.toMatchObject({ errorCode: 'provider.model-entitlement', mutationAllowed: false });
    expect(locked.actions).toEqual([]);

    const duplicate = createPerplexityModelPageFixture({
      selectedModel: 'gpt-5.6-terra', thinking: 'off', duplicateSwitch: true, menuOpen: true,
    });
    await expect(selectPerplexityModel(duplicate.page, {
      requestedModel: 'gpt-5.6-terra', requestedThinking: 'on',
    })).rejects.toMatchObject({ errorCode: 'provider.mode-unavailable', mutationAllowed: false });
    expect(duplicate.actions).toEqual([]);
  });

  it('allows omitted effort when no Thinking control is observed', async () => {
    const fixture = createPerplexityModelPageFixture({ selectedModel: 'sonar-2', thinkingAvailable: false, menuOpen: true });
    await expect(selectPerplexityModel(fixture.page, {
      requestedModel: 'sonar-2', requestedThinking: null,
    })).resolves.toMatchObject({ resolvedModel: 'sonar-2', thinking: null, verified: true });
    expect(fixture.actions).toEqual([]);
  });
});
