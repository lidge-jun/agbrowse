# Live DOM and executable evidence

## Environment

- Observed: 2026-08-08 KST, `https://chatgpt.com/`, Pro account, Chat surface.
- Chrome plugin session and Computer Use AX tree independently showed the same open menus.
- Local executable: `/Users/jun/.local/bin/agbrowse -> /Users/jun/Developer/new/700_projects/agbrowse/bin/agbrowse.mjs`.
- Local branch/HEAD at discovery: `dev`, `6cb58681771e273221a3b65089a3cf3a433890bf`, identical to `origin/dev`.
- Package in checkout: `0.1.17`; npm `latest`: `0.1.19`. Release must therefore start from current `main`, not publish this stale dev version directly.

## Live Chat picker contract

Closed state:

- Composer opener is `button.__composer-pill[aria-haspopup="menu"]` with text `Extra High`.
- It carries `aria-controls=<dynamic radix id>`, `aria-expanded`, `data-state`, and `data-is-open`.

Open shell:

- Root: `div[role="menu"][data-state="open"]`; no `composer-intelligence-picker-content` test id.
- `div[role="menuitem"][aria-label="Power"]` owns keyboard changes.
- Descendant slider is intentionally `aria-hidden`, with min `0`, max `4`, and current value `3`.
- The shell reports `Extra High, 4 of 5` and exposes an `Advanced` toggle.
- Model and Effort are separate `[role="menuitem"][data-has-submenu][aria-haspopup="menu"]` rows.

Observed Chat Power map, proven by keyboard activation and restored afterward:

| DOM value | Public display | Existing agbrowse contract |
| ---: | --- | --- |
| 0 | Instant | `--model instant` |
| 1 | Medium | `--model thinking --effort medium` |
| 2 | High | `--model thinking --effort high` |
| 3 | Extra High | `--model thinking --effort xhigh` |
| 4 | Pro | `--model pro` |

Advanced submenus:

- Model radios: `GPT-5.6 Sol` checked, `GPT-5.5`, `o3`.
- Effort radios: `Instant`, `Medium`, `High`, `Extra High` checked, `Pro`.
- Checked rows expose both `aria-checked="true"` and `data-state="checked"`.

Computer Use AX anchors:

- composer popup: `Extra High`.
- shell items: `Show compact options`, `Model GPT-5.6 Sol`, `Effort Extra High`.
- effort menu values: Instant 0, Medium 0, High 0, Extra High 1, Pro 0.

## Source contradiction

- `web-ai/chatgpt-model.mjs:301-303` scopes the current root only through the retired content test id.
- `web-ai/chatgpt-model.mjs:814-816` therefore returns a locator that is absent in the live shell.
- `web-ai/chatgpt-model.mjs:1557-1571` recognizes an open menu only when radio rows are already descendants of that root; the new top shell contains submenu triggers instead.
- `web-ai/chatgpt-model.mjs:1143-1210` has no exact-line entry path for the multiline `Effort\n<current>` submenu trigger.
- `web-ai/chatgpt-model.mjs:9,243-259`, `web-ai/tool-schema.mjs:55`, and CLI/docs still advertise retired 5.4/5.3 rows.
- `test/fixtures/provider-dom/chatgpt-gpt56-chat.html:63-145` encodes the previous flat menu and stale family list, so current tests cannot detect this drift.

## Baseline runtime

`agbrowse status` is running on CDP 9222 with one `about:blank` tab. `agbrowse web-ai status --vendor chatgpt --json` correctly reports `blocked`, active-tab verification fail, and `next: tab-switch`; this is browser readiness evidence, not a selector verdict.
