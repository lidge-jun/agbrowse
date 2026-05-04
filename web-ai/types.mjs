export const WEB_AI_VENDOR = Object.freeze({
    CHATGPT: 'chatgpt',
    GEMINI: 'gemini',
    GROK: 'grok',
});

export const WEB_AI_STATUS = Object.freeze({
    READY: 'ready',
    RENDERED: 'rendered',
    SENT: 'sent',
    POLLING: 'polling',
    STREAMING: 'streaming',
    COMPLETE: 'complete',
    BLOCKED: 'blocked',
    TIMEOUT: 'timeout',
    ERROR: 'error',
});

export const ATTACHMENT_POLICY = Object.freeze({
    INLINE_ONLY: 'inline-only',
    UPLOAD: 'upload',
    AUTO: 'auto',
});

/**
 * @typedef {'chatgpt'|'gemini'|'grok'} WebAiVendor
 * @typedef {'inline-only'|'upload'|'auto'} AttachmentPolicy
 * @typedef {'ready'|'rendered'|'sent'|'polling'|'streaming'|'complete'|'blocked'|'timeout'|'error'} WebAiStatus
 *
 * @typedef {Object} QuestionEnvelope
 * @property {WebAiVendor} vendor
 * @property {string=} system
 * @property {string} prompt
 * @property {string=} project
 * @property {string=} goal
 * @property {string=} context
 * @property {string=} question
 * @property {string=} output
 * @property {string=} constraints
 * @property {AttachmentPolicy} attachmentPolicy
 *
 * @typedef {Object} RenderedQuestionBundle
 * @property {string} markdown
 * @property {string} composerText
 * @property {number} estimatedChars
 * @property {string[]} warnings
 *
 * @typedef {Object} CommittedTurnBaseline
 * @property {WebAiVendor} vendor
 * @property {string} url
 * @property {string} promptHash
 * @property {number} assistantCount
 * @property {string=} textHash
 * @property {string} capturedAt
 *
 * @typedef {Object} AnswerArtifact
 * @property {WebAiVendor|string} provider
 * @property {string|null} sessionId
 * @property {string|null} conversationUrl
 * @property {'copy-button'|'dom-fallback'|'clipboard'|'manual'|'unknown'} capturedBy
 * @property {string} markdown
 * @property {string} text
 * @property {number} exactnessScore
 * @property {number|null} responseStableMs
 * @property {string[]} warnings
 *
 * @typedef {Object} WebAiOutput
 * @property {boolean} ok
 * @property {WebAiVendor} vendor
 * @property {WebAiStatus} status
 * @property {string=} url
 * @property {string=} answerText
 * @property {AnswerArtifact=} answerArtifact
 * @property {RenderedQuestionBundle=} rendered
 * @property {CommittedTurnBaseline=} baseline
 * @property {string[]} warnings
 * @property {string=} error
 *
 * @typedef {Object} ElementRef
 * @property {string} ref
 * @property {string} role
 * @property {string} name
 * @property {string|null} selector
 * @property {string[]} framePath
 * @property {string[]} shadowPath
 * @property {string} signatureHash
 *
 * @typedef {Object} WebAiSnapshot
 * @property {string} snapshotId
 * @property {WebAiVendor|null} provider
 * @property {string|null} url
 * @property {string|null} domHash
 * @property {string} axHash
 * @property {string} text
 * @property {Record<string, ElementRef>} refs
 * @property {{nodeCount:number, interactiveCount:number, tokenEstimate:number}} stats
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {string} [reason]
 * @property {number} [confidence]
 * @property {string} [resolvedVia]
 *
 * @typedef {Object} CacheEntryV2
 * @property {number} schemaVersion
 * @property {string} provider
 * @property {string} intent
 * @property {string} actionKind
 * @property {string|null} urlHost
 * @property {Object} pageFingerprint
 * @property {string} contractVersion
 * @property {string|null} framePath
 * @property {string|null} browserConfigHash
 * @property {Object} target
 * @property {Object} stats
 *
 * @typedef {Object} TraceEvent
 * @property {string} stepId
 * @property {string} ts
 * @property {string} action
 * @property {Object|null} target
 * @property {string} [status]
 * @property {Object} [error]
 *
 * @typedef {Object} MetricEvent
 * @property {string} type
 * @property {string} ts
 * @property {string} [provider]
 * @property {string} [intent]
 * @property {string} [actionKind]
 * @property {number} [durationMs]
 * @property {string} [reason]
 */
