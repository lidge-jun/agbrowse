// @ts-check
export const DEFAULT_WEB_AI_POLICY = Object.freeze({
    version: 1,
    allowedOrigins: [],
    deniedOrigins: [],
    allowDownloads: false,
    allowUploads: 'explicit-only',
    allowClipboardRead: false,
    allowClipboardWrite: 'explicit-only',
    allowEvaluate: false,
    allowFileAccess: false,
    allowCrossOriginNavigation: 'confirm',
    destructiveFormPolicy: 'deny',
    promptInjectionBoundary: 'strict',
});
