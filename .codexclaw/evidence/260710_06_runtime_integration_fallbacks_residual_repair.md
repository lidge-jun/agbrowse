# 06 runtime integration fallbacks residual repair evidence

- Target: `devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md`
- Scope: residual prose fixes only; execution diff unchanged.

## Verification

Command:

```sh
set -e
! rg -n 'isLegacyComposerModelMenuOpen' devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
! rg -n 'GPT-5\.6 family' devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
rg -n '선택 가능한 family는 GPT-5\.6 Sol/GPT-5\.5/|GPT-5\.4/GPT-5\.3/o3의 실측 5종|chatGptLegacyMenuRootOpenedByComposer' devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
rg -n '^\+async function chatGptLegacyMenuRootOpenedByComposer\(page\)' devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md
rg -n '\^\(GPT-5|GPT-5\\\.6 Sol\|GPT-5\\\.5\|GPT-5\\\.4\|GPT-5\\\.3\|o3' devlog/_plan/260710_gpt56_update/06_runtime_integration_fallbacks.md
```

Fresh output (exit 0):

```text
stale-name scan: 0 matches
abbreviated-family scan: 0 matches
19:- family와 tier는 독립 축이다. Chat에서 선택 가능한 family는 GPT-5.6 Sol/GPT-5.5/
20:  GPT-5.4/GPT-5.3/o3의 실측 5종이며, `Instant`는 GPT-5.5, 나머지 tier는 선택된
27:  `chatGptLegacyMenuRootOpenedByComposer`의 구현 diff를 정의하며, 06은 이 03 소유 심볼을
876:+async function chatGptLegacyMenuRootOpenedByComposer(page) {
427:+            /^(GPT-5\.(?:6 Sol|5|4|3)|o3)$/i.test((el.textContent || '').trim()))
532:+                /^(GPT-5\.6 Sol|GPT-5\.5|GPT-5\.4|GPT-5\.3|o3)$/i,
```

## Judgement

PASS. Both residual prose defects are repaired, the stale name and abbreviated family phrase have zero remaining matches in the target document, the replacement matches the implementation owner at `03_chat_picker_selector_patch.md:876`, and the execution diff retains its five-family set.
