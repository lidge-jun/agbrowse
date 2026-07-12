import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAnswerArtifact } from '../../web-ai/answer-artifact.mjs';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-perplexity-persistence-'));
  process.env.BROWSER_AGENT_HOME = tmpHome;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
  else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
  vi.resetModules();
});

describe('Perplexity answer persistence', () => {
  it('preserves citations in normalized artifacts', () => {
    const citations = [{ index: 1, title: 'Source', url: 'https://example.com/a?q=테스트' }];
    expect(createAnswerArtifact({ provider: 'perplexity', text: '답변🙂', citations }).citations).toEqual(citations);
    expect(createAnswerArtifact({ provider: 'perplexity', text: 'none', citations: [] })).toHaveProperty('citations', []);
  });

  it('stores one canonical answer and citation artifact in the session', async () => {
    vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab: vi.fn(async () => ({ ok: true, pooled: true })) }));
    const { createSession, getSession } = await import('../../web-ai/session.mjs');
    const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
    const session = createSession({ vendor: 'perplexity', prompt: 'hello', attachmentPolicy: 'inline-only' }, {
      targetId: 'target-p', conversationUrl: 'https://www.perplexity.ai/search/123e4567-e89b-12d3-a456-426614174000',
    });
    const citations = [{ index: 1, title: 'Source', url: 'https://example.com/source' }];
    await finalizeProviderTab({ getPort: () => 9222 }, {
      vendor: 'perplexity', session, answerArtifact: { provider: 'perplexity', text: 'canonical answer', markdown: 'canonical answer', citations },
    });
    const stored = getSession(session.sessionId);
    expect(stored.answer).toBe('canonical answer');
    expect(stored.answerArtifact.text).toBe('canonical answer');
    expect(stored.answerArtifact.citations).toEqual(citations);
  });

  it('round-trips a 2 MiB answer and 500 citations through a fresh process', async () => {
    const { createSession, updateSession } = await import('../../web-ai/session.mjs');
    const answer = 'x'.repeat(2 * 1024 * 1024);
    const citations = Array.from({ length: 500 }, (_, index) => ({
      index: index + 1,
      title: `Source ${index + 1}`,
      url: `https://example.com/source/${index + 1}?q=%ED%85%8C%EC%8A%A4%ED%8A%B8`,
    }));
    const session = createSession({ vendor: 'perplexity', prompt: 'large persistence', attachmentPolicy: 'inline-only' });
    updateSession(session.sessionId, {
      status: 'complete',
      answer,
      answerArtifact: { provider: 'perplexity', text: answer, markdown: answer, citations },
    });

    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { getSession } from './web-ai/session.mjs';
      const session = getSession(${JSON.stringify(session.sessionId)});
      process.stdout.write(JSON.stringify({
        answerLength: session.answer.length,
        artifactLength: session.answerArtifact.text.length,
        citationCount: session.answerArtifact.citations.length,
        lastCitation: session.answerArtifact.citations.at(-1),
      }));
    `], {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER_AGENT_HOME: tmpHome },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      answerLength: answer.length,
      artifactLength: answer.length,
      citationCount: 500,
      lastCitation: citations.at(-1),
    });
  });

  it('rejects mismatched answer text and artifact text', async () => {
    vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab: vi.fn(async () => ({ ok: true })) }));
    const { createSession } = await import('../../web-ai/session.mjs');
    const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
    const session = createSession({ vendor: 'perplexity', prompt: 'hello', attachmentPolicy: 'inline-only' }, { targetId: 'target-p' });
    await expect(finalizeProviderTab({}, {
      vendor: 'perplexity', session, answerText: 'A', answerArtifact: { text: 'B', citations: [] },
    })).rejects.toMatchObject({ errorCode: 'internal.answer-artifact-mismatch', stage: 'finalize' });
  });
});
