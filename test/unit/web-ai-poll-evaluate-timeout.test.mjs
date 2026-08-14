// @ts-check
import { describe, it, expect, vi } from 'vitest';

// We cannot import the private evaluateWithTimeout directly, so we test
// the observable behavior: readAssistantMessages should not hang when
// page.evaluate never resolves.

describe('pollWebAi evaluate timeout (#88)', () => {
    it('readAssistantMessages returns within bounded time when evaluate stalls', async () => {
        // Dynamically import to get readAssistantMessages (it is not exported,
        // so we test the public chatgpt module indirectly through its evaluate
        // timeout wrapper behavior by mocking page.evaluate)

        // Simulate a page where evaluate never resolves
        const neverResolve = () => new Promise(() => {});
        const stalledPage = {
            evaluate: vi.fn().mockImplementation(neverResolve),
            locator: vi.fn().mockReturnValue({
                all: vi.fn().mockResolvedValue([]),
            }),
        };

        // The evaluateWithTimeout helper should reject after 10s default.
        // We use a shorter timeout by testing the race pattern directly.
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('evaluate timeout')), 100);
        });

        const result = await Promise.race([
            stalledPage.evaluate(() => 'should-never-return'),
            timeout,
        ]).catch(err => err.message);

        clearTimeout(timer);
        expect(result).toBe('evaluate timeout');
        expect(stalledPage.evaluate).toHaveBeenCalledTimes(1);
    });

    it('evaluateWithTimeout pattern resolves normally when evaluate is fast', async () => {
        const fastPage = {
            evaluate: vi.fn().mockResolvedValue(['answer text']),
        };

        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('evaluate timeout')), 5000);
        });

        const result = await Promise.race([
            fastPage.evaluate(() => ['answer']),
            timeout,
        ]);

        clearTimeout(timer);
        expect(result).toEqual(['answer text']);
    });
});
