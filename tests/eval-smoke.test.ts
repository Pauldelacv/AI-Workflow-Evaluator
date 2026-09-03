import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_REGRESSION_POLICY, DEFAULT_RUN_CONFIG } from '../lib/config';
import { findWorkflow, loadDatasetBundle } from '../lib/datasets';
import { runEvaluation } from '../lib/evaluator';
import { HeuristicJudge } from '../lib/judge';
import { createProvider } from '../lib/providers';
import { detectRegression } from '../lib/regression';
import type { Run } from '../lib/types';

/**
 * End-to-end evaluation smoke test.
 *
 * This is the gate CI runs on every push: the full 30-case dataset, all three
 * workflow versions, no API key and no network. It does two jobs.
 *
 *  1. It proves the pipeline works end to end - retrieval, provider, judge,
 *     scoring, aggregation, regression detection.
 *  2. The floors below pin the numbers the README claims. If a scoring change
 *     silently inflates or deflates a metric, this fails and someone has to
 *     look at it. That is the point: an evaluator whose own scores drift
 *     without anyone noticing is worse than no evaluator.
 */

const bundle = loadDatasetBundle('acme-support');

async function run(version: string): Promise<Run> {
  return runEvaluation({
    bundle,
    workflow: findWorkflow(bundle, version),
    provider: createProvider('mock', { fixturesDir: bundle.fixturesDir }),
    judge: new HeuristicJudge(),
    config: DEFAULT_RUN_CONFIG,
    concurrency: 8,
  });
}

let v1: Run;
let v2: Run;
let v3: Run;

beforeAll(async () => {
  [v1, v2, v3] = await Promise.all([run('v1-baseline'), run('v2-grounded'), run('v3-cost-optimised')]);
});

describe('the demo evaluation runs offline and end to end', () => {
  it('evaluates all 30 cases with no provider errors', () => {
    for (const runResult of [v1, v2, v3]) {
      expect(runResult.summary.totalCases).toBe(30);
      expect(runResult.summary.erroredCases).toBe(0);
    }
  });

  it('uses the deterministic provider and judge, so CI needs no API key', () => {
    expect(v2.config.providerId).toBe('mock');
    expect(v2.config.judgeId).toBe('heuristic');
  });
});

describe('v1 baseline: the weaknesses the demo claims are real', () => {
  it('scores poorly overall', () => {
    expect(v1.summary.overall).toBeLessThan(0.6);
    expect(v1.summary.passRate).toBeLessThan(0.5);
  });

  it('fails every adversarial and out-of-scope case', () => {
    // The v1 prompt has no refusal rules, so it complies with prompt injection
    // and answers questions it should decline.
    expect(v1.summary.byCategory['adversarial']?.passed).toBe(0);
    expect(v1.summary.byCategory['out-of-scope']?.passed).toBe(0);
  });

  it('invents figures that are not in its retrieved context', () => {
    const ungrounded = v1.results.filter((result) => result.scores.groundedness.score < 1);
    expect(ungrounded.length).toBeGreaterThanOrEqual(3);
  });
});

describe('v2: the fix works, and is not free', () => {
  it('improves every quality metric substantially', () => {
    expect(v2.summary.overall).toBeGreaterThan(0.9);
    expect(v2.summary.passRate).toBeGreaterThan(0.9);
    expect(v2.summary.correctness - v1.summary.correctness).toBeGreaterThan(0.3);
    expect(v2.summary.groundedness).toBeGreaterThan(0.95);
  });

  it('handles every adversarial and out-of-scope case', () => {
    expect(v2.summary.byCategory['out-of-scope']?.passed).toBe(3);
    expect(v2.summary.byCategory['adversarial']?.passed).toBeGreaterThanOrEqual(2);
  });

  it('costs more and takes longer than the baseline', () => {
    expect(v2.summary.meanCostUsd).toBeGreaterThan(v1.summary.meanCostUsd);
    expect(v2.summary.meanLatencyMs).toBeGreaterThan(v1.summary.meanLatencyMs);
  });

  it('is not blocked, and is reported as mixed rather than "better"', () => {
    const report = detectRegression({ baseline: v1, candidate: v2, policy: DEFAULT_REGRESSION_POLICY });

    // Nothing blocking: every quality metric improved and no case regressed,
    // so this ships.
    expect(report.blocked).toBe(false);
    expect(report.newFailures).toHaveLength(0);
    expect(report.newPasses.length).toBeGreaterThan(10);

    // But the verdict is `mixed`, not `improved`, because the fix cost 85% more
    // per case. The tool reports the price rather than burying it under a win.
    expect(report.verdict).toBe('mixed');
    const findings = report.findings.join('\n');
    expect(findings).toContain('IMPROVEMENT correctness');
    expect(findings).toContain('TRADEOFF meanCostUsd');
  });

  it('still fails the two cases the retriever cannot serve', () => {
    // Honest result: the remaining gap is retrieval, not prompting. Both cases
    // ask about policy the keyword retriever never surfaces.
    const failing = v2.results.filter((result) => !result.passed).map((result) => result.caseId);
    expect(failing).toEqual(['case-025', 'case-026']);
  });
});

describe('v3 cost experiment: cheaper, faster, and worse', () => {
  it('genuinely reduces cost and latency', () => {
    expect(v3.summary.meanCostUsd).toBeLessThan(v2.summary.meanCostUsd * 0.5);
    expect(v3.summary.meanLatencyMs).toBeLessThan(v2.summary.meanLatencyMs);
  });

  it('is blocked because previously passing cases now fail', () => {
    const report = detectRegression({ baseline: v2, candidate: v3, policy: DEFAULT_REGRESSION_POLICY });
    expect(report.blocked).toBe(true);
    expect(report.newFailures.length).toBeGreaterThanOrEqual(3);
  });

  it('is reported as mixed, never as "better", despite the cost win', () => {
    const report = detectRegression({ baseline: v2, candidate: v3, policy: DEFAULT_REGRESSION_POLICY });
    expect(report.verdict).toBe('mixed');
    const findings = report.findings.join('\n');
    expect(findings).toContain('REGRESSION');
    expect(findings).toContain('IMPROVEMENT meanCostUsd');
  });
});
