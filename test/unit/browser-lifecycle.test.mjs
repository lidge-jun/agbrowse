// @ts-check
import { describe, it, expect } from 'vitest';
import { readPersistedState, writePersistedState, isPortListening, getBrowserStatus } from '../../skills/browser/browser-lifecycle.mjs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = mkdtempSync(join(tmpdir(), 'agb-lifecycle-test-'));
process.env.BROWSER_AGENT_HOME = testHome;

describe('browser-lifecycle (H-011)', () => {
    it('readPersistedState returns an object or null', () => {
        const state = readPersistedState();
        expect(state === null || typeof state === 'object').toBe(true);
    });

    it('writePersistedState + readPersistedState round-trip', () => {
        writePersistedState({ port: 9222, pid: 123 });
        const state = readPersistedState();
        expect(state).toEqual({ port: 9222, pid: 123 });
    });

    it('isPortListening returns false for unused port', async () => {
        const result = await isPortListening(59999);
        expect(result).toBe(false);
    });

    it('getBrowserStatus returns not-running for unused port', async () => {
        const status = await getBrowserStatus(59999);
        expect(status.running).toBe(false);
        expect(status.tabs).toBe(0);
    });

    it('exports endpoint identity functions', async () => {
        const mod = await import('../../skills/browser/browser-lifecycle.mjs');
        expect(typeof mod.isOwnedEndpoint).toBe('function');
        expect(typeof mod.readEndpointIdentity).toBe('function');
        expect(typeof mod.recordManagedLaunch).toBe('function');
        expect(typeof mod.recordExternalConnect).toBe('function');
    });
});
