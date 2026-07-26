import { describe, expect, it } from 'vitest';
import { appendAttempt, createAttemptTrace, summarizeAttempts } from '../../skills/browser/adaptive-fetch/trace.mjs';

describe('adaptive fetch trace', () => {
    it('redacts sensitive URL and header material in attempts', () => {
        const trace = createAttemptTrace({
            url: 'https://example.com/?token=secret&client_secret=hidden',
            browserMode: 'auto',
            browserSession: 'none',
        });
        appendAttempt(trace, {
            source: 'fetch',
            verdict: 'blocked',
            url: 'https://example.com/?api_key=abc&X-Amz-Signature=sig&AWSAccessKeyId=key',
            requestHeaders: {
                authorization: 'Bearer abc',
                accept: 'text/html',
            },
        });
        expect(trace.url).toContain('token=[redacted]');
        expect(trace.url).toContain('client_secret=[redacted]');
        expect(trace.attempts[0].url).toContain('api_key=[redacted]');
        expect(trace.attempts[0].url).toContain('X-Amz-Signature=[redacted]');
        expect(trace.attempts[0].url).toContain('AWSAccessKeyId=[redacted]');
        expect(trace.attempts[0].requestHeaders.authorization).toBe('[redacted]');
        expect(trace.attempts[0].requestHeaders.accept).toBe('text/html');
    });

    it('summarizes recorded attempts for human output', () => {
        const trace = createAttemptTrace({ url: 'https://example.com/' });
        appendAttempt(trace, { source: 'validation', verdict: 'unsupported' });
        // Intent: name the lane that produced the outcome. The wording gained
        // "scored" when discovery started recording unfetched URLs; what the
        // test is for is the source, not the phrasing.
        expect(summarizeAttempts(trace.attempts)).toContain('source=validation');
        expect(summarizeAttempts(trace.attempts)).toContain('verdict=unsupported');
    });

    // The ladder returns the best candidate, not the last lane it tried, so the
    // last attempt is a different axis entirely. Summarizing it named a lane
    // that produced nothing: `discovered` for a URL nothing fetched, and
    // `browser_required` for a fetch that returned `weak_ok` from an earlier
    // rung.
    it('names the lane whose candidate was returned, not the last one tried', () => {
        const trace = createAttemptTrace({ url: 'https://example.com/' });
        appendAttempt(trace, { source: 'validation', verdict: 'weak_ok', reason: 'url-valid' });
        appendAttempt(trace, { source: 'fetch', verdict: 'weak_ok', reason: 'score:41' });
        appendAttempt(trace, { source: 'metadata', verdict: 'discovered', reason: 'candidate-discovered:package' });
        const summary = summarizeAttempts(trace.attempts, { source: 'fetch', verdict: 'weak_ok' });
        expect(summary).toContain('3 attempt(s)');
        expect(summary).toContain('selected source=fetch verdict=weak_ok');
        expect(summary).not.toContain('verdict=discovered');
    });

    it('does not name a browser lane that never produced the result', () => {
        const trace = createAttemptTrace({ url: 'https://example.com/' });
        appendAttempt(trace, { source: 'fetch', verdict: 'weak_ok', reason: 'score:41' });
        appendAttempt(trace, { source: 'browser', verdict: 'browser_required', reason: 'no browser' });
        const summary = summarizeAttempts(trace.attempts, { source: 'fetch', verdict: 'weak_ok' });
        expect(summary).toContain('selected source=fetch verdict=weak_ok');
        expect(summary).not.toContain('browser_required');
    });

    it('falls back to the last attempt when the caller reports no outcome', () => {
        const trace = createAttemptTrace({ url: 'https://example.com/' });
        appendAttempt(trace, { source: 'metadata', verdict: 'discovered', reason: 'candidate-discovered:fetch' });
        expect(summarizeAttempts(trace.attempts)).toContain('last source=metadata verdict=discovered');
    });

    it('records identity field in trace', () => {
        const trace = createAttemptTrace({
            url: 'https://example.com/',
            browserMode: 'auto',
            browserSession: 'user',
            identity: 'chrome',
        });
        expect(trace.identity).toBe('chrome');
        expect(trace.browserSession).toBe('user');
    });

    it('defaults identity to auto when not provided', () => {
        const trace = createAttemptTrace({ url: 'https://example.com/' });
        expect(trace.identity).toBe('auto');
    });
});
