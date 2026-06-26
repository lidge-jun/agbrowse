import { describe, expect, it } from 'vitest';
import { selectProfile } from '../../skills/browser/adaptive-fetch/tls-fetch.mjs';
import { dnsRebindingGuard, validateFetchUrl, isPrivateIpv4 } from '../../skills/browser/adaptive-fetch/safety.mjs';

describe('R3+R4: TLS fetch redirect security', () => {
    it('selectProfile is deterministic for the same hostname', () => {
        const p1 = selectProfile('https://example.com/a');
        const p2 = selectProfile('https://example.com/b');
        expect(p1).toBe(p2);
    });

    it('selectProfile returns a valid profile', () => {
        const valid = ['chrome131', 'safari18_0', 'firefox133'];
        expect(valid).toContain(selectProfile('https://test.com'));
    });

    it('dnsRebindingGuard returns resolved IPs for public hostnames', async () => {
        const ips = await dnsRebindingGuard('example.com');
        expect(Array.isArray(ips)).toBe(true);
        expect(ips.length).toBeGreaterThan(0);
    });

    it('dnsRebindingGuard returns [ip] for raw IP addresses', async () => {
        const ips = await dnsRebindingGuard('93.184.216.34');
        expect(ips).toEqual(['93.184.216.34']);
    });

    it('dnsRebindingGuard rejects localhost', async () => {
        await expect(dnsRebindingGuard('localhost')).rejects.toThrow(/private or local/);
    });

    it('dnsRebindingGuard rejects .local domains', async () => {
        await expect(dnsRebindingGuard('printer.local')).rejects.toThrow(/private or local/);
    });

    it('validateFetchUrl rejects private network IPs', () => {
        expect(() => validateFetchUrl('http://169.254.169.254/')).toThrow(/private/);
        expect(() => validateFetchUrl('http://10.0.0.1/')).toThrow(/private/);
        expect(() => validateFetchUrl('http://192.168.1.1/')).toThrow(/private/);
        expect(() => validateFetchUrl('http://127.0.0.1/')).toThrow(/private/);
    });

    it('validateFetchUrl rejects non-http schemes', () => {
        expect(() => validateFetchUrl('ftp://example.com')).toThrow(/unsupported/);
        expect(() => validateFetchUrl('file:///etc/passwd')).toThrow(/unsupported/);
    });

    it('validateFetchUrl accepts public URLs', () => {
        const url = validateFetchUrl('https://example.com/path');
        expect(url.href).toBe('https://example.com/path');
    });
});
