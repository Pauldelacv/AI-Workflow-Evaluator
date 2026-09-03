import { describe, expect, it } from 'vitest';
import { estimateCostUsd, estimateTokens, pricingFor } from '../lib/cost';

describe('estimateCostUsd', () => {
  it('applies published per-million rates to input and output separately', () => {
    // claude-sonnet-5: $2/MTok in, $10/MTok out.
    const cost = estimateCostUsd('claude-sonnet-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      estimated: false,
    });
    expect(cost).toBeCloseTo(12, 10);
  });

  it('returns 0 for an unknown model rather than guessing a price', () => {
    expect(pricingFor('some-other-model')).toBeNull();
    expect(estimateCostUsd('some-other-model', { inputTokens: 5000, outputTokens: 5000, estimated: true })).toBe(0);
  });

  it('scales with token count', () => {
    const usage = (n: number) => ({ inputTokens: n, outputTokens: n, estimated: true });
    expect(estimateCostUsd('claude-opus-5', usage(2000))).toBeCloseTo(
      2 * estimateCostUsd('claude-opus-5', usage(1000)),
      12,
    );
  });
});

describe('estimateTokens', () => {
  it('is zero for empty text and monotonic in length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(40)));
  });
});
