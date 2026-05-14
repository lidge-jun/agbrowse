---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, tests]
---

# Test Strategy

## Unit Tests

Required:

- validator classifies challenge markers;
- validator treats tiny HTML as `challenge`;
- validator returns `strong_ok` when positive proof matches;
- validator returns `weak_ok` only when no negative proof exists;
- metadata parser extracts OGP and JSON-LD without `innerHTML` assumptions;
- reader adapters normalize fetch, metadata, public endpoint, third-party
  reader, browser, and network candidates into one candidate shape;
- content scorer prefers dense readable article text over metadata-only shells;
- content scorer records the winning evidence so the trace can explain the
  selection;
- third-party readers remain disabled unless explicitly opted in;
- third-party reader failures degrade to a trace warning, not a fake success;
- transforms are domain-agnostic and deduplicate URLs;
- endpoint resolver chooses public API only for supported platform shapes;
- trace formatter redacts sensitive values.

## Integration Tests

Use local test servers, not live WAF targets:

- normal HTML page with expected selector;
- tiny challenge-like page;
- 403 response;
- SPA shell with JSON endpoint;
- login-wall fixture;
- RSS feed fixture;
- JSON-LD product/article fixture;
- redirect chain fixture.
- reader race fixture where metadata succeeds weakly but article text wins
  through scoring.

## Browser Tests

If browser escalation lands:

- start existing cli-jaw browser runtime;
- navigate to a local fixture page;
- capture text/DOM;
- capture mock XHR request;
- verify network request redaction;
- verify no cookies or auth headers are serialized into trace output.

## Optional Online Smoke

Keep live tests out of default CI. Add an opt-in script for:

- `https://example.com/`
- `https://httpbin.org/status/403`
- one public HN/Reddit/arXiv endpoint

Do not include WAF bypass tests in CI. They are flaky, ethically noisy, and will
create false product confidence.

## Gates

For implementation:

```bash
npm run typecheck
npm test -- adaptive-fetch
bash structure/verify-counts.sh
```

If browser command/help docs are changed:

```bash
npm run gate:all
```

If a no-site-name checker is added:

```bash
npm run gate:adaptive-fetch-bias
```

## Regression Invariants

- A status 200 challenge page must not be `ok`.
- Missing optional dependency must not be silently installed.
- Browser escalation must show `source: "browser"`.
- Authentication boundaries must return `auth_required`, not `challenge`.
- Repeated pagination requires explicit user intent or command flags.
- Trace output must be enough to debug without exposing secrets.
