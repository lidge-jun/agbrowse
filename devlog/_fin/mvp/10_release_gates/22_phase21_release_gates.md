# Phase 21 — Docs and release gates

Required before public v1 messaging. This phase aligns the README, skills, and
release pipeline with what is actually proven by Phases 11-20.

## PR 21.1 — Production-readiness docs

### Diff

- MODIFY `README.md`
- NEW `docs/production-readiness.md`
- NEW `docs/comparison.md`
- MODIFY bundled skill docs

### Docs requirements

- Separate ready, beta, and experimental surfaces.
- State that local web-AI production requires Phases 11, 12, 13, 14, 16, and
  17.
- State that general browser-agent CLI claims require Phase 15.
- State that production MCP claims require Phase 18.
- State that hosted/cloud claims require Phase 19.
- Avoid star-count marketing.
- Avoid stealth/CAPTCHA/Cloudflare/account-access claims.

### PASS

- README and docs agree on support level.
- Comparison docs cite source docs for competitors.
- Known limitations are visible before install commands.

## PR 21.2 — Release gate

### Diff

- MODIFY `package.json`
- NEW or MODIFY `scripts/release.mjs`
- NEW or MODIFY `.github/workflows/release.yml`

### Release checks

- Unit tests.
- Integration tests.
- Phase 11 eval fixture suite.
- Source audit tests.
- MCP protocol tests if MCP production is claimed.
- `git diff --check`.

### PASS

- Release blocks on required tests.
- Release notes include eval metric deltas.
- Preview release includes trace/eval artifact samples.

## cli-jaw mirror

- Update `skills_ref/browser` and `skills_ref/web-ai`.
- Keep cli-jaw docs honest about which pieces are mirrored versus native.

## Final labels

- `ready`: proven by tests and docs.
- `beta`: implemented but live-provider-dependent.
- `experimental`: optional adapters, benchmarks, or cloud features.
