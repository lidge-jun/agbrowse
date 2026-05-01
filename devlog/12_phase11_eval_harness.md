# Phase 11 — DOM churn eval harness

Quantify agbrowse's resilience to provider DOM changes. Instead of
discovering breakage from user reports, run a fixture-based benchmark that
measures capability pass rates, target resolution success, and self-healing
cache effectiveness.

Inspired by WebVoyager's real-world website benchmark and Stagehand's
action caching metrics.

Depends on Phase 8 (self-heal + action cache provide the metrics).

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Eval runner + ChatGPT fixtures | NEW `web-ai/eval-runner.mjs`; NEW `test/fixtures/provider-dom/chatgpt-*.html`; NEW `test/fixtures/provider-snapshots/chatgpt-*.json`; unit tests. |
| **PR2** | Gemini + Grok fixtures + CI | NEW fixtures for gemini/grok; MODIFY CI config; integration tests. |

## Metrics

| Metric | Source | Target |
| --- | --- | --- |
| Capability pass rate | `runCapabilities()` against fixture pages | > 95% on known fixtures |
| Composer target resolution | `resolveActionTarget()` with intent `composer.fill` | 100% on fixtures |
| Upload surface resolution | `resolveActionTarget()` with intent `upload.open` | > 90% on fixtures |
| Copy markdown exactness | `captureCopiedResponseText()` output vs expected | > 85% on fixtures |
| Self-healing cache hit rate | Action cache stats after fixture rotation | > 70% on second pass |
| Snapshot token estimate | `estimateSnapshotTokens()` | < 500 tokens per provider |
| Doctor repair packet completeness | All required fields present | 100% |

## Fixture design

Each provider gets 3+ fixture variants:

1. **Baseline** — current known-good DOM structure.
2. **Cosmetic churn** — class names changed, data attributes shuffled,
   style changes. Semantic structure intact.
3. **Structural churn** — element hierarchy changed, selectors broken,
   but accessible roles/names preserved.
4. **Breaking churn** — accessible names removed, roles changed. Tests
   should demonstrate graceful degradation.

Fixtures are static HTML files that can be loaded via `page.setContent()`
or served from a local HTTP server.

## Diffs (PR1)

### NEW `web-ai/eval-runner.mjs`

API surface:

```js
export async function runEvalSuite(browser, options = {}) {}
export function summarizeEvalResults(results) {}
export function compareEvalRuns(baseline, current) {}
```

Skeleton:

```js
export async function runEvalSuite(browser, {
    providers = ['chatgpt', 'gemini', 'grok'],
    fixtureDir = 'test/fixtures/provider-dom',
    variants = ['baseline', 'cosmetic-churn', 'structural-churn'],
} = {}) {
    const results = [];
    for (const provider of providers) {
        for (const variant of variants) {
            const page = await browser.newPage();
            const html = await loadFixture(fixtureDir, provider, variant);
            await page.setContent(html);

            const caps = await runCapabilities(/* ... */);
            const resolve = await testTargetResolution(page, provider);
            const snapshot = await buildWebAiSnapshot(page, { provider });

            results.push({
                provider,
                variant,
                capabilityPassRate: caps.filter(c => c.state === 'ok').length / caps.length,
                targetResolution: resolve,
                snapshotTokens: snapshot.stats.tokenEstimate,
                interactiveCount: snapshot.stats.interactiveCount,
            });

            await page.close();
        }
    }
    return results;
}

export function summarizeEvalResults(results) {
    return {
        overall: results.reduce((sum, r) => sum + r.capabilityPassRate, 0) / results.length,
        byProvider: groupBy(results, 'provider'),
        byVariant: groupBy(results, 'variant'),
    };
}
```

## Public-surface changes

- New command (dev-only): `agbrowse web-ai eval --fixtures <dir> --json`
- Not shipped in production CLI — dev/CI tool only.

## Test plan

- Unit: eval runner produces results for all provider × variant combos.
- Unit: baseline fixtures achieve 100% capability pass rate.
- Unit: cosmetic churn fixtures achieve > 95% (hash changes but caps pass).
- Unit: structural churn fixtures demonstrate self-heal resolution.
- CI: eval suite runs on PR and reports metric delta vs main.

## Exit criteria

- A new contributor can run `agbrowse web-ai eval` and see a quantified
  report of DOM churn resilience.
- CI blocks PRs that reduce capability pass rate below threshold.

## Risks

- **Most likely:** fixtures diverge from real provider DOM over time.
  Mitigate by periodically capturing real DOM snapshots (manual process,
  privacy-scrubbed).
- **Secondary:** eval suite is slow (launching browsers per fixture).
  Mitigate by using `page.setContent()` instead of navigation.

## cli-jaw mirror

| Item | cli-jaw status |
| --- | --- |
| `eval-runner` | **Port as-is** — same fixtures, same metrics. |
| Fixtures | **Share** — agbrowse fixtures are canonical; cli-jaw test imports them or copies. |
| CI integration | **Separate** — each repo runs its own eval in CI. |
