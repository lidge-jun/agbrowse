// @ts-check

// Parity catalog 201 #1 (P1): declarative capability registry. agbrowse's capability.mjs
// is runtime probes only — this is the structural counterpart: a declarative inventory of
// web-AI capabilities (status / ownerPrd / browserGate / fail-closed stage / family /
// frontend observation) with lookup + fail-closed gating. Reverse port of cli-jaw
// web-ai/capability-registry.ts; throws agbrowse's WebAiError (capability.unsupported)
// instead of cli-jaw's BrowserCapabilityError.

import {
    CHATGPT_ATTACHMENT_OBSERVATION,
    CHATGPT_IMAGE_GENERATION_OBSERVATION,
    CHATGPT_MODEL_SELECTOR_OBSERVATION,
    CHATGPT_WEB_SEARCH_OBSERVATION,
    GEMINI_DEEP_THINK_OBSERVATION,
    GEMINI_IMAGE_GENERATION_OBSERVATION,
    GEMINI_MODEL_PICKER_OBSERVATION,
} from './capability-observation-presets.mjs';
import { OBSERVED_TOOL_CAPABILITY_ENTRIES } from './capability-observed-tool-entries.mjs';
import { WebAiError } from './errors.mjs';

/**
 * @typedef {import('./capability-types.mjs').CapabilityEntry} CapabilityEntry
 * @typedef {import('./capability-types.mjs').CapabilityFamily} CapabilityFamily
 * @typedef {import('./capability-types.mjs').CapabilitySchemaRow} CapabilitySchemaRow
 * @typedef {import('./capability-types.mjs').FrontendObservationStatus} FrontendObservationStatus
 * @typedef {import('./capability-types.mjs').WebAiVendorScope} WebAiVendorScope
 */

/** @type {CapabilityEntry[]} */
const REGISTRY = [
    {
        id: 'chatgpt-question-envelope',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.1/32.2',
        commandBehavior: 'render and insert a structured envelope before browser mutation',
        browserMutationAllowed: true,
        requiredOfficialDocs: ['https://help.openai.com/en/articles/8983675'],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'tools',
    },
    {
        id: 'chatgpt-active-tab-verification',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.6',
        commandBehavior: 'fail closed when active tab is not a verified ChatGPT tab',
        browserMutationAllowed: false,
        failClosedStage: 'status',
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'sessionReattach',
    },
    {
        id: 'chatgpt-composer-insert',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.1/32.2',
        commandBehavior: 'insert prompt into composer and verify commit',
        browserMutationAllowed: true,
        requiredOfficialDocs: ['https://help.openai.com/en/articles/8983675'],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'tools',
    },
    {
        id: 'chatgpt-send-button',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.2',
        commandBehavior: 'click enabled send button via trusted path',
        browserMutationAllowed: true,
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'tools',
    },
    {
        id: 'chatgpt-prompt-commit',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.4/32.6',
        commandBehavior: 'verify committed turn count after submit',
        browserMutationAllowed: true,
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'responseCapture',
    },
    {
        id: 'chatgpt-answer-polling',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.4',
        commandBehavior: 'capture only assistant turn after committed baseline',
        browserMutationAllowed: false,
        failClosedStage: 'poll-timeout',
        requiredOfficialDocs: ['https://help.openai.com/en/articles/8983675'],
        browserGate: 'partial',
        cliJawPortGate: 'partial',
        family: 'responseCapture',
    },
    {
        id: 'chatgpt-stop-generation',
        vendor: 'chatgpt',
        status: 'planned',
        ownerPrd: '32.4',
        commandBehavior: 'press Escape on verified target session only',
        browserMutationAllowed: true,
        requiredOfficialDocs: [],
        browserGate: 'partial',
        cliJawPortGate: 'partial',
        family: 'stopGeneration',
    },
    {
        id: 'chatgpt-copy-markdown-fallback',
        vendor: 'chatgpt',
        status: 'planned',
        ownerPrd: '32.4',
        commandBehavior: 'opt-in, post-completion only, recorded in usedFallbacks',
        browserMutationAllowed: false,
        failClosedStage: 'poll-timeout',
        requiredOfficialDocs: [],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
        family: 'copyOrExport',
    },
    {
        id: 'web-ai-failure-diagnostics',
        vendor: 'shared',
        status: 'planned',
        ownerPrd: '32.5',
        commandBehavior: 'return redacted diagnostics envelope on every failure',
        browserMutationAllowed: false,
        requiredOfficialDocs: [],
        browserGate: 'partial',
        cliJawPortGate: 'partial',
        family: 'diagnostics',
    },
    {
        id: 'web-ai-session-lifecycle',
        vendor: 'shared',
        status: 'planned',
        ownerPrd: '32.6',
        commandBehavior: 'persist sessionId/targetId/baseline; reattach safely',
        browserMutationAllowed: false,
        requiredOfficialDocs: [],
        browserGate: 'partial',
        cliJawPortGate: 'partial',
        family: 'sessionReattach',
    },
    {
        id: 'chatgpt-attachment-policy',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.7',
        commandBehavior: 'preflight --file, upload, wait for visible chip, verify sent user turn evidence',
        browserMutationAllowed: true,
        failClosedStage: 'attachment-preflight',
        requiredOfficialDocs: [
            'https://help.openai.com/en/articles/8983675',
            'https://help.openai.com/en/articles/8555545-file-uploads-with-gpts-and-advanced-data-analysis-in-chatgpt',
        ],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'attachments',
        observation: CHATGPT_ATTACHMENT_OBSERVATION,
    },
    {
        id: 'chatgpt-file-input',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.7',
        commandBehavior: 'locate composer-scoped file input and set local file',
        browserMutationAllowed: true,
        failClosedStage: 'attachment-preflight',
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'attachments',
        observation: CHATGPT_ATTACHMENT_OBSERVATION,
    },
    {
        id: 'chatgpt-upload-chip-wait',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.7',
        commandBehavior: 'visible chip + accepted state required',
        browserMutationAllowed: true,
        failClosedStage: 'attachment-upload',
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'attachments',
        observation: CHATGPT_ATTACHMENT_OBSERVATION,
    },
    {
        id: 'chatgpt-sent-turn-attachment-evidence',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.7',
        commandBehavior: 'sent user-turn must include attachment evidence',
        browserMutationAllowed: true,
        failClosedStage: 'attachment-upload',
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'attachments',
        observation: CHATGPT_ATTACHMENT_OBSERVATION,
    },
    {
        id: 'web-ai-model-selection',
        vendor: 'shared',
        status: 'rejected-until-verified',
        ownerPrd: '32.8/32.9',
        commandBehavior: 'reject --model; provider-specific only',
        browserMutationAllowed: false,
        requiredOfficialDocs: [],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
        family: 'modelSelection',
        observation: {
            status: 'unsupported',
            source: 'planning',
            selectorCandidates: [],
            textCandidates: [],
            activationPath: [],
            activeStateSignals: [],
            mutationRisk: 'medium',
            notes: ['Generic cross-provider model selection is rejected; model selection must be provider-specific.'],
        },
    },
    {
        id: 'chatgpt-model-selection',
        vendor: 'chatgpt',
        status: 'ported-cli-jaw',
        ownerPrd: '32.8/32.9',
        commandBehavior: 'support --model instant|thinking|pro via ChatGPT model switcher and aria-checked verification',
        browserMutationAllowed: true,
        failClosedStage: 'provider-select-model',
        requiredOfficialDocs: [],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'modelSelection',
        observation: CHATGPT_MODEL_SELECTOR_OBSERVATION,
    },
    {
        id: 'chatgpt-web-search-toggle',
        vendor: 'chatgpt',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; runtime activation remains fail-closed until a dedicated --web-search option is wired',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://help.openai.com/en/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'webSearch',
        observation: CHATGPT_WEB_SEARCH_OBSERVATION,
    },
    {
        id: 'chatgpt-image-generation-tool',
        vendor: 'chatgpt',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; runtime activation and output artifact capture remain fail-closed',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://help.openai.com/en/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'imageGeneration',
        observation: CHATGPT_IMAGE_GENERATION_OBSERVATION,
    },
    {
        id: 'gemini-deep-think',
        vendor: 'gemini',
        status: 'ported-cli-jaw',
        ownerPrd: '32.8',
        commandBehavior: 'Gemini live adapter opens a fresh chat, selects Tools > Deep think, verifies the Deep think chip, then sends with Gemini composer',
        browserMutationAllowed: true,
        failClosedStage: 'provider-select-mode',
        requiredOfficialDocs: ['https://support.google.com/gemini/answer/16345172'],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'deepThink',
        observation: GEMINI_DEEP_THINK_OBSERVATION,
    },
    {
        id: 'gemini-model-picker',
        vendor: 'gemini',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; runtime mode switching remains fail-closed until helper + smoke are added',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://support.google.com/gemini/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'modelSelection',
        observation: GEMINI_MODEL_PICKER_OBSERVATION,
    },
    {
        id: 'gemini-image-generation-tool',
        vendor: 'gemini',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; Gemini Tools > Create image observed, output capture remains fail-closed',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://support.google.com/gemini/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'imageGeneration',
        observation: GEMINI_IMAGE_GENERATION_OBSERVATION,
    },
    {
        id: 'gemini-file-context',
        vendor: 'gemini',
        status: 'ported-cli-jaw',
        ownerPrd: '32.8/32.9',
        commandBehavior: 'separate adapter via filechooser event; no ChatGPT selector reuse',
        browserMutationAllowed: true,
        failClosedStage: 'attachment-preflight',
        requiredOfficialDocs: [
            'https://support.google.com/gemini/answer/14903178',
            'https://support.google.com/gemini/answer/16275805',
        ],
        browserGate: 'present',
        cliJawPortGate: 'present',
        family: 'attachments',
    },
    {
        id: 'deep-research',
        vendor: 'shared',
        status: 'deferred',
        ownerPrd: '32.9',
        commandBehavior: 'separate state machine; not normal chat',
        browserMutationAllowed: false,
        requiredOfficialDocs: [
            'https://help.openai.com/articles/10500283',
            'https://support.google.com/gemini/answer/15719111',
        ],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
    },
    {
        id: 'chatgpt-projects',
        vendor: 'chatgpt',
        status: 'deferred',
        ownerPrd: '32.9',
        commandBehavior: 'project context metadata only; attachment after 32.7',
        browserMutationAllowed: false,
        requiredOfficialDocs: [
            'https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt',
        ],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
    },
    {
        id: 'chatgpt-library',
        vendor: 'chatgpt',
        status: 'deferred',
        ownerPrd: '32.9',
        commandBehavior: 'detect availability only; no attach until 32.7',
        browserMutationAllowed: false,
        requiredOfficialDocs: [
            'https://help.openai.com/en/articles/20001052-library-for-chatgpt',
        ],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
    },
    {
        id: 'chatgpt-apps-connected-sources',
        vendor: 'chatgpt',
        status: 'deferred',
        ownerPrd: '32.9',
        commandBehavior: 'already-connected only; hard stop on write actions',
        browserMutationAllowed: false,
        requiredOfficialDocs: ['https://help.openai.com/en/articles/11487775'],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
    },
    {
        id: 'chatgpt-canvas-capture',
        vendor: 'chatgpt',
        status: 'deferred',
        ownerPrd: '32.9',
        commandBehavior: 'detect Canvas-opened state; no editing or export',
        browserMutationAllowed: false,
        requiredOfficialDocs: [
            'https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it',
        ],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
    },
    {
        id: 'web-ai-captcha-bypass',
        vendor: 'shared',
        status: 'out-of-scope',
        ownerPrd: '32.3',
        commandBehavior: 'never automated; explicitly forbidden',
        browserMutationAllowed: false,
        requiredOfficialDocs: [],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
    },
    {
        id: 'web-ai-cross-vendor-fallback',
        vendor: 'shared',
        status: 'out-of-scope',
        ownerPrd: '32.3',
        commandBehavior: 'forbidden; vendor must be explicit per command',
        browserMutationAllowed: false,
        requiredOfficialDocs: [],
        browserGate: 'absent',
        cliJawPortGate: 'absent',
    },
    ...OBSERVED_TOOL_CAPABILITY_ENTRIES,
];

/** @type {CapabilityEntry} */
const UNKNOWN = {
    id: 'unknown',
    vendor: 'shared',
    status: 'unknown',
    ownerPrd: '32.3',
    commandBehavior: 'fail closed before any browser mutation',
    browserMutationAllowed: false,
    failClosedStage: 'status',
    requiredOfficialDocs: [],
    browserGate: 'absent',
    cliJawPortGate: 'absent',
};

/** @returns {readonly CapabilityEntry[]} */
export function listCapabilities() {
    return REGISTRY;
}

/**
 * @param {{ vendor?: WebAiVendorScope, family?: CapabilityFamily, frontendStatus?: FrontendObservationStatus }} [input]
 * @returns {CapabilitySchemaRow[]}
 */
export function listCapabilitySchemas(input = {}) {
    return REGISTRY
        .filter((entry) => !input.vendor || entry.vendor === input.vendor || entry.vendor === 'shared')
        .filter((entry) => !input.family || entry.family === input.family)
        .filter((entry) => !input.frontendStatus || entry.observation?.status === input.frontendStatus)
        .map(toCapabilitySchemaRow);
}

/**
 * @param {WebAiVendorScope} [vendor]
 * @returns {CapabilityEntry[]}
 */
export function listFrontendObservedCapabilities(vendor) {
    return REGISTRY
        .filter((entry) => !vendor || entry.vendor === vendor || entry.vendor === 'shared')
        .filter((entry) => Boolean(entry.observation))
        .map((entry) => entry.observation ? { ...entry, observation: { ...entry.observation } } : { ...entry });
}

/**
 * @param {string} id
 * @returns {CapabilityEntry}
 */
export function lookupCapability(id) {
    const found = REGISTRY.find((entry) => entry.id === id);
    return found ? { ...found } : { ...UNKNOWN, id };
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isCapabilityEnabled(id) {
    const entry = lookupCapability(id);
    return entry.status === 'implemented-30_browser' || entry.status === 'ported-cli-jaw';
}

/**
 * Return the entry only when enabled; otherwise throw a fail-closed WebAiError.
 * @param {string} id
 * @returns {CapabilityEntry}
 */
export function requireCapabilityOrFailClosed(id) {
    const entry = lookupCapability(id);
    if (entry.status === 'implemented-30_browser' || entry.status === 'ported-cli-jaw') return entry;
    const stage = entry.failClosedStage || 'status';
    const reason = entry.status === 'unknown'
        ? `unknown capability "${id}"; fail closed`
        : `capability "${id}" is ${entry.status} (PRD${entry.ownerPrd}); not enabled`;
    throw new WebAiError({
        errorCode: 'capability.unsupported',
        stage,
        retryHint: 'feature-fallback',
        message: `${reason}. stage=${stage}`,
        mutationAllowed: entry.browserMutationAllowed,
        evidence: { capabilityId: id, ownerPrd: entry.ownerPrd },
    });
}

/**
 * @param {CapabilityEntry} entry
 * @returns {CapabilitySchemaRow}
 */
function toCapabilitySchemaRow(entry) {
    const observation = entry.observation;
    return {
        providerId: entry.vendor,
        capabilityId: entry.id,
        family: entry.family || 'unclassified',
        status: entry.status,
        frontendStatus: observation?.status || 'not-observed',
        mutationAllowed: entry.browserMutationAllowed,
        activationPath: observation?.activationPath || [],
        activeStateSignals: observation?.activeStateSignals || [],
        failureStage: entry.failClosedStage || 'status',
    };
}
