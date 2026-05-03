import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDuration, selectTabsForCleanup } from '../../skills/browser/tab-lifecycle.mjs';

describe('tab lifecycle cleanup selection', () => {
    it('parses duration strings used by tab-cleanup UX', () => {
        expect(parseDuration('500ms')).toBe(500);
        expect(parseDuration('2s')).toBe(2000);
        expect(parseDuration('3m')).toBe(180000);
        expect(parseDuration('1h')).toBe(3600000);
        expect(parseDuration('bad')).toBe(1800000);
    });

    it('selects idle tabs but preserves pinned and active-session tabs', () => {
        const now = 1_000_000;
        const selected = selectTabsForCleanup({
            now,
            idleTimeoutMs: 10_000,
            maxTabs: 10,
            tabs: [
                { targetId: 'idle', lastActiveAt: now - 20_000 },
                { targetId: 'active-session', lastActiveAt: now - 20_000 },
                { targetId: 'pinned', lastActiveAt: now - 20_000 },
                { targetId: 'fresh', lastActiveAt: now - 1000 },
            ],
            activeSessionTargetIds: new Set(['active-session']),
            pinnedTargetIds: new Set(['pinned']),
        });

        expect(selected.map(tab => tab.targetId)).toEqual(['idle']);
        expect(selected[0].cleanupReason).toBe('idle-timeout');
    });

    it('enforces max-tabs by closing the oldest closeable tabs', () => {
        const selected = selectTabsForCleanup({
            now: 10_000,
            idleTimeoutMs: 60_000,
            maxTabs: 3,
            tabs: [
                { targetId: 'oldest', lastActiveAt: 100 },
                { targetId: 'active-session', lastActiveAt: 200 },
                { targetId: 'middle', lastActiveAt: 300 },
                { targetId: 'newest', lastActiveAt: 400 },
                { targetId: 'pinned', lastActiveAt: 50 },
            ],
            activeSessionTargetIds: new Set(['active-session']),
            pinnedTargetIds: new Set(['pinned']),
        });

        expect(selected.map(tab => tab.targetId)).toEqual(['oldest', 'middle']);
        expect(selected.every(tab => tab.cleanupReason === 'max-tabs')).toBe(true);
    });

    it('only closes untracked tabs when includeUntracked is explicit', () => {
        const base = {
            now: 10_000,
            idleTimeoutMs: 1000,
            maxTabs: 10,
            tabs: [{ targetId: 'untracked', lastActiveAt: null }],
        };

        expect(selectTabsForCleanup(base)).toEqual([]);
        expect(selectTabsForCleanup({ ...base, includeUntracked: true })).toMatchObject([
            { targetId: 'untracked', cleanupReason: 'untracked' },
        ]);
    });

    it('does not close untracked tabs for max-tabs unless includeUntracked is explicit', () => {
        const base = {
            now: 10_000,
            idleTimeoutMs: 1000,
            maxTabs: 1,
            tabs: [
                { targetId: 'untracked', lastActiveAt: null },
                { targetId: 'tracked', lastActiveAt: 9000 },
            ],
        };

        expect(selectTabsForCleanup(base).map(tab => tab.targetId)).toEqual(['tracked']);
        expect(selectTabsForCleanup({ ...base, includeUntracked: true }).map(tab => tab.targetId)).toEqual(['untracked']);
    });

    it('does not pass Array.map index as tab display timestamp', () => {
        const source = readFileSync(new URL('../../skills/browser/browser.mjs', import.meta.url), 'utf8');
        expect(source).toContain('.map(tab => tabDisplayState(tab))');
        expect(source).not.toContain('.map(tabDisplayState)');
    });
});
