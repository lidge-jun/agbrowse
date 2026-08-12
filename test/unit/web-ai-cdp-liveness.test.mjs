import { describe, expect, it, vi } from 'vitest';
import { isRecoverableCdpDisconnect, probeCdpLiveness } from '../../web-ai/cdp-liveness.mjs';

const response = (body, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    json: async () => body,
});

describe('web-ai CDP liveness', () => {
    it('reports recoverable when version responds and saved target is listed', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({ Browser: 'Chrome' }))
            .mockResolvedValueOnce(response([{ id: 'target-1', url: 'https://chatgpt.com/c/1' }]));
        const result = await probeCdpLiveness({ port: 9222, targetId: 'target-1', fetchImpl });
        expect(result).toEqual({ endpointReachable: true, targetFound: true, matchedUrl: 'https://chatgpt.com/c/1' });
        expect(isRecoverableCdpDisconnect(result)).toBe(true);
    });

    it.each([
        ['rejects', () => Promise.reject(new Error('ECONNREFUSED'))],
        ['times out', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ])('reports endpoint dead when /json/version %s', async (_label, firstCall) => {
        const result = await probeCdpLiveness({ port: 9222, targetId: 'target-1', fetchImpl: vi.fn(firstCall) });
        expect(result).toMatchObject({ endpointReachable: false, targetFound: null });
    });

    it('reports target missing when /json/list omits saved targetId', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(response({})).mockResolvedValueOnce(response([{ id: 'other' }]));
        await expect(probeCdpLiveness({ port: 9222, targetId: 'target-1', fetchImpl }))
            .resolves.toEqual({ endpointReachable: true, targetFound: false });
    });

    it.each([
        ['throws', () => Promise.reject(new Error('list failed'))],
        ['is non-OK', () => Promise.resolve(response({}, { ok: false, status: 500 }))],
        ['is malformed', () => Promise.resolve(response({ targets: [] }))],
    ])('fails closed when /json/list %s', async (_label, secondCall) => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(response({})).mockImplementationOnce(secondCall);
        const result = await probeCdpLiveness({ port: 9222, targetId: 'target-1', fetchImpl });
        expect(result).toMatchObject({ endpointReachable: true, targetFound: null });
        expect(isRecoverableCdpDisconnect(result)).toBe(false);
    });

    it('fails closed without targetId', async () => {
        const fetchImpl = vi.fn();
        await expect(probeCdpLiveness({ port: 9222, targetId: '', fetchImpl }))
            .resolves.toEqual({ endpointReachable: false, targetFound: null, error: 'missing target id' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
