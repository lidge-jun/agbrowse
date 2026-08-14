# 020 - Package hygiene fixes

## File Change Map

### package.json
- Remove duplicate version field (keep 0.1.24 as the intended next version)

### Root directory
- Delete: agb-p1-probe.spike.mjs
- Delete: agb-p1b-probe.spike.mjs
- Delete: agb-p1c-probe.spike.mjs
- Delete: agb-p1d-probe.spike.mjs
- Delete: agb-wp16-b3.probe.test.mjs
- Delete: shot-combos.mjs
- Delete: shot-effort.mjs
- Delete: shot-open.mjs

### LICENSE (new file)
- Standard MIT license text
- Copyright holder: lidge-jun (per existing package.json license field)

## Accept Criteria

- grep -c '"version"' package.json returns 1
- ls *.spike.mjs *.probe.* shot-*.mjs returns empty
- test -f LICENSE passes
- npm test still passes
