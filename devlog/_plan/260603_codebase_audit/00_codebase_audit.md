# agbrowse Codebase Audit — 2026-06-03

## Summary

Overall quality: **high**. 811 tests passing, typecheck clean, structure drift checks passing, comprehensive release gates. One critical vulnerability (vitest) requires immediate attention.

## Test Suite

- **112 test files**, 811 pass, 12 skipped, 0 fail
- Unit (94), integration (16), e2e (1), spec (2)
- Duration: ~37s
- Skipped tests are intentional gap-tracking specs (antigravity)

## CI/CD Health

| Workflow | Status | Trigger | Notes |
|----------|--------|---------|-------|
| contract-drift | ✅ passing | schedule (weekly) + PR | Fixture + live drift with alert webhook |
| pages | ❌ was failing | push + dispatch | **Fixed**: removed `enablement: true` (fb27ba6) |
| release | ✅ passing | manual dispatch | Full gate suite before publish |

### Pages Fix Detail

Push-triggered runs failed because `configure-pages@v5` with `enablement: true` needs admin-scope token to create Pages sites. The `GITHUB_TOKEN` from push events lacks this. Pages was already configured via a prior `workflow_dispatch` run, so `enablement` is unnecessary. Fix: removed the flag.

## Dependency Audit

| Package | Current | Latest | Action |
|---------|---------|--------|--------|
| vitest | 3.2.4 | 4.1.8 | 🔴 **CRITICAL** — GHSA-5xrq-8626-4rwp (arbitrary file read/execute when UI server listening). Upgrade urgently. Breaking change to v4. |
| playwright-core | 1.58.2 | 1.60.0 | ⚠️ Outdated — stability/browser compat fixes |
| archiver | 7.0.1 | 8.0.0 | ⚠️ Major bump — evaluate breaking changes |
| typescript | 5.9.3 | 6.0.3 | ⚠️ Major bump — evaluate strict-migration impact |
| @types/node | 20.19.39 | 25.9.1 | ⚠️ Major bump — align with Node version |

### Risk: vitest v3 → v4 is a breaking change

- Config API may change
- Test globals behavior differs
- Custom reporters/transforms may need updates
- Recommend: create a branch, run `npm audit fix --force`, verify all 811 tests still pass

## Architecture

```
bin/agbrowse.mjs (CLI entry)
├── skills/browser/     (11.7K LOC, 36 files) — CDP lifecycle, refs, tabs, adaptive fetch
├── web-ai/             (20.1K LOC, 90 files) — Provider adapters, session store, trace/policy
│   ├── providers/      — ChatGPT, Gemini, Grok adapters
│   ├── eval/           — Offline fixture evaluation
│   ├── trace/          — Trace redaction and persistence
│   ├── policy/         — Mutation guards, evaluate policy
│   └── mcp-server.mjs  — Frozen-scope MCP bridge
├── structure/          — Source-of-truth docs with automated drift checks
├── docs/               — GitHub Pages site
└── test/               — 112 test files (unit/integration/e2e/spec)
```

## Code Quality

- ✅ No TODO/FIXME/HACK in source
- ✅ Typecheck clean (`tsc --noEmit`)
- ✅ Structure drift checks pass (140 checks)
- ✅ Module counts verified
- ✅ Fail-closed provider contracts
- ✅ Session-to-tab strong binding
- ✅ Trace redaction (API keys, emails)
- ✅ 16 named release gates

## Stale Branches

| Branch | Last Commit | Status |
|--------|-------------|--------|
| chore/strict-migration | f43390f | web-ai default model change — may be superseded |
| docs/structure-refresh-2026-05-06 | b66b93b | docs refresh — likely merged into main already |

Recommend: verify and delete stale branches.

## Action Items

1. **[CRITICAL]** Upgrade vitest 3.2.4 → 4.1.x (CVE fix)
2. **[HIGH]** Upgrade playwright-core 1.58.2 → 1.60.0 (stability)
3. **[MEDIUM]** Clean up stale branches
4. **[LOW]** Evaluate archiver 8.x, typescript 6.x upgrades
5. **[DONE]** Fix Pages CI workflow (fb27ba6)
