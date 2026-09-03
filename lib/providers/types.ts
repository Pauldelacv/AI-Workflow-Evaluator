import type { TokenUsage } from '../types';

export interface LLMRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  /**
   * Stable key identifying this exact (workflow, case) pair. Only the mock
   * provider uses it, to look up a recorded response. Real providers ignore it.
   */
  fixtureKey?: string;
}

export interface LLMResult {
  text: string;
  usage: TokenUsage;
  latencyMs: number;
  model: string;
  /**
   * True when latency was replayed from a recording instead of measured on a
   * live call. Surfaced in the UI so nobody mistakes a replayed number for a
   * production measurement.
   */
  simulated: boolean;
}

/**
 * The only surface the evaluator knows about. Adding a provider means
 * implementing this interface - no evaluator or scoring code changes.
 *
 * Deliberately narrow: no temperature, top_p or top_k. Current Claude models
 * reject sampling parameters (HTTP 400), and a cross-provider abstraction that
 * leaks provider-specific knobs stops being an abstraction.
 */
export interface LLMProvider {
  readonly id: string;
  /** False for the mock provider; used to label runs and to gate CI. */
  readonly supportsRealCalls: boolean;
  complete(request: LLMRequest): Promise<LLMResult>;
}

/** Raised when a provider cannot serve a request. Carries the case for triage. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
