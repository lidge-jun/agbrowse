// @ts-check

// Parity catalog 201 #8 (P2): observed-but-unported tool capability entries (Gemini
// Canvas/Deep-research/video/music/learn, ChatGPT deep-research), schema-ready backlog
// inventory spread into the registry. Reverse port of cli-jaw web-ai/capability-observed-tool-entries.ts.

import {
    CHATGPT_DEEP_RESEARCH_OBSERVATION,
    GEMINI_TOOLS_MENU_OBSERVATION,
} from './capability-observation-presets.mjs';

/** @typedef {import('./capability-types.mjs').CapabilityEntry} CapabilityEntry */

/** @type {CapabilityEntry[]} */
export const OBSERVED_TOOL_CAPABILITY_ENTRIES = [
    {
        id: 'gemini-canvas-tool',
        vendor: 'gemini',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; Gemini Tools > Canvas is observed but runtime selection is not exposed yet',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://support.google.com/gemini/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'tools',
        observation: GEMINI_TOOLS_MENU_OBSERVATION,
    },
    {
        id: 'gemini-deep-research-tool',
        vendor: 'gemini',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; Deep research needs its own long-running state machine',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://support.google.com/gemini/answer/15719111'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'tools',
        observation: GEMINI_TOOLS_MENU_OBSERVATION,
    },
    {
        id: 'gemini-video-generation-tool',
        vendor: 'gemini',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; Create video was observed but artifact capture is not implemented',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://support.google.com/gemini/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'tools',
        observation: GEMINI_TOOLS_MENU_OBSERVATION,
    },
    {
        id: 'gemini-music-generation-tool',
        vendor: 'gemini',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; Create music was observed but artifact capture is not implemented',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://support.google.com/gemini/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'tools',
        observation: GEMINI_TOOLS_MENU_OBSERVATION,
    },
    {
        id: 'gemini-learn-tool',
        vendor: 'gemini',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; Learn was observed but runtime semantics are not mapped',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://support.google.com/gemini/'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'tools',
        observation: GEMINI_TOOLS_MENU_OBSERVATION,
    },
    {
        id: 'chatgpt-deep-research-tool',
        vendor: 'chatgpt',
        status: 'planned',
        ownerPrd: '260429-phase-01/02',
        commandBehavior: 'schema-ready only; Deep research was observed but requires a long-running state machine',
        browserMutationAllowed: false,
        failClosedStage: 'capability-preflight',
        requiredOfficialDocs: ['https://help.openai.com/articles/10500283'],
        browserGate: 'present',
        cliJawPortGate: 'absent',
        family: 'tools',
        observation: CHATGPT_DEEP_RESEARCH_OBSERVATION,
    },
];
