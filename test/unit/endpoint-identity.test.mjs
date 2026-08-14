// @ts-check
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Override BROWSER_AGENT_HOME before importing the module
const testHome = mkdtempSync(join(tmpdir(), 'agb-identity-test-'));
process.env.BROWSER_AGENT_HOME = testHome;

const {
    readEndpointIdentity,
    writeEndpointIdentity,
    recordManagedLaunch,
    recordExternalConnect,
    isOwnedEndpoint,
    registerOwnedTab,
    isOwnedTab,
    unregisterOwnedTab,
    clearEndpointIdentity,
} = await import('../../skills/browser/endpoint-identity.mjs');

afterEach(() => {
    clearEndpointIdentity();
});

describe('endpoint-identity', () => {
    it('returns null when no identity exists', () => {
        expect(readEndpointIdentity()).toBeNull();
    });

    it('records a managed launch', () => {
        const id = recordManagedLaunch({ port: 9222, pid: 12345, profileDir: '/tmp/profile' });
        expect(id.mode).toBe('managed');
        expect(id.owned).toBe(true);
        expect(id.pid).toBe(12345);
        expect(readEndpointIdentity()).toEqual(id);
    });

    it('records an external connect', () => {
        const id = recordExternalConnect({ endpoint: 'http://127.0.0.1:9333', port: 9333 });
        expect(id.mode).toBe('external');
        expect(id.owned).toBe(false);
        expect(id.pid).toBeNull();
    });

    it('isOwnedEndpoint reflects mode', () => {
        recordExternalConnect({ endpoint: 'http://127.0.0.1:9222', port: 9222 });
        expect(isOwnedEndpoint()).toBe(false);
        recordManagedLaunch({ port: 9222, pid: 1, profileDir: '/tmp' });
        expect(isOwnedEndpoint()).toBe(true);
    });

    it('tracks tab ownership in external mode', () => {
        recordExternalConnect({ endpoint: 'http://127.0.0.1:9222', port: 9222 });
        expect(isOwnedTab('tab-1')).toBe(false);
        registerOwnedTab('tab-1');
        expect(isOwnedTab('tab-1')).toBe(true);
        expect(isOwnedTab('tab-2')).toBe(false);
        unregisterOwnedTab('tab-1');
        expect(isOwnedTab('tab-1')).toBe(false);
    });

    it('all tabs are owned in managed mode', () => {
        recordManagedLaunch({ port: 9222, pid: 1, profileDir: '/tmp' });
        expect(isOwnedTab('any-tab')).toBe(true);
    });

    it('clearEndpointIdentity removes the file', () => {
        recordManagedLaunch({ port: 9222, pid: 1, profileDir: '/tmp' });
        expect(readEndpointIdentity()).not.toBeNull();
        clearEndpointIdentity();
        expect(readEndpointIdentity()).toBeNull();
    });
});
