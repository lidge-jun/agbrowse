# 030 - Register GitHub issues and open PRs

## Tasks

### Issue Registration

Register these issues on lidge-jun/agbrowse:

P0 from scouting report (H-001 to H-007):
- Profile modes, Chrome auto-connect, DevToolsActivePort, CLI flags,
  endpoint ownership, tab ownership, startup lock

P1 from scouting report (H-008 to H-012):
- Action policy, encrypted state, output budget, CLI split, diagnostics

Self-discovered (S-001 to S-003):
- SPA fetch bug, duplicate version, spike files

Labels: category:browser-identity, severity:P0/P1, enhancement

### PR Publication

PR-A: fix(fetch): filter SPA internal API from network candidates
- Branch: codex/fix-fetch-spa-content
- Base: dev
- Contains: 010 implementation

PR-B: chore: package hygiene (version, spikes, LICENSE)
- Branch: codex/package-hygiene
- Base: dev
- Contains: 020 implementation

## Accept Criteria

- gh issue list shows 15 new issues (H-001 to H-012, S-001 to S-003)
- gh pr list shows 2 new draft PRs
- All PRs pass CI (typecheck + tests)
