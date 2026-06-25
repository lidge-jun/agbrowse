import { describe, expect, it } from 'vitest';
import { selectProfile, tlsFetch, tlsFetchCandidate } from '../../skills/browser/adaptive-fetch/tls-fetch.mjs';

// Parity catalog 203.1 (P1): TLS-impersonation rung. The curl-impersonate spawn path is
// environment-dependent (and SSRF-guarded), so the unit surface is the pure profile
// selection + the export contract; the no-op-without-binary fallback is verified by the
// faithful mirror of cli-jaw tls-fetch.ts and the ladder's guarded call site.
describe('adaptive fetch TLS impersonation', () => {
    const PROFILES = new Set(['chrome131', 'safari18_0', 'firefox133']);

    it('selectProfile is deterministic per host and within the known profile set', () => {
        const a = selectProfile('https://example.com/a');
        const b = selectProfile('https://example.com/b?x=1');
        expect(a).toBe(b); // same host → same profile regardless of path/query
        expect(PROFILES.has(a)).toBe(true);
        expect(PROFILES.has(selectProfile('https://news.ycombinator.com/'))).toBe(true);
    });

    it('selectProfile distributes across more than one profile over many hosts', () => {
        const seen = new Set();
        for (let i = 0; i < 50; i++) seen.add(selectProfile(`https://host-${i}.example.com/`));
        expect(seen.size).toBeGreaterThan(1);
        for (const p of seen) expect(PROFILES.has(p)).toBe(true);
    });

    it('exposes the ladder-facing fetch entry points', () => {
        expect(typeof tlsFetch).toBe('function');
        expect(typeof tlsFetchCandidate).toBe('function');
    });
});
