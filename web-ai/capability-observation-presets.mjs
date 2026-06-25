// @ts-check

// Parity catalog 201 #2 (P1): curated live-UI frontend observation presets (selector/
// text/activation-path/active-signals per capability). Data complements agbrowse's
// per-vendor selector contracts. Reverse port of cli-jaw web-ai/capability-observation-presets.ts.

/** @typedef {import('./capability-types.mjs').FrontendCapabilityObservation} FrontendCapabilityObservation */

/** @type {FrontendCapabilityObservation} */
export const CHATGPT_MODEL_SELECTOR_OBSERVATION = {
    status: 'implemented',
    source: 'live-frontend',
    selectorCandidates: [
        '[data-testid="model-switcher-dropdown-button"]',
        'button.__composer-pill[aria-haspopup="menu"]',
        '[data-testid="model-switcher-gpt-5-3"]',
        '[data-testid="model-switcher-gpt-5-5-thinking"]',
        '[data-testid="model-switcher-gpt-5-5-pro"]',
        '[data-testid="model-switcher-gpt-5-5-thinking-thinking-effort"]',
        '[data-testid="model-switcher-gpt-5-5-pro-thinking-effort"]',
    ],
    textCandidates: ['Latest', 'Instant', 'Fast', 'Thinking', 'Thinking • Heavy', 'Pro', 'Heavy', 'Effort', 'Configure...'],
    activationPath: ['open model switcher or composer model pill', 'select menuitemradio or model-switcher effort menuitem', 'verify aria-checked=true or active pill text'],
    activeStateSignals: ['composer model pill text', 'role=menuitemradio', 'aria-checked=true', 'Heavy pill for Pro/Heavy'],
    mutationRisk: 'low',
    notes: [
        'Codex Cloud is out of scope.',
        'Model label text must be filtered from response capture.',
        '2026-04-30 headed UI moved the visible model opener to the composer pill; top data-testid opener may be absent.',
        'Thinking/Pro effort controls are runtime selectors; Pro can appear as a Heavy composer pill in the headed UI.',
    ],
};

/** @type {FrontendCapabilityObservation} */
export const CHATGPT_ATTACHMENT_OBSERVATION = {
    status: 'implemented',
    source: 'live-frontend',
    selectorCandidates: ['[data-testid="composer-plus-btn"]', 'input[type="file"]'],
    textCandidates: ['Add files and more'],
    activationPath: ['click composer plus', 'discover composer-scoped file input', 'set local file', 'wait for upload chip'],
    activeStateSignals: ['visible upload chip', 'sent user turn attachment evidence'],
    mutationRisk: 'medium',
    notes: ['Live upload smoke returned JAW_UPLOAD_OK.', 'Accepted types and account limits remain UI-authoritative.'],
};

/** @type {FrontendCapabilityObservation} */
export const CHATGPT_WEB_SEARCH_OBSERVATION = {
    status: 'schema-ready',
    source: 'live-frontend',
    selectorCandidates: ['[data-testid="composer-plus-btn"]', '[role="menuitemradio"]'],
    textCandidates: ['Web search', 'Search'],
    activationPath: ['click Add files and more', 'select Web search menuitemradio', 'verify Search chip'],
    activeStateSignals: ['composer footer contains Search', 'button[aria-label="Search, click to remove"]'],
    mutationRisk: 'medium',
    notes: ['Observed in headed 30_browser on 2026-04-29.', 'Runtime send option is still gated until activation helper is wired.'],
};

/** @type {FrontendCapabilityObservation} */
export const CHATGPT_IMAGE_GENERATION_OBSERVATION = {
    status: 'schema-ready',
    source: 'live-frontend',
    selectorCandidates: ['[data-testid="composer-plus-btn"]', '[role="menuitemradio"]'],
    textCandidates: ['Create image', 'Image', 'Auto'],
    activationPath: ['click Add files and more', 'select Create image menuitemradio', 'verify Image chip and aspect-ratio picker'],
    activeStateSignals: ['composer footer contains Image', 'button[aria-label="Image, click to remove"]', 'Choose image aspect ratio'],
    mutationRisk: 'medium',
    notes: ['Observed in headed 30_browser on 2026-04-29.', 'Output artifact capture remains a separate runtime phase.'],
};

/** @type {FrontendCapabilityObservation} */
export const GEMINI_DEEP_THINK_OBSERVATION = {
    status: 'implemented',
    source: 'live-frontend',
    selectorCandidates: ['button:has-text("Tools")', 'button:has-text("Deep think")'],
    textCandidates: ['Tools', 'Deep think', 'Deselect Deep think'],
    activationPath: ['open fresh chat', 'open Tools', 'select Deep think', 'verify chip'],
    activeStateSignals: ['Deep think chip', 'Deselect Deep think control'],
    mutationRisk: 'low',
    notes: ['Deep Think is a Tools menu capability, not Gemini model selection.'],
};

/** @type {FrontendCapabilityObservation} */
export const GEMINI_MODEL_PICKER_OBSERVATION = {
    status: 'schema-ready',
    source: 'live-frontend',
    selectorCandidates: ['button[aria-label="Open mode picker"]', '[role="menu"] [role="menuitem"]'],
    textCandidates: ['Fast', 'Thinking', 'Pro', 'Gemini 3', '3.1 Pro'],
    activationPath: ['click Open mode picker', 'choose Flash-Lite|Flash|Pro menuitem', 'verify picker label'],
    activeStateSignals: ['mode picker button text equals selected mode'],
    mutationRisk: 'medium',
    notes: ['Observed separately from Deep Think in headed 30_browser on 2026-04-29.', 'Deep Think remains a Tools menu capability.'],
};

/** @type {FrontendCapabilityObservation} */
export const GEMINI_IMAGE_GENERATION_OBSERVATION = {
    status: 'schema-ready',
    source: 'live-frontend',
    selectorCandidates: ['button[aria-label="Tools"]', '[role="menuitemcheckbox"]'],
    textCandidates: ['Create image'],
    activationPath: ['open Tools', 'select Create image menuitemcheckbox', 'verify aria-checked=true'],
    activeStateSignals: ['role=menuitemcheckbox', 'aria-checked=true'],
    mutationRisk: 'medium',
    notes: ['Observed in Gemini Tools menu with headed 30_browser on 2026-04-29.', 'Output artifact capture remains a separate runtime phase.'],
};

/** @type {FrontendCapabilityObservation} */
export const GEMINI_TOOLS_MENU_OBSERVATION = {
    status: 'schema-ready',
    source: 'live-frontend',
    selectorCandidates: ['button[aria-label="Tools"]', '[role="menu"] [role="menuitemcheckbox"]'],
    textCandidates: ['Canvas', 'Deep research', 'Create video', 'Create music', 'Learn'],
    activationPath: ['open Tools', 'select matching menuitemcheckbox', 'verify aria-checked=true or visible chip'],
    activeStateSignals: ['role=menuitemcheckbox', 'aria-checked=true', 'tool chip or deselect control'],
    mutationRisk: 'medium',
    notes: ['Observed Gemini Tools menu entries in headed 30_browser on 2026-04-29.'],
};

/** @type {FrontendCapabilityObservation} */
export const CHATGPT_DEEP_RESEARCH_OBSERVATION = {
    status: 'schema-ready',
    source: 'live-frontend',
    selectorCandidates: ['[data-testid="composer-plus-btn"]', '[role="menuitemradio"]'],
    textCandidates: ['Deep research', 'Apps', 'Sites'],
    activationPath: ['click Add files and more', 'select Deep research menuitemradio', 'verify Deep research chip'],
    activeStateSignals: ['button[aria-label="Deep research, click to remove"]', 'Apps control', 'Sites control'],
    mutationRisk: 'medium',
    notes: ['Observed in headed 30_browser on 2026-04-29.', 'Runtime state machine remains separate from normal chat.'],
};
