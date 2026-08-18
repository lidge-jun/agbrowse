# 050 — WP5: release

1. bump `package.json` version (0.2.0 → 0.2.1).
2. commit the whole unit (code + tests + fixtures + docs + devlog).
3. `git push origin <branch>` — user explicitly authorized push + deploy.
4. publish to npm via the repository's canonical mechanism; verify with
   `npm view agbrowse version`.

## Verification (C)

- `git log --oneline -3`, `git status --short` clean for owned paths
- `npm view agbrowse version` == new version

