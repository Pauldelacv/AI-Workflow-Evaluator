import { describe, expect, it } from 'vitest';
import { HeuristicJudge, LlmJudge } from '../lib/judge';
import type { LLMProvider, LLMRequest, LLMResult } from '../lib/providers/types';
import { ProviderError } from '../lib/providers/types';

const judge = new HeuristicJudge();

const base = {
  input: 'Can I get a refund after 60 days?',
  expected: 'No. Refunds are only available within 30 days of purchase.',
  keyPoints: ['refunds only within 30 days of purchase'],
};

function stubProvider(reply: string | Error): LLMProvider {
  return {
    id: 'stub',
    supportsRealCalls: false,
    complete: (_request: LLMRequest): Promise<LLMResult> => {
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 10, outputTokens: 10, estimated: true },
        latencyMs: 5,
        model: 'stub-model',
        simulated: true,
      });
    },
  };
}

describe('HeuristicJudge', () => {
  it('is deterministic across repeated calls', async () => {
    const a = await judge.judge({ ...base, actual: 'Refunds are only within 30 days.' });
    const b = await judge.judge({ ...base, actual: 'Refunds are only within 30 days.' });
    expect(a).toEqual(b);
  });

  it('scores an equivalent answer high and an unrelated one low', async () => {
    const good = await judge.judge({ ...base, actual: 'No, refunds are only available within 30 days of purchase.' });
    const bad = await judge.judge({ ...base, actual: 'Our office is open on weekdays.' });
    expect(good.semanticScore).toBeGreaterThan(0.8);
    expect(bad.semanticScore).toBeLessThan(0.2);
  });

  it('detects a contradicting value for the same unit', async () => {
    const verdict = await judge.judge({ ...base, actual: 'Refunds are available within 90 days of purchase.' });
    expect(verdict.contradictions).toHaveLength(1);
    expect(verdict.contradictions[0]).toContain('30day');
    expect(verdict.contradictions[0]).toContain('90day');
  });

  it('does not flag a contradiction when the claim is simply absent', async () => {
    const verdict = await judge.judge({ ...base, actual: 'Refunds depend on your circumstances.' });
    expect(verdict.contradictions).toEqual([]);
  });

  it('returns one key point hit per key point asked about', async () => {
    const verdict = await judge.judge({
      ...base,
      keyPoints: ['refunds only within 30 days', 'backups purged within 90 days'],
      actual: 'Refunds are only within 30 days.',
    });
    expect(verdict.keyPointHits).toHaveLength(2);
    expect(verdict.keyPointHits[0]?.covered).toBe(true);
    expect(verdict.keyPointHits[1]?.covered).toBe(false);
  });
});

describe('LlmJudge', () => {
  it('parses a well-formed JSON verdict', async () => {
    const provider = stubProvider(
      JSON.stringify({
        semantic_score: 0.9,
        key_points: [{ key_point: 'refunds only within 30 days of purchase', covered: true }],
        contradictions: [],
        rationale: 'Same policy outcome.',
      }),
    );
    const verdict = await new LlmJudge({ provider, model: 'stub-model' }).judge({ ...base, actual: 'No refunds after 30 days.' });
    expect(verdict.semanticScore).toBe(0.9);
    expect(verdict.degraded).toBe(false);
    expect(verdict.keyPointHits[0]?.covered).toBe(true);
  });

  it('extracts JSON even when the model wraps it in prose or a code fence', async () => {
    const provider = stubProvider(
      'Here is my assessment:\n```json\n{"semantic_score":0.4,"key_points":[{"key_point":"x","covered":false}],"contradictions":["wrong window"],"rationale":"off"}\n```\nHope that helps.',
    );
    const verdict = await new LlmJudge({ provider, model: 'stub-model' }).judge({ ...base, actual: 'Maybe.' });
    expect(verdict.semanticScore).toBe(0.4);
    expect(verdict.contradictions).toEqual(['wrong window']);
  });

  it('aligns key points by position so a short reply cannot shrink the denominator', async () => {
    const provider = stubProvider(
      JSON.stringify({ semantic_score: 0.5, key_points: [{ key_point: 'only one', covered: true }], contradictions: [] }),
    );
    const verdict = await new LlmJudge({ provider, model: 'stub-model' }).judge({
      ...base,
      keyPoints: ['first point', 'second point'],
      actual: 'Something.',
    });
    expect(verdict.keyPointHits).toHaveLength(2);
    expect(verdict.keyPointHits[1]?.covered).toBe(false);
  });

  it('degrades to the heuristic judge instead of throwing when the call fails', async () => {
    const provider = stubProvider(new ProviderError('rate limited', 'stub', true));
    const verdict = await new LlmJudge({ provider, model: 'stub-model' }).judge({
      ...base,
      actual: 'No, refunds are only available within 30 days of purchase.',
    });
    expect(verdict.degraded).toBe(true);
    expect(verdict.judgeId).toContain('heuristic');
    expect(verdict.semanticScore).toBeGreaterThan(0.8);
  });

  it('degrades when the model returns unparseable output', async () => {
    const verdict = await new LlmJudge({ provider: stubProvider('I think it is fine, honestly.'), model: 'm' }).judge({
      ...base,
      actual: 'No refunds after 30 days.',
    });
    expect(verdict.degraded).toBe(true);
    expect(verdict.rationale).toContain('LLM judge unavailable');
  });

  it('degrades when the JSON is structurally valid but out of range', async () => {
    const verdict = await new LlmJudge({
      provider: stubProvider(JSON.stringify({ semantic_score: 4.2, key_points: [] })),
      model: 'm',
    }).judge({ ...base, actual: 'No refunds after 30 days.' });
    expect(verdict.degraded).toBe(true);
  });
});
