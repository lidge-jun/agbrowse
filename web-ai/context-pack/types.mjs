// @ts-check
/**
 * @typedef {'summary'|'json'|'full'} ContextDryRunMode
 * @typedef {'inline'|'upload'|'auto'|'none'} ContextTransportMode
 *
 * @typedef {Object} ContextPackInput
 * @property {string} [vendor]
 * @property {string} [model]
 * @property {string} prompt
 * @property {string[]} [contextFromFiles]
 * @property {string[]} [contextExclude]
 * @property {string} [contextFile]
 * @property {number} [maxInput]
 * @property {number} [maxFileSize]
 * @property {boolean} [filesReport]
 * @property {ContextTransportMode} [contextTransport]
 * @property {boolean} [inlineOnly]
 * @property {boolean} [strict]
 *
 * @typedef {Object} SelectedContextFile
 * @property {string} path
 * @property {string} relativePath
 * @property {number} sizeBytes
 * @property {number} estimatedTokens
 * @property {string} language
 * @property {string} content
 *
 * @typedef {Object} ExcludedContextFile
 * @property {string} path
 * @property {string} [relativePath]
 * @property {string} reason
 * @property {number} [sizeBytes]
 *
 * @typedef {Object} ContextBudgetReport
 * @property {'ok'|'warning'|'over-budget'} status
 * @property {number} estimatedTokens
 * @property {number} maxInputTokens
 * @property {number} inlineChars
 * @property {number} inlineCharLimit
 *
 * @typedef {Object} ContextPackResult
 * @property {boolean} ok
 * @property {string} status
 * @property {string} vendor
 * @property {string} [model]
 * @property {ContextBudgetReport} budget
 * @property {ContextTransportMode} transport
 * @property {SelectedContextFile[]} files
 * @property {ExcludedContextFile[]} excluded
 * @property {string} composerText
 * @property {string} attachmentText
 * @property {{path:string,displayPath:string,sizeBytes:number}[]} attachments
 * @property {string[]} warnings
 */

export {};
