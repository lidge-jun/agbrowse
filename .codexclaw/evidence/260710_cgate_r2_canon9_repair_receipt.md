# C-gate R2 Canon 9 Repair Evidence

- Target: `devlog/_plan/260710_gpt56_update/02_core_contract_decisions.md`
- Canon owner: `devlog/_plan/260710_gpt56_update/04_work_surface_support.md:250-253`
- Verification result: PASS (exit 0)

## Command

```bash
python3 - <<'PY'
from pathlib import Path
import re
p = Path('devlog/_plan/260710_gpt56_update/02_core_contract_decisions.md')
s = p.read_text()
residue = re.findall(r"workSurfaceUnsupportedError\((?:surface|['\"])", s)
assert not residue
blocks = []
needle = 'workSurfaceUnsupportedError({'
pos = 0
while True:
    start = s.find(needle, pos)
    if start < 0:
        break
    end = s.find('});', start)
    assert end >= 0
    blocks.append(s[start:end + 3])
    pos = end + 3
assert len(blocks) == 2
for block in blocks:
    for field in ('surface', 'ui:', 'evidence:', 'warning:'):
        assert field in block
owner = Path('devlog/_plan/260710_gpt56_update/04_work_surface_support.md').read_text()
assert '@param {ChatGptComposerSurfaceStatus} composerSurface' in owner
assert 'function workSurfaceUnsupportedError(composerSurface)' in owner
PY
```

## Output

```text
[check 1] all call sites
1003:+        throw workSurfaceUnsupportedError({
1023:+            throw workSurfaceUnsupportedError({
[check 2] string/discriminator arguments must be absent
PASS: no string/discriminator argument remains
[check 3] status-object calls and required fields
PASS: 2 object calls; each carries surface, ui, evidence, warning
[check 4] canonical owner signature
PASS: 04 owner accepts ChatGptComposerSurfaceStatus composerSurface
```

## Judgement

PASS. The two call sites at target lines 1003 and 1023 now pass status objects with
`surface`, `ui`, `evidence`, and `warning`; no string/discriminator call remains. The
object shape matches the 04-owned `ChatGptComposerSurfaceStatus` parameter contract.
