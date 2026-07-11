# Perplexity Live DOM Observation

**Observed:** 2026-07-11

**Environment:** Authenticated Perplexity Pro desktop web UI at
`https://www.perplexity.ai/`, headed Chrome through agbrowse/CDP.

**Purpose:** Freeze the browser-visible contract used by the Perplexity Web-AI
TDD plan. Account text and unrelated history content are not fixture data.

## Composer

- Composer: `#ask-input`, `role="textbox"`, `contenteditable="true"`.
- Empty composer action: button accessible name `Use voice mode`.
- Non-empty composer action: button accessible name `Submit`.
- File/tool trigger: button accessible name `Add files or tools`,
  `aria-haspopup="menu"`.
- Upload action: `role="menuitem"` with text `Upload files or images`.
- The composer contains a hidden `input[type="file"][multiple]`.
- Search mode is a button with text `Search` and `aria-pressed="true"` in the
  observed default state.
- Computer mode is a separate button with text `Computer` and
  `aria-pressed="false"`.
- V1 must not click Search/Computer mode controls.

## Model Picker

- Closed trigger accessible name is `Model` when Best is active and the
  selected model label, such as `GPT-5.6 Terra`, for an explicit model.
- The open container is `role="menu"`.
- Selectable models are `role="menuitemradio"` with `aria-checked` and
  `data-state=checked|unchecked`.
- `Sonar 2` is a selectable `menuitemradio`; it is not a group heading.
- Observed selectable rows:
  - `Best` with description `Selects the best available model`
  - `Sonar 2`
  - `GPT-5.6 Terra` with `New` badge
  - `Gemini 3.1 Pro`
  - `Claude Sonnet 5`
  - `GLM 5.2`
  - `Kimi K2.6`
  - `Nemotron 3 Ultra`
- Observed locked rows:
  - `GPT-5.6 Sol` with `Max` badge
  - `Claude Opus 4.8` with `Max` badge
- Locked rows use `role="menuitem"`, include an SVG use reference ending in
  `pplx-icon-lock`, and are not `menuitemradio`.

## Thinking

- Thinking appears only after an eligible explicit model is selected.
- It is not nested inside the selected model row.
- It is the selected row's immediately following sibling:
  `role="menuitemcheckbox"` with visible text `Thinking`.
- The checkbox contains one `button[role="switch"]` with `aria-checked` and
  `data-state=checked|unchecked`.
- This evidence does not permit a selector that skips intervening siblings;
  the implementation must inspect `following-sibling::*[1]` semantics.
- Observed Terra state was Thinking OFF.
- When effort is omitted, Web-AI must not require, click, or change this
  checkbox/switch.
- When effort is explicit, selection order is model row first, then the unique
  adjacent Thinking checkbox/switch, followed by model and switch
  postcondition verification.

## Send And Completion

- Submit changes the URL to `/search/<uuid>`.
- During generation the composer action is a button named
  `Stop response (Esc)`.
- A completed answer footer contains buttons named:
  - `Share`
  - `Download`
  - `Copy`
  - `Rewrite Session`
  - `<number> sources`
  - `Helpful`
  - `Not helpful`
  - `More actions`
- A completed answer's nearest stable behavioral root is the ancestor
  containing answer text and that footer; observed class names are not a
  contract.

## Sources

- Clicking the committed answer's `<number> sources` button opens a side pane.
- The pane contains a button with text `Sources`.
- The pane's source entries are external `a[href]` elements with direct HTTPS
  URLs, `target="_blank"`, and `rel="noopener"`.
- Answer-body links can include ordinary inline links and internal
  `/search/<uuid>` Memory links; they must not be treated as the canonical
  citation list.
- Citation extraction should therefore scope to the committed answer's sources
  button and the opened Sources pane, not all anchors under the answer body.
- The Sources pane does not expose numeric citation indices in the observed
  DOM; stored citation `index` is `null` unless explicit index evidence appears
  in a future fixture.
- The first observation did not capture `aria-controls`, a stable pane ID,
  close-button semantics, or verified Escape behavior. Task 5 must capture
  before/after pane identity and the close mechanism before Task 8 implements
  pane association or closing; fake fixtures may not invent either contract.

## Probe Evidence

A short query, `Reply exactly UI_PROBE_OK`, was submitted with GPT-5.6 Terra:

- streaming control observed: `Stop response (Esc)`
- completed URL:
  `https://www.perplexity.ai/search/d33c7c4e-150d-436d-8140-c7ab08bf582b`
- completed answer text included `UI_PROBE_OK`
- completed footer reported `10 sources`
- model preference was restored to Best after observation
