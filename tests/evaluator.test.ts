import { describe, expect, it } from 'vitest';
import { renderPrompt, runEvaluation, summarise } from '../lib/evaluator';
import { DEFAULT_RUN_CONFIG } from '../lib/config';
import { loadDatasetBundle } from '../lib/datasets';
import { HeuristicJudge } from '../lib/judge';
import { MockProvider, createProvider } from '../lib/providers';
import type { LLMProvider } from '../lib/providers/types';
import { ProviderError } from '../lib/providers/types';
import type { CaseResult } from '../lib/types';

const bundle = loadDatasetBundle('acme-support');
const v2 = bundle.workflows.find((w) => w.version === 'v2-grounded')!;
const v1 = bundle.workflows.find((w) => w.version === 'v1-baseline')!;

function evaluate(provider: LLMProvider, workflow = v2, concurrency = 4) {
  return runEvaluation({
    bundle,
    workflow,
    provider,
    judge: new HeuristicJudge(),
    config: DEFAULT_RUN_CONFIG,
    concurrency,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    idFactory: () => 'run_test',
  });
}

const realProvider = () => createProvider('mock', { fixturesDir: bundle.fixturesDir });

describe('renderPrompt', () => {
  it('injects retrieved policy into the user message, keeping the system prompt stable', () => {
    const testCase = bundle.dataset.cases.find((c) => c.id === 'case-003')!;
    const prompt = renderPrompt(v2, testCase, bundle);
    expect(prompt.system).toBe(v2.systemPrompt);
    expect(prompt.user).toContain('Reference policy excerpts');
    expect(prompt.user).toContain(testCase.input);
    expect(prompt.retrievedRefs).toContain('kb-refund');
  });

  it('retrieves fewer snippets when the workflow asks for fewer', () => {
    const testCase = bundle.dataset.cases.find((c) => c.id === 'case-002')!;
    const v3 = bundle.workflows.find((w) => w.version === 'v3-cost-optimised')!;
    expect(renderPrompt(v3, testCase, bundle).retrievedRefs.length).toBeLessThan(
      renderPrompt(v2, testCase, bundle).retrievedRefs.length,
    );
  });
});

describe('runEvaluation', () => {
  it('produces one result per case, in dataset order, regardless of concurrency', async () => {
    const sequential = await evaluate(realProvider(), v2, 1);
    const parallel = await evaluate(realProvider(), v2, 8);
    expect(sequential.results.map((r) => r.caseId)).toEqual(bundle.dataset.cases.map((c) => c.id));
    expect(parallel.results.map((r) => r.caseId)).toEqual(sequential.results.map((r) => r.caseId));
  });

  it('is fully reproducible: the same inputs give the same scores', async () => {
    const first = await evaluate(realProvider());
    const second = await evaluate(realProvider());
    expect(second.summary).toEqual(first.summary);
    expect(second.results.map((r) => r.scores.overall)).toEqual(first.results.map((r) => r.scores.overall));
  });

  it('embeds everything needed to audit the run', async () => {
    const run = await evaluate(realProvider());
    expect(run.datasetHash).toBe(bundle.hash);
    expect(run.config.providerId).toBe('mock');
    expect(run.config.judgeId).toBe('heuristic');
    expect(run.label).toBe('support-agent@v2-grounded');
    expect(run.results[0]?.retrievedRefs).toBeDefined();
  });

  it('records the improvement from v1 to v2 that the demo claims', async () => {
    const baseline = await evaluate(realProvider(), v1);
    const candidate = await evaluate(realProvider(), v2);
    expect(candidate.summary.overall).toBeGreaterThan(baseline.summary.overall + 0.2);
    expect(candidate.summary.groundedness).toBeGreaterThan(baseline.summary.groundedness);
    // ...and that the fix is not free.
    expect(candidate.summary.meanCostUsd).toBeGreaterThan(baseline.summary.meanCostUsd);
  });

  it('isolates a provider failure to its own case instead of losing the run', async () => {
    const flaky: LLMProvider = {
      id: 'flaky',
      supportsRealCalls: false,
      complete: (request) =>
        request.fixtureKey?.endsWith('case-005')
          ? Promise.reject(new ProviderError('boom', 'flaky', false))
          : realProvider().complete(request),
    };

    const run = await evaluate(flaky);
    expect(run.results).toHaveLength(30);
    expect(run.summary.erroredCases).toBe(1);

    const failed = run.results.find((r) => r.caseId === 'case-005');
    expect(failed?.error).toContain('boom');
    expect(failed?.scores.overall).toBe(0);
    expect(run.summary.passedCases).toBeGreaterThan(20);
  });

  it('retries a retryable provider error before giving up', async () => {
    let attempts = 0;
    const provider = new MockProvider({});
    const flaky: LLMProvider = {
      id: 'flaky',
      supportsRealCalls: false,
      complete: (request) => {
        attempts += 1;
        if (attempts < 2) return Promise.reject(new ProviderError('rate limited', 'flaky', true));
        return realProvider().complete(request);
      },
    };
    void provider;

    const run = await runEvaluation({
      bundle: { ...bundle, dataset: { ...bundle.dataset, cases: bundle.dataset.cases.slice(0, 1) } },
      workflow: v2,
      provider: flaky,
      judge: new HeuristicJudge(),
      config: DEFAULT_RUN_CONFIG,
      concurrency: 1,
    });

    expect(attempts).toBe(2);
    expect(run.summary.erroredCases).toBe(0);
  });
});

describe('summarise', () => {
  const result = (overrides: Partial<CaseResult>): CaseResult => ({
    caseId: 'c', category: 'policy', weight: 1, input: 'i', expected: 'e', actual: 'a',
    retrievedRefs: [], latencyMs: 100, usage: { inputTokens: 1, outputTokens: 1, estimated: true },
    costUsd: 0.001,
    scores: {
      correctness: { score: 1, rationale: '', details: {} },
      groundedness: { score: 1, rationale: '', details: {} },
      completeness: { score: 1, rationale: '', details: {} },
      overall: 1,
    },
    passed: true, failureReasons: [], ...overrides,
  });

  it('returns a zeroed summary for an empty run rather than NaN', () => {
    const summary = summarise([]);
    expect(summary.passRate).toBe(0);
    expect(summary.meanLatencyMs).toBe(0);
    expect(Number.isNaN(summary.overall)).toBe(false);
  });

  it('weights quality metrics by case weight but not latency', () => {
    const summary = summarise([
      result({ caseId: 'a', weight: 3, scores: { ...result({}).scores, overall: 0 }, latencyMs: 100 }),
      result({ caseId: 'b', weight: 1, latencyMs: 300 }),
    ]);
    expect(summary.overall).toBeCloseTo(0.25, 3);
    expect(summary.meanLatencyMs).toBe(200);
  });

  it('lets a human accept override the automated verdict in the pass rate', () => {
    const summary = summarise([
      result({ caseId: 'a', passed: false, review: { verdict: 'accept', comment: 'fine', reviewer: 'me', reviewedAt: '2026-01-01T00:00:00.000Z' } }),
    ]);
    expect(summary.passRate).toBe(1);
    expect(summary.reviewedCases).toBe(1);
  });

  it('computes p95 by nearest rank', () => {
    const results = Array.from({ length: 20 }, (_, index) => result({ caseId: `c${index}`, latencyMs: (index + 1) * 100 }));
    expect(summarise(results).p95LatencyMs).toBe(1900);
  });
});
