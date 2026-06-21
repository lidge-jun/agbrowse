export function chromiumLaunchOptions() {
    const executablePath = process.env.AGBROWSE_CHROMIUM_EXECUTABLE_PATH;
    return executablePath ? { executablePath } : {};
}
