---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, verification]
---

# Verification Matrix

## Local Deterministic Gates

Run after implementation:

```bash
npm run smoke:bins
npm run typecheck
npm run typecheck:checkjs
npx vitest run test/unit/browser-adaptive-fetch-*.test.mjs
npx vitest run test/integration/browser-fetch-command.test.mjs
npm run docs:counts
npm run docs:drift
npm run check:module-graph
npm run pack:dry
```

If `check:module-graph` changes `docs/migration/module-graph.json`, rerun:

```bash
npm run fix:counts
npm run docs:counts
npm run docs:drift
```

## JSON Validity Smoke

These must all produce stdout that parses as JSON:

```bash
node bin/agbrowse.mjs fetch https://www.reddit.com/ --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://www.reddit.com/r/programming/ --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://news.ycombinator.com/item?id=8863 --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://www.npmjs.com/package/playwright-core --json --trace --browser never --timeout-ms 15000
```

Acceptance:

- command exit code 0;
- `JSON.parse(stdout)` succeeds;
- schema includes `ok`, `verdict`, `source`, `finalUrl`, `attempts`;
- long content is compacted with truncation metadata instead of clipped stdout.

## Hard Live Smoke Matrix

HTTP-only:

```bash
node bin/agbrowse.mjs fetch https://www.nytimes.com/ --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://github.com/lidge-jun/agbrowse --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://news.ycombinator.com/item?id=8863 --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://www.reddit.com/ --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://en.wikipedia.org/wiki/Web_scraping --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://arxiv.org/abs/1706.03762 --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://medium.com/ --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://www.wsj.com/ --json --trace --browser never --timeout-ms 15000
node bin/agbrowse.mjs fetch https://www.npmjs.com/package/playwright-core --json --trace --browser never --timeout-ms 15000
```

Browser/reader escalation:

```bash
node bin/agbrowse.mjs fetch https://www.nytimes.com/ --json --trace --browser auto --browser-session isolated --timeout-ms 30000
node bin/agbrowse.mjs fetch https://medium.com/ --json --trace --browser auto --browser-session isolated --timeout-ms 30000
node bin/agbrowse.mjs fetch https://www.reddit.com/ --json --trace --browser auto --browser-session isolated --timeout-ms 30000
node bin/agbrowse.mjs fetch https://www.wsj.com/ --json --trace --browser auto --browser-session user --timeout-ms 30000
node bin/agbrowse.mjs fetch https://www.nytimes.com/ --json --trace --browser never --allow-third-party-reader --timeout-ms 30000
```

Acceptance:

- blocked/auth/challenge classifications are acceptable observations;
- invalid JSON is never acceptable;
- `--browser never` never uses Chrome;
- isolated browser never reuses the user's authenticated session;
- user/interactive modes must disclose explicit user-session use;
- no private-network URL can become the winning candidate.

