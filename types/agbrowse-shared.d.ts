// agbrowse shared boundary types — bridge for the strict migration.
// Keep this file authoritative for cross-module shapes until each consuming
// module is converted to .ts in its own phase.

export type Json =
  | string
  | number
  | boolean
  | null
  | { readonly [k: string]: Json }
  | readonly Json[];

export type JsonObject = { readonly [k: string]: Json };

export interface CliResult<T = JsonObject> {
  readonly ok: boolean;
  readonly status?: string;
  readonly data?: T;
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly errorCode?: string;
    readonly stage?: string;
    readonly retryHint?: string;
  };
}

export interface VendorTabRef {
  readonly vendor: 'chatgpt' | 'gemini' | 'grok' | 'perplexity';
  readonly url: string;
  readonly targetId?: string;
  readonly sessionId?: string;
}


export interface AnswerCitation {
  readonly index: number | null;
  readonly title: string;
  readonly url: string;
}

export interface AnswerArtifact {
  readonly provider: string;
  readonly sessionId: string | null;
  readonly conversationUrl: string | null;
  readonly capturedBy: 'copy-button' | 'dom-fallback' | 'clipboard' | 'manual' | 'unknown';
  readonly markdown: string;
  readonly text: string;
  readonly exactnessScore: number;
  readonly responseStableMs: number | null;
  readonly warnings: readonly string[];
  readonly citations: readonly AnswerCitation[];
}
