import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { runOneFixture, runWebAiEval } from '../../web-ai/eval-runner.mjs';

describe('Perplexity provider eval fixtures', () => {
  it('passes the dedicated offline baseline/cosmetic/structural config', async () => {
    const result = await runWebAiEval({ config: resolve('test/fixtures/provider-dom/perplexity-eval.json'), concurrency: 2 });
    expect(result.status).toBe('pass');
    expect(result.summary).toMatchObject({ total: 3, passCount: 3, failCount: 0 });
    expect(result.results.flatMap((entry) => entry.errors)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ errorCode: 'eval.network-blocked' })]),
    );
  });

  it('detects the intentional breaking fixture', async () => {
    const result = await runOneFixture({
      vendor: 'perplexity', variant: 'breaking',
      fixturePath: resolve('test/fixtures/provider-dom/perplexity-breaking.html'),
      requiredIntents: ['composer.fill', 'send.click'],
    }, { fixtureDir: resolve('test/fixtures/provider-dom'), index: 0 });
    expect(result.status).toBe('fail');
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorCode: 'eval.target-resolution-failed' }),
    ]));
  });

  it('keeps fixtures offline and records derived provenance without live-capture claims', async () => {
    const provenance = JSON.parse(await readFile('test/fixtures/provider-dom/perplexity-fixture-provenance.json', 'utf8'));
    expect(provenance.entries.length).toBeGreaterThan(10);
    expect(provenance.entries.every((entry) => entry.kind === 'derived')).toBe(true);
    expect(provenance.entries.some((entry) => entry.source === 'live-frontend')).toBe(false);
    expect(provenance.overlay).toEqual({ kind: 'not-observed', selector: null });
  });
});
