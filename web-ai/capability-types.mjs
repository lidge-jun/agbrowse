// @ts-check

// Parity catalog 201 #1a (P1): capability type substrate for the declarative
// capability registry (#1) and frontend observation presets (#2). JSDoc-only — reverse
// port of cli-jaw web-ai/capability-types.ts. `export {}` keeps it an importable module
// so other files can reference these typedefs via import('./capability-types.mjs').X.

/**
 * @typedef {'chatgpt'|'gemini'|'grok'|'shared'} WebAiVendorScope
 */

/**
 * @typedef {'implemented-30_browser'|'ported-cli-jaw'|'planned'|'fail-closed'|'rejected-until-verified'|'deferred'|'out-of-scope'|'unknown'} CapabilityStatus
 */

/**
 * @typedef {'modelSelection'|'attachments'|'webSearch'|'tools'|'imageGeneration'|'deepThink'|'responseCapture'|'sessionReattach'|'stopGeneration'|'copyOrExport'|'diagnostics'|'productSurface'|'safety'} CapabilityFamily
 */

/**
 * @typedef {'observed'|'actionable'|'schema-ready'|'implemented'|'unsupported'|'unstable'|'not-observed'} FrontendObservationStatus
 */

/**
 * @typedef {'none'|'read-only'|'low'|'medium'|'high'} MutationRisk
 */

/**
 * @typedef {Object} FrontendCapabilityObservation
 * @property {FrontendObservationStatus} status
 * @property {'live-frontend'|'code-inventory'|'external-audit'|'planning'} source
 * @property {string[]} selectorCandidates
 * @property {string[]} textCandidates
 * @property {string[]} activationPath
 * @property {string[]} activeStateSignals
 * @property {MutationRisk} mutationRisk
 * @property {string[]} notes
 */

/**
 * @typedef {Object} CapabilityEntry
 * @property {string} id
 * @property {WebAiVendorScope} vendor
 * @property {CapabilityStatus} status
 * @property {string} ownerPrd
 * @property {string} commandBehavior
 * @property {boolean} browserMutationAllowed
 * @property {string} [failClosedStage]
 * @property {string[]} requiredOfficialDocs
 * @property {'present'|'partial'|'absent'} browserGate
 * @property {'present'|'partial'|'absent'} cliJawPortGate
 * @property {CapabilityFamily} [family]
 * @property {FrontendCapabilityObservation} [observation]
 */

/**
 * @typedef {Object} CapabilitySchemaRow
 * @property {WebAiVendorScope} providerId
 * @property {string} capabilityId
 * @property {CapabilityFamily|'unclassified'} family
 * @property {CapabilityStatus} status
 * @property {FrontendObservationStatus} frontendStatus
 * @property {boolean} mutationAllowed
 * @property {string[]} activationPath
 * @property {string[]} activeStateSignals
 * @property {string} failureStage
 */

export {};
