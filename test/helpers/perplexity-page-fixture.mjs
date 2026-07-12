// @ts-check

const SELECTABLE = [
  'best',
  'sonar-2',
  'gpt-5.6-terra',
  'gemini-3.1-pro',
  'claude-sonnet-5',
  'glm-5.2',
  'kimi-k2.6',
  'nemotron-3-ultra',
];
const LOCKED = ['gpt-5.6-sol', 'claude-opus-4.8'];
const LABELS = {
  best: 'Best',
  'sonar-2': 'Sonar 2',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'glm-5.2': 'GLM 5.2',
  'kimi-k2.6': 'Kimi K2.6',
  'nemotron-3-ultra': 'Nemotron 3 Ultra',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'claude-opus-4.8': 'Claude Opus 4.8',
};

/**
 * Deterministic fake Page/Locator surface for Perplexity model mutation tests.
 * Every model or switch click increments a DOM generation. Element locators
 * created before that click throw if reused, which makes remount bugs visible.
 *
 * @param {{
 *   selectedModel?: string,
 *   thinking?: 'on'|'off',
 *   thinkingAvailable?: boolean,
 *   duplicateSwitch?: boolean,
 *   menuOpen?: boolean,
 *   triggerClose?: boolean,
 *   menuCloseByState?: boolean,
 * }} [options]
 */
export function createPerplexityModelPageFixture(options = {}) {
  const state = {
    selectedModel: options.selectedModel || 'best',
    thinking: options.thinking || 'off',
    thinkingAvailable: options.thinkingAvailable !== false,
    duplicateSwitch: options.duplicateSwitch === true,
    menuOpen: options.menuOpen === true,
    triggerClose: options.triggerClose !== false,
    menuCloseByState: options.menuCloseByState === true,
    menuState: options.menuOpen === true ? 'open' : 'closed',
    generation: 1,
  };
  /** @type {string[]} */
  const actions = [];

  const assertFresh = (generation) => {
    if (generation !== state.generation) {
      throw new Error(`stale Perplexity locator generation ${generation}; current ${state.generation}`);
    }
  };

  const empty = (generation = state.generation) => ({
    count: async () => { assertFresh(generation); return 0; },
    nth: () => empty(generation),
    first: () => empty(generation),
    isVisible: async () => false,
  });

  const triggerLocator = () => ({
    count: async () => 1,
    nth: () => triggerLocator(),
    first: () => triggerLocator(),
    isVisible: async () => true,
    getAttribute: async (name) => name === 'aria-label'
      ? (state.selectedModel === 'best' ? 'Model' : LABELS[state.selectedModel])
      : null,
    innerText: async () => state.selectedModel === 'best' ? 'Model' : LABELS[state.selectedModel],
    click: async () => {
      actions.push(`trigger:${state.selectedModel === 'best' ? 'Model' : LABELS[state.selectedModel]}`);
      if (state.menuOpen && !state.triggerClose) return;
      state.menuOpen = !state.menuOpen;
      state.menuState = state.menuOpen ? 'open' : 'closed';
      state.generation += 1;
    },
  });

  const switchLocator = (generation, index) => ({
    count: async () => { assertFresh(generation); return state.duplicateSwitch ? 2 : 1; },
    nth: (nextIndex) => switchLocator(generation, nextIndex),
    first: () => switchLocator(generation, 0),
    isVisible: async () => { assertFresh(generation); return true; },
    getAttribute: async (name) => {
      assertFresh(generation);
      if (name === 'disabled' || name === 'aria-disabled') return null;
      if (name === 'aria-checked') return index === 0 ? String(state.thinking === 'on') : 'false';
      if (name === 'data-state') return (index === 0 ? state.thinking === 'on' : false) ? 'checked' : 'unchecked';
      return null;
    },
    evaluate: async () => { assertFresh(generation); return false; },
    click: async () => {
      assertFresh(generation);
      if (index !== 0) throw new Error('unexpected duplicate switch click');
      state.thinking = state.thinking === 'on' ? 'off' : 'on';
      actions.push(`thinking:${state.thinking}`);
      state.generation += 1;
    },
  });

  const siblingLocator = (generation, alias) => ({
    count: async () => {
      assertFresh(generation);
      return alias === 'gpt-5.6-terra' && state.thinkingAvailable ? 1 : 0;
    },
    nth: () => siblingLocator(generation, alias),
    first: () => siblingLocator(generation, alias),
    isVisible: async () => {
      assertFresh(generation);
      return alias === 'gpt-5.6-terra' && state.thinkingAvailable;
    },
    getAttribute: async (name) => {
      assertFresh(generation);
      return name === 'role' ? 'menuitemcheckbox' : null;
    },
    innerText: async () => { assertFresh(generation); return 'Thinking'; },
    locator: (selector) => selector === ':scope > button[role="switch"]'
      ? switchLocator(generation, 0)
      : empty(generation),
  });

  const lockCollection = (generation, locked) => ({
    count: async () => { assertFresh(generation); return locked ? 1 : 0; },
    nth: () => lockCollection(generation, locked),
    first: () => lockCollection(generation, locked),
    isVisible: async () => { assertFresh(generation); return locked; },
  });

  const rowLocator = (generation, alias, locked) => ({
    count: async () => { assertFresh(generation); return 1; },
    nth: () => rowLocator(generation, alias, locked),
    first: () => rowLocator(generation, alias, locked),
    isVisible: async () => { assertFresh(generation); return true; },
    innerText: async () => { assertFresh(generation); return LABELS[alias]; },
    getAttribute: async (name) => {
      assertFresh(generation);
      if (name === 'disabled' || name === 'aria-disabled') return null;
      if (name === 'aria-checked') return locked ? null : String(state.selectedModel === alias);
      if (name === 'data-state') return locked ? null : (state.selectedModel === alias ? 'checked' : 'unchecked');
      return null;
    },
    evaluate: async () => { assertFresh(generation); return false; },
    locator: (selector) => {
      assertFresh(generation);
      if (selector === 'xpath=following-sibling::*[1]') return siblingLocator(generation, alias);
      if (selector.includes('pplx-icon-lock')) return lockCollection(generation, locked);
      return empty(generation);
    },
    click: async () => {
      assertFresh(generation);
      if (locked) throw new Error('locked row clicked');
      state.selectedModel = alias;
      actions.push(`model:${alias}`);
      state.menuOpen = false;
      state.generation += 1;
    },
  });

  const rowCollection = (generation, aliases, locked) => ({
    count: async () => { assertFresh(generation); return aliases.length; },
    nth: (index) => rowLocator(generation, aliases[index], locked),
    first: () => rowLocator(generation, aliases[0], locked),
    isVisible: async () => { assertFresh(generation); return aliases.length > 0; },
  });

  const menuLocator = (generation) => ({
    count: async () => { assertFresh(generation); return state.menuOpen ? 1 : 0; },
    nth: () => menuLocator(generation),
    first: () => menuLocator(generation),
    isVisible: async () => { assertFresh(generation); return state.menuOpen; },
    getAttribute: async (name) => {
      assertFresh(generation);
      return name === 'data-state' ? state.menuState : null;
    },
    locator: (selector) => {
      assertFresh(generation);
      if (selector === '[role="menuitemradio"]') return rowCollection(generation, SELECTABLE, false);
      if (selector === '[role="menuitem"]') return rowCollection(generation, LOCKED, true);
      return empty(generation);
    },
  });

  const menuCollection = (stateFilter = null) => ({
    count: async () => state.menuOpen && (!stateFilter || state.menuState === stateFilter) ? 1 : 0,
    nth: () => menuLocator(state.generation),
    first: () => menuLocator(state.generation),
    isVisible: async () => state.menuOpen && (!stateFilter || state.menuState === stateFilter),
  });

  const page = {
    locator: (selector) => selector === '[role="menu"]'
      ? menuCollection()
      : selector === '[role="menu"][data-state="open"]' ? menuCollection('open')
        : selector === '[role="menu"][data-state="closed"]' ? menuCollection('closed') : empty(),
    getByRole: (role) => role === 'button' ? triggerLocator() : empty(),
    keyboard: {
      press: async (key) => {
        if (key !== 'Escape') throw new Error(`unsupported key ${key}`);
        if (state.menuOpen) {
          state.menuState = 'closed';
          if (!state.menuCloseByState) state.menuOpen = false;
          state.generation += 1;
          actions.push('keyboard:Escape');
        }
      },
    },
    waitForTimeout: async () => undefined,
  };

  return { page, actions, state };
}
