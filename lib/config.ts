import path from 'node:path';
import type { RegressionPolicy, RunConfig, ScoringWeights } from './types';

/**
 * Root for on-disk state. Overridable so tests and containers can point it
 * somewhere writable without touching the repo.
 */
export function dataDir(): string {
  return process.env.AWE_DATA_DIR ?? path.join(process.cwd(), '.data');
}

export function examplesDir(): string {
  return process.env.AWE_EXAMPLES_DIR ?? path.join(process.cwd(), 'examples');
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  correctness: 0.5,
  groundedness: 0.25,
  completeness: 0.25,
};

export const DEFAULT_PASS_THRESHOLD = 0.7;

export const DEFAULT_RUN_CONFIG: Omit<RunConfig, 'providerId' | 'judgeId'> = {
  weights: DEFAULT_WEIGHTS,
  passThreshold: DEFAULT_PASS_THRESHOLD,
  seed: 42,
};

/**
 * Default regression policy.
 *
 * Quality metrics are blocking: a 3-point drop in correctness is a real
 * regression and should stop a deploy. Latency and cost are *reported* but not
 * blocking, because "slower but more accurate" is a business decision, not a
 * bug. Teams tighten this per workflow.
 */
export const DEFAULT_REGRESSION_POLICY: RegressionPolicy = {
  metrics: {
    correctness: { direction: 'higher-is-better', mode: 'absolute-points', tolerance: 0.03, blocking: true },
    groundedness: { direction: 'higher-is-better', mode: 'absolute-points', tolerance: 0.03, blocking: true },
    completeness: { direction: 'higher-is-better', mode: 'absolute-points', tolerance: 0.05, blocking: true },
    overall: { direction: 'higher-is-better', mode: 'absolute-points', tolerance: 0.03, blocking: true },
    passRate: { direction: 'higher-is-better', mode: 'absolute-points', tolerance: 0.03, blocking: true },
    meanLatencyMs: { direction: 'lower-is-better', mode: 'relative', tolerance: 0.25, blocking: false },
    meanCostUsd: { direction: 'lower-is-better', mode: 'relative', tolerance: 0.25, blocking: false },
  },
  maxNewFailures: 0,
};
