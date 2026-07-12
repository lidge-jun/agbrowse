import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { perplexitySendWebAi } from '../../web-ai/perplexity-live.mjs';
import { getSession } from '../../web-ai/session.mjs';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agbrowse-pplx-session-'));
  process.env.BROWSER_AGENT_HOME = home;
});

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
  else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('Perplexity send session lifecycle', () => {
  it('creates a bound provider session only after prompt commit', async () => {
    const page = createSendPage();
    const result = await perplexitySendWebAi({
      getPage: vi.fn(async () => page),
      getTargetId: vi.fn(async () => 'pplx-target-1'),
      getPort: () => 9222,
    }, {
      vendor: 'perplexity',
      prompt: 'Reply exactly OK',
      inlineOnly: true,
      attachmentPolicy: 'inline-only',
      timeout: 30,
    });

    expect(result).toMatchObject({
      ok: true,
      vendor: 'perplexity',
      status: 'sent',
      url: 'https://www.perplexity.ai/search/123e4567-e89b-12d3-a456-426614174000',
    });
    const session = getSession(result.sessionId);
    expect(session).toMatchObject({
      vendor: 'perplexity',
      targetId: 'pplx-target-1',
      tabId: 'pplx-target-1',
      status: 'sent',
      conversationUrl: 'https://www.perplexity.ai/search/123e4567-e89b-12d3-a456-426614174000',
      envelopeSummary: { assistantCount: 0, userCount: 0 },
    });
  });

  it('rejects invalid effort before target/page acquisition', async () => {
    const getTargetId = vi.fn();
    const getPage = vi.fn();
    await expect(perplexitySendWebAi({ getTargetId, getPage }, {
      prompt: 'x', reasoningEffort: 'on', attachmentPolicy: 'inline-only',
    })).rejects.toMatchObject({ errorCode: 'provider.model-mismatch', mutationAllowed: false });
    expect(getTargetId).not.toHaveBeenCalled();
    expect(getPage).not.toHaveBeenCalled();
  });
});

function createSendPage() {
  let url = 'https://www.perplexity.ai/';
  let prompt = '';
  let userCount = 0;

  const generic = (count = 0) => ({
    count: async () => count,
    nth: () => generic(count),
    first: () => generic(count),
    isVisible: async () => count > 0,
    innerText: async () => '',
    getAttribute: async () => null,
    locator: () => generic(0),
  });
  const composer = {
    count: async () => 1,
    nth: () => composer,
    first: () => composer,
    isVisible: async () => true,
    getAttribute: async (name) => name === 'role' ? 'textbox' : name === 'contenteditable' ? 'true' : null,
    click: async () => undefined,
    fill: async (value) => { prompt = value; },
    innerText: async () => prompt,
  };
  const submit = {
    count: async () => 1,
    nth: () => submit,
    first: () => submit,
    isVisible: async () => true,
    click: async () => {
      userCount += 1;
      url = 'https://www.perplexity.ai/search/123e4567-e89b-12d3-a456-426614174000';
    },
  };
  return {
    url: () => url,
    goto: vi.fn(async (next) => { url = next; }),
    waitForTimeout: async () => undefined,
    locator: (selector) => {
      if (selector === '#ask-input') return composer;
      if (selector === 'button[aria-label="Submit"]') return submit;
      if (selector === 'body') return { innerText: async () => prompt };
      if (selector.includes('user-message') || selector.includes('data-testid="query"') || selector.includes('data-query')) return generic(userCount);
      return generic(0);
    },
  };
}
