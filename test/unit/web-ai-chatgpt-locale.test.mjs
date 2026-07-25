import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CHATGPT_MODEL_OPTIONS,
    CHATGPT_MODEL_TEXT_BUTTON_PATTERN,
    CHATGPT_MODEL_TEXT_PATTERNS,
    __localeConsumersForTest as consumers,
} from '../../web-ai/chatgpt-model.mjs';

/**
 * The literals as they stood BEFORE the canonical-table refactor. Every en/ko
 * verdict must be identical afterwards; only zh terms may be newly accepted.
 */
const OLD_BUTTON_PATTERN = /^(?:ChatGPT|Instant(?:\s+5\.5)?|Medium|High|Extra High|Pro|Standard Pro|Extended Pro|GPT[-\s]?\d(?:\.\d+)?(?:\s+(?:Instant|Fast|Thinking|Pro)(?:\s+(?:Light|Standard|Extended|Heavy))?)?|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)$/i;
const OLD_MODEL_TEXT = {
    instant: (text) => /\b(Instant|Fast)\b|즉시/i.test(text),
    thinking: (text) => /\b(Thinking|Think)\b|중간|높음|매우 높음/i.test(text),
    pro: (text) => /\b(Pro|Heavy)\b|Pro 확장|프로 확장/i.test(text),
};

const matchesModelText = (text, choice) =>
    new RegExp(CHATGPT_MODEL_TEXT_PATTERNS[choice], 'iu').test(text);

// Every en/ko token the old implementation could see, plus adversarial negatives.
const EN_KO_CORPUS = [
    'ChatGPT', 'Instant', 'Instant 5.5', 'Fast', 'Medium', 'High', 'Extra High',
    'Pro', 'Heavy', 'Standard Pro', 'Extended Pro', 'Pro Standard', 'Pro Extended',
    'Thinking', 'Think', 'GPT-5.5 Thinking', 'GPT 5 Pro Heavy',
    '즉시', '중간', '높음', '매우 높음', 'Pro 확장', '프로 확장',
    'Fastball', 'Prologue', 'Thinkingness', 'thinking', 'heavy', 'Mediumish',
    'Unrelated', '', ' ',
];

describe('zh locale via the canonical label table (G25)', () => {
    it('preserves every en/ko verdict for the text-button pattern', () => {
        const diffs = EN_KO_CORPUS.filter(text =>
            OLD_BUTTON_PATTERN.test(text) !== CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text));
        expect(diffs).toEqual([]);
    });

    it('preserves every en/ko verdict for per-choice model text matching', () => {
        const diffs = [];
        for (const text of EN_KO_CORPUS) {
            for (const choice of ['instant', 'thinking', 'pro']) {
                if (OLD_MODEL_TEXT[choice](text) !== matchesModelText(text, choice)) {
                    diffs.push(`${choice}:${JSON.stringify(text)}`);
                }
            }
        }
        expect(diffs).toEqual([]);
    });

    it.each([
        ['即时', 'instant'],
        ['中等', 'thinking'],
        ['高', 'thinking'],
        ['极高', 'thinking'],
        ['思考', 'thinking'],
        ['Pro 扩展', 'pro'],
    ])('newly accepts the zh label %s for %s', (label, choice) => {
        expect(matchesModelText(label, choice)).toBe(true);
    });

    it.each([
        ['GPT-5.5即时', 'instant'],
        ['GPT-5极高', 'thinking'],
        ['GPT-5Pro 扩展', 'pro'],
    ])('matches %s where CJK adjoins ASCII with no space', (text, choice) => {
        expect(matchesModelText(text, choice)).toBe(true);
    });

    it('does not let a Han-adjacent lookalike match', () => {
        // 高 is a substring of 极高 and 超高; the Han boundary must reject both.
        expect(matchesModelText('超高', 'thinking')).toBe(false);
        expect(matchesModelText('高中', 'thinking')).toBe(false);
    });

    it('keeps Medium out of the thinking matcher, as before', () => {
        // Adding English effort labels here would be an unrelated behavior
        // expansion smuggled into a locale row.
        expect(matchesModelText('Medium', 'thinking')).toBe(false);
        expect(OLD_MODEL_TEXT.thinking('Medium')).toBe(false);
    });

    it('carries zh labels into the model option tables', () => {
        expect(CHATGPT_MODEL_OPTIONS.instant.labels).toContain('即时');
        expect(CHATGPT_MODEL_OPTIONS.thinking.labels).toEqual(expect.arrayContaining(['中等', '高', '极高', '思考']));
        expect(CHATGPT_MODEL_OPTIONS.pro.labels).toContain('Pro 扩展');
        // Existing entries survive.
        expect(CHATGPT_MODEL_OPTIONS.pro.labels).toEqual(expect.arrayContaining(['Pro Standard', 'Pro Extended', 'Heavy']));
    });

    it('keeps observed pill labels separate from menu-row labels', () => {
        // "Standard Pro" is pill text; "Pro Standard" is a menu row. Flattening
        // them into one set lost both in an earlier draft.
        expect(CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test('Standard Pro')).toBe(true);
        expect(CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test('Extended Pro')).toBe(true);
    });

    it('never matches selection-only aliases as standalone button text', () => {
        expect(CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test('Fast')).toBe(false);
        expect(CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test('Heavy')).toBe(false);
    });

    it('transports the locale patterns as an evaluate argument', () => {
        // Serialization rule: matchesModelText runs inside page.evaluate, so the
        // patterns must travel as data, never as a closed-over module constant.
        const src = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-model.mjs'), 'utf8');
        expect(src).toContain('localePatterns: CHATGPT_MODEL_TEXT_PATTERNS');
        expect(src).toContain('triggerSelectors, localePatterns }');
        expect(src).toContain('(localePatterns)[choice]');
    });

    it('derives every consumer from the canonical table', () => {
        const src = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-model.mjs'), 'utf8');
        // No consumer may keep its own hardcoded locale list.
        expect(src).not.toMatch(/menuTextHasAnyExactLine\(text, \['Instant', '즉시'\]\)/);
        expect(src).not.toMatch(/\['Medium', 'High', 'Extra High', '중간', '높음', '매우 높음'\]/);
        expect(src).not.toMatch(/\['Instant', 'Medium', 'High', 'Extra High', 'Pro', '즉시'/);
    });
});

/**
 * `modelChoiceFromText` also consults a legacy combined-row fallback, so an
 * exact-line model alone cannot reproduce it. The equivalence check below
 * therefore pins the LOCALE-SENSITIVE half: every en/ko token must keep the
 * verdict it had before the refactor, captured here as literals.
 */
const OLD_CHOICE_VERDICTS = {
    'Instant': 'instant', '즉시': 'instant',
    // 'Fast' is a selection alias, never an exact menu row: null then and now.
    'Fast': null,
    'Medium': 'thinking', 'High': 'thinking', 'Extra High': 'thinking',
    '중간': 'thinking', '높음': 'thinking', '매우 높음': 'thinking',
    'Thinking': 'thinking', 'Think': 'thinking', 'GPT-5.5 Thinking': 'thinking',
    'Pro': 'pro', 'Pro 확장': 'pro', '프로 확장': 'pro', 'Heavy': 'pro',
    'Standard Pro': 'pro', 'Extended Pro': 'pro',
    'Pro Standard': 'pro', 'Pro Extended': 'pro',
    'Unrelated': null, 'Fastball': null, 'Prologue': null, '': null,
};

const OLD_PILL_EXACT = ['Instant', 'Medium', 'High', 'Extra High', 'Pro'];
const OLD_MENU_OPEN = ['Instant', 'Medium', 'High', 'Extra High', 'Pro', '즉시', '중간', '높음', '매우 높음'];

describe('zh locale consumer equivalence and coverage (G25, audit round 1)', () => {
    // A wider corpus than the first draft: every label token, combined rows, and
    // adversarial lookalikes.
    const CORPUS = [
        ...EN_KO_CORPUS,
        'Pro Standard', 'Pro Extended', 'Thinking\nPro Standard', 'Instant\nPro',
        'Medium\nHigh', '중간\n높음', 'Pro\nHeavy', 'GPT-5.5 Thinking\nMedium',
    ];

    it('preserves en/ko verdicts for modelChoiceFromText', () => {
        const diffs = Object.entries(OLD_CHOICE_VERDICTS)
            .filter(([text, expected]) => consumers.choiceFromText(text) !== expected)
            .map(([text]) => text);
        expect(diffs).toEqual([]);
    });

    it('keeps combined menu rows out of pill recognition', () => {
        // The regression the audit caught: row labels must not become pill text.
        expect(consumers.pillText('Pro Standard')).toBe(false);
        expect(consumers.pillText('Pro Extended')).toBe(false);
        for (const label of OLD_PILL_EXACT) expect(consumers.pillText(label)).toBe(true);
    });

    it('keeps combined menu rows out of menu-open detection', () => {
        const labels = consumers.menuOpenLabels();
        expect(labels).not.toContain('Pro Standard');
        expect(labels).not.toContain('Pro Extended');
        for (const label of OLD_MENU_OPEN) expect(labels).toContain(label);
    });

    it.each([
        ['思考', 'choiceFromText', () => consumers.choiceFromText('思考')],
        ['思考', 'pillText', () => consumers.pillText('思考')],
        ['思考', 'menuOpenLabels', () => consumers.menuOpenLabels().includes('思考')],
    ])('recognizes %s in %s', (_label, _consumer, run) => {
        expect(run()).toBeTruthy();
    });

    it.each([
        ['instant', 'GPT-5.5即时'],
        ['thinking', 'GPT-5.5思考'],
        ['thinking', 'GPT-5极高'],
        ['pro', 'GPT-5Pro 扩展'],
    ])('resolves %s from the legacy combined row %s', (choice, text) => {
        expect(consumers.legacyLabel(choice, text)).toBe(true);
    });

    it('keeps the legacy combined-row ASCII behavior', () => {
        expect(consumers.legacyLabel('instant', 'GPT-5.5 Instant')).toBe(true);
        expect(consumers.legacyLabel('thinking', 'GPT-5.5 Thinking')).toBe(true);
        expect(consumers.legacyLabel('pro', 'GPT-5 Pro Heavy')).toBe(true);
        expect(consumers.legacyLabel('instant', 'Fastball')).toBe(false);
        expect(consumers.legacyLabel('thinking', '超高')).toBe(false);
    });
});

describe('per-consumer projections keep their own history (G25, audit round 2)', () => {
    // One shared projection could not preserve three different predicates: adding
    // English `Thinking` to the pill/menu sets changed 446 verdicts. Each list is
    // now its own old literal plus only the locale variants of those terms.
    it('keeps English Thinking out of pill and menu-open evidence', () => {
        expect(consumers.pillText('Thinking')).toBe(false);
        expect(consumers.menuOpenLabels()).not.toContain('Thinking');
    });

    it('keeps the multiline Thinking + Pro verdict as pro', () => {
        expect(consumers.choiceFromText('Thinking\nPro')).toBe('pro');
    });

    it('still admits 思考 in all three consumers', () => {
        expect(consumers.choiceFromText('思考')).toBe('thinking');
        expect(consumers.pillText('思考')).toBe(true);
        expect(consumers.menuOpenLabels()).toContain('思考');
    });

    it('preserves the old pill and menu-open members exactly', () => {
        for (const label of ['Instant', 'Medium', 'High', 'Extra High', 'Pro']) {
            expect(consumers.pillText(label)).toBe(true);
        }
        for (const label of ['Instant', 'Medium', 'High', 'Extra High', 'Pro', '즉시', '중간', '높음', '매우 높음']) {
            expect(consumers.menuOpenLabels()).toContain(label);
        }
        for (const label of ['Pro Standard', 'Pro Extended', 'Thinking']) {
            expect(consumers.menuOpenLabels()).not.toContain(label);
        }
    });

    it('shares one helper between production menu-open detection and the adapter', () => {
        const src = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-model.mjs'), 'utf8');
        expect(src).toContain('function simplifiedMenuOpenLabels()');
        expect(src).toContain(': simplifiedMenuOpenLabels();');
        expect(src).toContain('menuOpenLabels: () => simplifiedMenuOpenLabels()');
    });
});

describe('pill projection keeps its English-only exact vocabulary (G25, audit round 3)', () => {
    // Promoting Korean labels to exact LINES newly accepted multiline text such
    // as "ChatGPT\n즉시"; Korean standalone pills stay on the button pattern.
    it.each([
        'ChatGPT\n즉시',
        'ChatGPT\n중간',
        'Fast\n높음',
        'Unrelated\n매우 높음',
    ])('does not treat %s as pill text', (text) => {
        expect(consumers.pillText(text)).toBe(false);
    });

    it('still recognizes Korean standalone pills', () => {
        for (const label of ['즉시', '중간', '높음', '매우 높음', 'Pro 확장', '프로 확장']) {
            expect(consumers.pillText(label)).toBe(true);
        }
    });

    it('recognizes the zh additions as exact pill lines', () => {
        for (const label of ['即时', '中等', '高', '极高', '思考', 'Pro 扩展']) {
            expect(consumers.pillText(label)).toBe(true);
        }
    });

    it('keeps the English exact vocabulary', () => {
        for (const label of ['Instant', 'Medium', 'High', 'Extra High', 'Pro']) {
            expect(consumers.pillText(label)).toBe(true);
        }
    });
});
