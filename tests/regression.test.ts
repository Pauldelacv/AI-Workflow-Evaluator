import { describe, expect, it } from 'vitest';
import { DEFAULT_REGRESSION_POLICY } from '../lib/config';
import { detectRegression } from '../lib/regression';
import type { CaseResult, RegressionPolicy, Run, RunSummary } from '../lib/types';

function caseResult(caseId: string, overall: number, passed: boolean): CaseResult {
  return {
    caseId, category: 'policy', weight: 1, input: 'i', expected: 'e', actual: 'a', retrievedRefs: [],
    latencyMs: 1000, usage: { inputTokens: 10, outputTokens: 10, estimated: true }, costUsd: 0.001,
    scores: {
      correctness: { score: overall, rationale: '', details: {} },
      groundedness: { score: overall, rationale: '', details: {} },
      completeness: { score: overall, rationale: '', details: {} },
      overall,
    },
    passed, failureReasons: [],
  };
}

function makeRun(id: string, summary: Partial<RunSummary>, results: CaseResult[] = [], datasetHash = 'hash-1'): Run {
  return {
    id, label: `support-agent@${id}`, createdAt: '2026-01-01T00:00:00.000Z',
    datasetId: 'demo', datasetName: 'Demo', datasetHash,
    workflowId: 'support-agent', workflowVersion: id,
    config: {
      weights: { correctness: 0.5, groundedness: 0.25, completeness: 0.25 },
      passThreshold: 0.7, providerId: 'mock', judgeId: 'heuristic', seed: 42,
    },
    results,
    summary: {
      totalCases: results.length, passedCases: 0, failedCases: 0, erroredCases: 0, reviewedCases: 0,
      passRate: 0.9, correctness: 0.9, groundedness: 0.9, completeness: 0.9, overall: 0.9,
      meanLatencyMs: 1000, p95LatencyMs: 1200, totalCostUsd: 0.03, meanCostUsd: 0.001, byCategory: {},
      ...summary,
    },
    durationMs: 1000, notes: '',
  };
}

describe('detectRegression', () => {
  it('flags a quality drop beyond the tolerance as a blocking regression', () => {
    const report = detectRegression({
      baseline: makeRun('v1', { correctness: 0.91 }),
      candidate: makeRun('v2', { correctness: 0.86 }),
    });
    const correctness = report.metricDeltas.find((d) => d.metric === 'correctness')!;
    expect(correctness.severity).toBe('regression');
    expect(correctness.delta).toBeCloseTo(-0.05, 5);
    expect(report.blocked).toBe(true);
    expect(report.findings.join(' ')).toContain('REGRESSION correctness');
  });

  it('tolerates a drop inside the configured threshold', () => {
    const report = detectRegression({
      baseline: makeRun('v1', { correctness: 0.91 }),
      candidate: makeRun('v2', { correctness: 0.89 }),
    });
    expect(report.metricDeltas.find((d) => d.metric === 'correctness')?.severity).toBe('neutral');
    expect(report.blocked).toBe(false);
  });

  it('treats cost and latency as non-blocking tradeoffs, not regressions', () => {
    const report = detectRegression({
      baseline: makeRun('v1', { meanLatencyMs: 1200, meanCostUsd: 0.006 }),
      candidate: makeRun('v2', { meanLatencyMs: 1510, meanCostUsd: 0.009 }),
    });
    const latency = report.metricDeltas.find((d) => d.metric === 'meanLatencyMs')!;
    const cost = report.metricDeltas.find((d) => d.metric === 'meanCostUsd')!;
    expect(latency.severity).toBe('tradeoff');
    expect(cost.severity).toBe('tradeoff');
    expect(report.blocked).toBe(false);
  });

  it('reads latency and cost as lower-is-better', () => {
    const report = detectRegression({
      baseline: makeRun('v1', { meanLatencyMs: 1500 }),
      candidate: makeRun('v2', { meanLatencyMs: 600 }),
    });
    expect(report.metricDeltas.find((d) => d.metric === 'meanLatencyMs')?.severity).toBe('improvement');
  });

  it('never declares "better" when quality falls and cost improves', () => {
    // The whole point: this is a business tradeoff, not a verdict the tool makes.
    const report = detectRegression({
      baseline: makeRun('v2', { overall: 0.93, correctness: 0.91, passRate: 0.93, meanCostUsd: 0.0013 }),
      candidate: makeRun('v3', { overall: 0.85, correctness: 0.79, passRate: 0.77, meanCostUsd: 0.0004 }),
    });
    expect(report.verdict).toBe('mixed');
    expect(report.blocked).toBe(true);
  });

  it('reports a clean win as improved', () => {
    const report = detectRegression({
      baseline: makeRun('v1', { overall: 0.49, correctness: 0.4, passRate: 0.33 }),
      candidate: makeRun('v2', { overall: 0.93, correctness: 0.91, passRate: 0.93 }),
    });
    expect(report.verdict).toBe('improved');
    expect(report.blocked).toBe(false);
  });

  it('returns neutral when nothing moved', () => {
    expect(detectRegression({ baseline: makeRun('v1', {}), candidate: makeRun('v2', {}) }).verdict).toBe('neutral');
  });

  it('detects previously passing cases that now fail, and blocks on them', () => {
    const report = detectRegression({
      baseline: makeRun('v1', {}, [caseResult('case-001', 0.95, true), caseResult('case-002', 0.95, true)]),
      candidate: makeRun('v2', {}, [caseResult('case-001', 0.95, true), caseResult('case-002', 0.4, false)]),
    });
    expect(report.newFailures).toHaveLength(1);
    expect(report.newFailures[0]?.caseId).toBe('case-002');
    expect(report.blocked).toBe(true);
    expect(report.findings.join(' ')).toContain('case-002');
  });

  it('reports newly passing cases too', () => {
    const report = detectRegression({
      baseline: makeRun('v1', {}, [caseResult('case-001', 0.3, false)]),
      candidate: makeRun('v2', {}, [caseResult('case-001', 0.95, true)]),
    });
    expect(report.newPasses.map((t) => t.caseId)).toEqual(['case-001']);
    expect(report.blocked).toBe(false);
  });

  it('honours a human override when deciding whether a case regressed', () => {
    const reviewed = { ...caseResult('case-001', 0.4, false), review: { verdict: 'accept' as const, comment: '', reviewer: 'me', reviewedAt: '2026-01-01T00:00:00.000Z' } };
    const report = detectRegression({
      baseline: makeRun('v1', {}, [caseResult('case-001', 0.95, true)]),
      candidate: makeRun('v2', {}, [reviewed]),
    });
    expect(report.newFailures).toHaveLength(0);
  });

  it('respects a configurable new-failure budget', () => {
    const policy: RegressionPolicy = { ...DEFAULT_REGRESSION_POLICY, maxNewFailures: 1 };
    const report = detectRegression({
      baseline: makeRun('v1', {}, [caseResult('case-001', 0.95, true)]),
      candidate: makeRun('v2', {}, [caseResult('case-001', 0.4, false)]),
      policy,
    });
    expect(report.newFailures).toHaveLength(1);
    expect(report.blocked).toBe(false);
  });

  it('warns when the two runs used different dataset content', () => {
    const report = detectRegression({
      baseline: makeRun('v1', {}, [], 'hash-1'),
      candidate: makeRun('v2', {}, [], 'hash-2'),
    });
    expect(report.datasetMismatch).toBe(true);
    expect(report.findings[0]).toContain('Dataset content differs');
  });

  it('excludes cases that exist in only one run from the case-level comparison', () => {
    const report = detectRegression({
      baseline: makeRun('v1', {}, [caseResult('case-001', 0.95, true)]),
      candidate: makeRun('v2', {}, [caseResult('case-002', 0.95, true)]),
    });
    expect(report.unmatchedCaseIds.sort()).toEqual(['case-001', 'case-002']);
    expect(report.newFailures).toHaveLength(0);
  });

  it('applies a configurable threshold, so a team can tighten the gate', () => {
    const strict: RegressionPolicy = {
      metrics: { correctness: { direction: 'higher-is-better', mode: 'absolute-points', tolerance: 0.001, blocking: true } },
      maxNewFailures: 0,
    };
    const report = detectRegression({
      baseline: makeRun('v1', { correctness: 0.91 }),
      candidate: makeRun('v2', { correctness: 0.905 }),
      policy: strict,
    });
    expect(report.blocked).toBe(true);
  });
});
