import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BROWSER_TOOLS,
    FROZEN_BROWSER_TOOL_NAMES,
    NOT_IMPLEMENTED_BROWSER_TOOLS,
    isKnownBrowserTool,
    isNotImplementedBrowserTool,
    validateBrowserToolInput,
} from '../../web-ai/browser-tool-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

describe('phase22 MCP browser tool freeze', () => {
    it('only registers the two frozen browser tools', () => {
        expect([...FROZEN_BROWSER_TOOL_NAMES]).toEqual(['browser_snapshot', 'browser_click_ref']);
        expect(Object.keys(BROWSER_TOOLS)).toEqual(['browser_snapshot', 'browser_click_ref']);
    });

    it('tracks the eight planned-but-not-implemented browser tools', () => {
        const expected = [
            'browser_type_ref',
            'browser_navigate',
            'browser_back',
            'browser_forward',
            'browser_reload',
            'browser_wait_for',
            'browser_screenshot',
            'browser_extract_text',
        ];
        expect(Object.keys(NOT_IMPLEMENTED_BROWSER_TOOLS).sort()).toEqual([...expected].sort());
        for (const name of expected) {
            expect(isNotImplementedBrowserTool(name)).toBe(true);
            expect(isKnownBrowserTool(name)).toBe(false);
        }
    });

    it('validates browser_snapshot input strictly', () => {
        expect(validateBrowserToolInput('browser_snapshot', {})).toBe(true);
        expect(validateBrowserToolInput('browser_snapshot', { compact: false })).toBe(true);
        expect(() => validateBrowserToolInput('browser_snapshot', { compact: 'yes' }))
            .toThrowError(/must be boolean/);
        expect(() => validateBrowserToolInput('browser_snapshot', { unknownProp: 1 }))
            .toThrowError(/unknown property/);
        expect(() => validateBrowserToolInput('browser_snapshot', { maxDepth: 99 }))
            .toThrowError(/above maximum/);
    });

    it('validates browser_click_ref input strictly', () => {
        expect(validateBrowserToolInput('browser_click_ref', {
            snapshotId: 'snap-1',
            ref: '@e3',
        })).toBe(true);
        expect(() => validateBrowserToolInput('browser_click_ref', { snapshotId: 'snap-1' }))
            .toThrowError(/ref is required/);
        expect(() => validateBrowserToolInput('browser_click_ref', {
            snapshotId: 'snap-1',
            ref: 'e3',
        })).toThrowError(/does not match pattern/);
        expect(() => validateBrowserToolInput('browser_click_ref', {
            snapshotId: 'snap-1',
            ref: '@e3',
            button: 'wheel',
        })).toThrowError(/not in enum/);
        expect(() => validateBrowserToolInput('browser_click_ref', {
            snapshotId: 'snap-1',
            ref: '@e3',
            policy: { allowedOrigins: 'nope' },
        })).toThrowError(/must be array/);
    });

    it('refuses planned-but-not-implemented tools at validate time', () => {
        for (const name of Object.keys(NOT_IMPLEMENTED_BROWSER_TOOLS)) {
            expect(() => validateBrowserToolInput(name, {})).toThrowError(/not implemented/);
        }
        expect(() => validateBrowserToolInput('browser_unknown', {}))
            .toThrowError(/unknown browser MCP tool/);
    });

    it('keeps the truth table in sync with the frozen tool list', async () => {
        const truthTablePath = path.join(repoRoot, 'structure', 'CAPABILITY_TRUTH_TABLE.md');
        const text = await fs.readFile(truthTablePath, 'utf8');
        for (const name of FROZEN_BROWSER_TOOL_NAMES) {
            expect(text, `truth table must mention frozen tool ${name}`).toContain(name);
        }
        for (const name of Object.keys(NOT_IMPLEMENTED_BROWSER_TOOLS)) {
            expect(text, `truth table must mention not-implemented tool ${name}`).toContain(name);
        }
    });
});
