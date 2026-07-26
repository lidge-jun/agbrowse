export function chromiumLaunchOptions() {
    const executablePath = process.env.AGBROWSE_CHROMIUM_EXECUTABLE_PATH;
    return executablePath ? { executablePath } : {};
}

/**
 * Launch Chromium for a transport test, failing loudly when it cannot start.
 *
 * A bare `chromium.launch()` in `beforeAll` throws, and vitest then counts that
 * file's tests as SKIPPED with zero failures — so a suite whose Chromium is
 * missing reports "168 passed" while 15 tests never run. These files are the
 * page.evaluate transport round-trips; they are the enforcement for the rule
 * that evaluate serializes a function body and not its module bindings, and
 * they were the part going quiet.
 *
 * The error names the override so the fix is obvious from the failure alone.
 *
 * @param {import('playwright-core').BrowserType} chromium
 */
export async function launchTransportChromium(chromium) {
    try {
        return await chromium.launch(chromiumLaunchOptions());
    } catch (cause) {
        throw new Error(
            'transport test could not launch Chromium. playwright-core resolves a build that is '
            + 'not in the local cache; point AGBROWSE_CHROMIUM_EXECUTABLE_PATH at an installed '
            + `Chrome or Chrome for Testing binary and re-run.\n  cause: ${/** @type {any} */ (cause)?.message}`,
            { cause },
        );
    }
}
