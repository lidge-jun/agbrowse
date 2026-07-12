import { describe, expect, it, vi } from 'vitest';
import {
  PERPLEXITY_CITATION_GRACE_MS,
  evaluatePerplexityCompletion,
  extractPerplexityCitations,
  openFreshPerplexityThread,
  probePerplexityStreamingState,
  resolveLatestPerplexityResponseRoot,
  validatePerplexityUnsupportedFeatures,
} from '../../web-ai/perplexity-live.mjs';

describe('Perplexity V1 scope validation', () => {
  it.each([
    [{ tools: ['x'] }, 'tools'],
    [{ plugins: ['x'] }, 'plugins'],
    [{ webSearch: true }, 'webSearch'],
    [{ autoTools: true }, 'autoTools'],
    [{ outputImage: 'out.png' }, 'outputImage'],
    [{ followUps: ['next'] }, 'followUps'],
    [{ research: 'deep' }, 'research'],
    [{ filePaths: ['a', 'b'] }, 'filePaths'],
  ])('rejects unsupported feature before browser access: %s', (input, feature) => {
    expect(() => validatePerplexityUnsupportedFeatures(input)).toThrow(
      expect.objectContaining({
        errorCode: 'capability.unsupported',
        vendor: 'perplexity',
        mutationAllowed: false,
        evidence: expect.objectContaining({ feature }),
      }),
    );
  });

  it('accepts the V1 prompt/model/effort/single-file surface', () => {
    expect(() => validatePerplexityUnsupportedFeatures({
      prompt: 'hello', model: 'sonar-2', reasoningEffort: 'off', filePath: '/tmp/a.txt',
    })).not.toThrow();
  });

  it('accepts canonical-equal effort aliases and rejects canonical conflicts', () => {
    expect(() => validatePerplexityUnsupportedFeatures({ effort: 'heavy', reasoningEffort: 'on' })).not.toThrow();
    expect(() => validatePerplexityUnsupportedFeatures({ effort: 'normal', reasoningEffort: 'off' })).not.toThrow();
    expect(() => validatePerplexityUnsupportedFeatures({ effort: 'heavy', reasoningEffort: 'off' })).toThrow(
      expect.objectContaining({ errorCode: 'provider.option-conflict', vendor: 'perplexity' }),
    );
  });
});

describe('Perplexity completion gate', () => {
  it('uses the required citation grace', () => {
    expect(PERPLEXITY_CITATION_GRACE_MS).toBe(2000);
  });

  it('requires progress, a new committed turn, text stability, settled citations, and idle streaming', () => {
    const base = {
      progressObserved: true,
      isNewTurn: true,
      promptCommitObserved: true,
      text: 'answer',
      stableText: 'answer',
      responseStableMs: 2000,
      citationState: 'present',
      citationFingerprint: 'a',
      stableCitationFingerprint: 'a',
      citationStableMs: 600,
      streamingState: 'idle',
    };
    expect(evaluatePerplexityCompletion(base)).toBe(true);
    expect(evaluatePerplexityCompletion({ ...base, progressObserved: false })).toBe(false);
    expect(evaluatePerplexityCompletion({ ...base, streamingState: 'unknown' })).toBe(false);
    expect(evaluatePerplexityCompletion({ ...base, citationState: 'pending' })).toBe(false);
    expect(evaluatePerplexityCompletion({ ...base, isNewTurn: false })).toBe(false);
  });

  it('degraded-completes unavailable citations only after two seconds', () => {
    const base = {
      progressObserved: true, isNewTurn: true, promptCommitObserved: true,
      text: 'answer', stableText: 'answer', responseStableMs: 1999,
      citationState: 'unavailable', citationFingerprint: '', stableCitationFingerprint: '',
      citationStableMs: 0, streamingState: 'idle',
    };
    expect(evaluatePerplexityCompletion(base)).toBe(false);
    expect(evaluatePerplexityCompletion({ ...base, responseStableMs: 2000 })).toBe(true);
  });
});

describe('Perplexity streaming and fresh-thread guards', () => {
  it('maps exactly one visible Stop response (Esc) control to streaming', async () => {
    const page = fakePage({ stopVisible: true, copyVisible: false });
    await expect(probePerplexityStreamingState(page)).resolves.toBe('streaming');
  });

  it('maps a committed-root Copy action without a stop control to idle', async () => {
    const page = fakePage({ stopVisible: false, copyVisible: true });
    await expect(probePerplexityStreamingState(page, page.locator('[data-testid="answer"]'))).resolves.toBe('idle');
  });


  it('resolves the latest committed response root for scoped MCP copy', async () => {
    const latest = { isVisible: async () => true };
    const roots = {
      count: async () => 2,
      nth: (index) => index === 1 ? latest : { isVisible: async () => true },
    };
    const emptyRoots = {
      count: async () => 0,
      nth: () => emptyRoots,
    };
    const page = {
      locator: (selector) => selector === 'button[aria-label="Copy"], button:not([aria-label]):has-text("Copy")'
        ? { locator: () => roots }
        : { filter: () => ({ locator: () => emptyRoots }) },
    };
    await expect(resolveLatestPerplexityResponseRoot(page)).resolves.toBe(latest);
  });

  it('does not close an already-open sources pane after citation extraction', async () => {
    let closeCalls = 0;
    const sourceButton = {
      isVisible: async () => true,
      innerText: async () => '15 sources',
    };
    const sourceButtons = {
      count: async () => 1,
      nth: () => sourceButton,
    };
    const committed = {
      locator: {
        locator: (selector) => selector === 'button'
          ? { filter: () => sourceButtons }
          : sourceButtons,
      },
    };
    const pane = {
      locator: () => ({
        evaluateAll: async () => [{ url: 'https://example.test/source', title: 'Source', index: null }],
      }),
    };

    await expect(extractPerplexityCitations({}, committed, {
      baseUrl: 'https://www.perplexity.ai/search/example',
      paneAdapter: {
        openAndResolve: async () => ({
          pane,
          close: async () => { closeCalls += 1; return true; },
        }),
      },
    })).resolves.toMatchObject({
      state: 'present',
      citations: [expect.objectContaining({ url: 'https://example.test/source' })],
    });
    expect(closeCalls).toBe(0);
  });

  it('navigates an existing conversation to the exact root and verifies a clean composer', async () => {
    const page = fakeFreshPage('https://www.perplexity.ai/search/123e4567-e89b-12d3-a456-426614174000');
    await expect(openFreshPerplexityThread(page)).resolves.toMatchObject({ url: 'https://www.perplexity.ai/' });
    expect(page.goto).toHaveBeenCalledWith('https://www.perplexity.ai/', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
  });
});

function fakePage({ stopVisible, copyVisible }) {
  const locators = new Map();
  const make = (selector) => ({
    count: async () => selector.includes('Stop response') ? (stopVisible ? 1 : 0) : selector.includes('Copy') ? (copyVisible ? 1 : 0) : 1,
    nth: () => make(selector), first: () => make(selector),
    isVisible: async () => selector.includes('Stop response') ? stopVisible : selector.includes('Copy') ? copyVisible : true,
    locator: (child) => make(child),
  });
  return { locator: (selector) => locators.get(selector) || make(selector) };
}

function fakeFreshPage(initialUrl) {
  let currentUrl = initialUrl;
  const composer = {
    count: async () => 1, nth: () => composer, first: () => composer,
    isVisible: async () => true,
    getAttribute: async (name) => name === 'role' ? 'textbox' : name === 'contenteditable' ? 'true' : null,
  };
  const responses = { count: async () => 0, nth: () => responses, first: () => responses, isVisible: async () => false };
  return {
    url: () => currentUrl,
    goto: vi.fn(async (url) => { currentUrl = url; }),
    locator: (selector) => selector === '#ask-input' ? composer : responses,
    waitForTimeout: async () => undefined,
  };
}
