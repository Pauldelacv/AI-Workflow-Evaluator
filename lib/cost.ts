import type { TokenUsage } from './types';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

/**
 * Published list prices (USD per million tokens), current as of 2026-06.
 *
 * This is a lookup table, not a billing system: it ignores prompt caching,
 * batch discounts and negotiated rates, so treat the output as an order of
 * magnitude for comparing workflow versions against each other - which is
 * exactly what this tool needs it for.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
});

export function pricingFor(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null;
}

/** Returns 0 for unknown models rather than guessing a price. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = pricingFor(model);
  if (!pricing) return 0;
  const input = (usage.inputTokens / 1_000_000) * pricing.inputPerMTok;
  const output = (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
  return input + output;
}

/**
 * Local token estimate: ~4 characters per token.
 *
 * Only used when the provider does not report usage (i.e. the mock provider).
 * Real runs use the counts returned by the API. Estimates are flagged via
 * `TokenUsage.estimated` so the UI can mark them.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
