import { describe, expect, it } from 'vitest';
import { validateFetchUrl, dnsRebindingGuard } from '../../skills/browser/adaptive-fetch/safety.mjs';
import { classifyBoundarySignals, classifyHtmlStrength } from '../../skills/browser/adaptive-fetch/validators.mjs';

describe('adaptive fetch validators', () => {
    it('rejects unsupported schemes and private URLs before network work', () => {
        expect(() => validateFetchUrl('file:///tmp/a.txt')).toThrow(/unsupported URL scheme/);
        expect(() => validateFetchUrl('https://localhost/private')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('https://127.0.0.1/private')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[::ffff:127.0.0.1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[::ffff:8.8.8.8]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[::ffff:192.168.1.1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[64:ff9b:1::1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[100:0:0:1::1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[2001:2::1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[2001:db8::1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[2620:4f:8000::1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[fec0::1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('http://[5f00::1]/')).toThrow(/private or local host/);
        expect(() => validateFetchUrl('https://user:pass@example.com/')).toThrow(/credential-bearing/);
    });

    it('treats challenge-like tiny HTML as a challenge, not success', () => {
        const result = classifyHtmlStrength({
            html: '<html><title>Checking your browser</title><body>Verify you are human</body></html>',
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('challenge');
    });

    it('returns strong_ok when positive proof and enough readable text exist', () => {
        const result = classifyHtmlStrength({
            text: 'Article '.repeat(40),
            positiveProof: ['article-body'],
        });
        expect(result.ok).toBe(true);
        expect(result.verdict).toBe('strong_ok');
    });

    it('classifies status and marker boundaries without pretending they are final browser actions', () => {
        expect(classifyBoundarySignals({ status: 401 }).verdict).toBe('auth_required');
        expect(classifyBoundarySignals({ status: 402 }).verdict).toBe('paywall');
        expect(classifyBoundarySignals({ status: 403, text: 'captcha required' }).verdict).toBe('challenge');
    });

    it('dnsRebindingGuard passes for public IPs', async () => {
        const ips = await dnsRebindingGuard('8.8.8.8');
        expect(ips).toEqual(['8.8.8.8']);
    });

    it('dnsRebindingGuard rejects localhost hostnames', async () => {
        await expect(dnsRebindingGuard('localhost')).rejects.toThrow(/private or local host/);
        await expect(dnsRebindingGuard('evil.localhost')).rejects.toThrow(/private or local host/);
    });

    it('dnsRebindingGuard rejects .local hostnames', async () => {
        await expect(dnsRebindingGuard('printer.local')).rejects.toThrow(/private or local host/);
    });
});
