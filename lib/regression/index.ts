import { DEFAULT_REGRESSION_POLICY } from '../config';
import type {
  CaseTransition,
  MetricDelta,
  RegressionPolicy,
  RegressionReport,
  Run,
  RunSummary,
} from '../types';
import { effectivePassed } from '../types';

/** Metrics that can be compared, and how they are read out of a summary. */
const METRIC_ACCESSORS: Record<string, (summary: RunSummary) => number> = {
  correctness: (summary) => summary.correctness,
  groundedness: (summary) => summary.groundedness,
  completeness: (summary) => summary.completeness,
  overall: (summary) => summary.overall,
  passRate: (summary) => summary.passRate,
  meanLatencyMs: (summary) => summary.meanLatencyMs,
  meanCostUsd: (summary) => summary.meanCostUsd,
};

export interface DetectRegressionOptions {
  baseline: Run;
  candidate: Run;
  policy?: RegressionPolicy;
}

/**
 * Compare a candidate run against a baseline and decide whether shipping it is
 * safe.
 *
 * Three deliberate design choices:
 *
 *  1. **It never says "better" on its own.** Quality up and cost up is reported
 *     as `mixed` with both findings, because that is a business tradeoff and
 *     the tool does not get to make it.
 *  2. **Case-level transitions are first-class.** An aggregate can improve
 *     while three specific cases break. Those three are what the on-call
 *     engineer needs, and they are what `maxNewFailures` gates on.
 *  3. **Only blocking metrics fail CI.** Correctness regressing 5 points stops
 *     a deploy; latency regressing 26% is reported loudly and lets a human
 *     decide.
 */
export function detectRegression(options: DetectRegressionOptions): RegressionReport {
  const { baseline, candidate } = options;
  const policy = options.policy ?? DEFAULT_REGRESSION_POLICY;

  const metricDeltas: MetricDelta[] = [];
  for (const [metric, threshold] of Object.entries(policy.metrics)) {
    const accessor = METRIC_ACCESSORS[metric];
    if (!accessor) continue;

    const baseValue = accessor(baseline.summary);
    const candidateValue = accessor(candidate.summary);
    const delta = candidateValue - baseValue;
    const relativeDelta = baseValue === 0 ? null : delta / baseValue;

    const improved = threshold.direction === 'higher-is-better' ? delta > 0 : delta < 0;
    const worsened = threshold.direction === 'higher-is-better' ? delta < 0 : delta > 0;

    const movement =
      threshold.mode === 'absolute-points'
        ? Math.abs(delta)
        : baseValue === 0
          ? Math.abs(delta) > 0
            ? Number.POSITIVE_INFINITY
            : 0
          : Math.abs(delta / baseValue);

    const breachedThreshold = worsened && movement > threshold.tolerance;

    let severity: MetricDelta['severity'] = 'neutral';
    if (breachedThreshold) severity = threshold.blocking ? 'regression' : 'tradeoff';
    else if (improved && movement > 0) severity = 'improvement';

    metricDeltas.push({
      metric,
      baseline: baseValue,
      candidate: candidateValue,
      delta,
      relativeDelta,
      direction: threshold.direction,
      severity,
      blocking: threshold.blocking,
      breachedThreshold,
    });
  }

  // Case-level transitions, matched by case id.
  const baselineById = new Map(baseline.results.map((result) => [result.caseId, result]));
  const candidateById = new Map(candidate.results.map((result) => [result.caseId, result]));

  const newFailures: CaseTransition[] = [];
  const newPasses: CaseTransition[] = [];
  const unmatchedCaseIds: string[] = [];

  for (const [caseId, candidateResult] of candidateById) {
    const baselineResult = baselineById.get(caseId);
    if (!baselineResult) {
      unmatchedCaseIds.push(caseId);
      continue;
    }
    const before = effectivePassed(baselineResult);
    const after = effectivePassed(candidateResult);
    if (before === after) continue;

    const transition: CaseTransition = {
      caseId,
      category: candidateResult.category,
      baselineScore: baselineResult.scores.overall,
      candidateScore: candidateResult.scores.overall,
    };
    if (before && !after) newFailures.push(transition);
    else newPasses.push(transition);
  }

  for (const caseId of baselineById.keys()) {
    if (!candidateById.has(caseId)) unmatchedCaseIds.push(caseId);
  }
  unmatchedCaseIds.sort();

  const datasetMismatch = baseline.datasetHash !== candidate.datasetHash;

  const blockingBreaches = metricDeltas.filter((delta) => delta.severity === 'regression');
  const tooManyNewFailures = newFailures.length > policy.maxNewFailures;
  const blocked = blockingBreaches.length > 0 || tooManyNewFailures;

  const hasImprovement = metricDeltas.some((delta) => delta.severity === 'improvement') || newPasses.length > 0;
  const hasRegression = blockingBreaches.length > 0 || tooManyNewFailures;
  const hasTradeoff = metricDeltas.some((delta) => delta.severity === 'tradeoff');

  let verdict: RegressionReport['verdict'];
  if (hasRegression && hasImprovement) verdict = 'mixed';
  else if (hasRegression) verdict = 'regressed';
  else if (hasImprovement && hasTradeoff) verdict = 'mixed';
  else if (hasImprovement) verdict = 'improved';
  else verdict = 'neutral';

  return {
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    datasetMismatch,
    unmatchedCaseIds,
    metricDeltas,
    newFailures: newFailures.sort((a, b) => a.caseId.localeCompare(b.caseId)),
    newPasses: newPasses.sort((a, b) => a.caseId.localeCompare(b.caseId)),
    verdict,
    blocked,
    findings: buildFindings({ metricDeltas, newFailures, newPasses, datasetMismatch, policy, unmatchedCaseIds }),
  };
}

function buildFindings(input: {
  metricDeltas: MetricDelta[];
  newFailures: CaseTransition[];
  newPasses: CaseTransition[];
  datasetMismatch: boolean;
  unmatchedCaseIds: string[];
  policy: RegressionPolicy;
}): string[] {
  const findings: string[] = [];

  if (input.datasetMismatch) {
    findings.push(
      'Dataset content differs between the two runs. Metric deltas mix workflow changes with dataset changes and should not be trusted.',
    );
  }
  if (input.unmatchedCaseIds.length > 0) {
    findings.push(`${input.unmatchedCaseIds.length} case(s) exist in only one run and were excluded from case-level comparison.`);
  }

  for (const delta of input.metricDeltas) {
    if (delta.severity === 'neutral') continue;
    findings.push(`${describeSeverity(delta.severity)} ${formatMetricDelta(delta)}`);
  }

  if (input.newFailures.length > 0) {
    findings.push(
      `${input.newFailures.length} previously passing case(s) now fail: ${input.newFailures.map((t) => t.caseId).join(', ')}`,
    );
  }
  if (input.newPasses.length > 0) {
    findings.push(
      `${input.newPasses.length} previously failing case(s) now pass: ${input.newPasses.map((t) => t.caseId).join(', ')}`,
    );
  }
  if (input.newFailures.length > input.policy.maxNewFailures) {
    findings.push(
      `New failures (${input.newFailures.length}) exceed the configured limit of ${input.policy.maxNewFailures}.`,
    );
  }

  return findings;
}

function describeSeverity(severity: MetricDelta['severity']): string {
  switch (severity) {
    case 'regression':
      return 'REGRESSION';
    case 'tradeoff':
      return 'TRADEOFF';
    case 'improvement':
      return 'IMPROVEMENT';
    default:
      return 'NEUTRAL';
  }
}

/** Percentage points for ratios, human units for latency and cost. */
export function formatMetricDelta(delta: MetricDelta): string {
  const sign = delta.delta >= 0 ? '+' : '';
  if (delta.metric === 'meanLatencyMs') {
    const relative = delta.relativeDelta === null ? '' : ` (${sign}${(delta.relativeDelta * 100).toFixed(0)}%)`;
    return `${delta.metric}: ${(delta.baseline / 1000).toFixed(2)}s → ${(delta.candidate / 1000).toFixed(2)}s${relative}`;
  }
  if (delta.metric === 'meanCostUsd') {
    const relative = delta.relativeDelta === null ? '' : ` (${sign}${(delta.relativeDelta * 100).toFixed(0)}%)`;
    return `${delta.metric}: $${delta.baseline.toFixed(4)} → $${delta.candidate.toFixed(4)}${relative}`;
  }
  return `${delta.metric}: ${(delta.baseline * 100).toFixed(1)}% → ${(delta.candidate * 100).toFixed(1)}% (${sign}${(delta.delta * 100).toFixed(1)} pts)`;
}
