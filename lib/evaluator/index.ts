import crypto from 'node:crypto';
import type { DatasetBundle } from '../datasets';
import { estimateCostUsd } from '../cost';
import type { Judge } from '../judge/types';
import type { LLMProvider } from '../providers/types';
import { ProviderError } from '../providers/types';
import { scoreCase } from '../scoring';
import type { CaseResult, EvalCase, Run, RunConfig, RunSummary, Workflow } from '../types';
import { effectivePassed } from '../types';
import { renderContext, retrieve } from '../workflows/retrieval';

export interface EvaluationProgress {
  completed: number;
  total: number;
  caseId: string;
  passed: boolean;
}

export interface RunEvaluationOptions {
  bundle: DatasetBundle;
  workflow: Workflow;
  provider: LLMProvider;
  judge: Judge;
  config: Omit<RunConfig, 'providerId' | 'judgeId'>;
  /** Parallel in-flight cases. Keep it modest against a real provider. */
  concurrency?: number;
  onProgress?: (progress: EvaluationProgress) => void;
  notes?: string;
  /** Injected in tests so run ids and timestamps are deterministic. */
  now?: () => Date;
  idFactory?: () => string;
}

/** Build the exact prompt the workflow sends for a case. */
export function renderPrompt(
  workflow: Workflow,
  testCase: EvalCase,
  bundle: DatasetBundle,
): { system: string; user: string; retrievedRefs: string[]; context: string } {
  const { snippets } = retrieve(workflow, testCase, bundle.dataset.knowledgeBase);
  const context = renderContext(snippets);

  // The system prompt is per-version and stable across cases; retrieved context
  // is per-case. Keeping the volatile half in the user message is what lets a
  // real provider cache the system prefix.
  const user = context
    ? `Reference policy excerpts:\n${context}\n\nCustomer message:\n${testCase.input}`
    : `Customer message:\n${testCase.input}`;

  return { system: workflow.systemPrompt, user, retrievedRefs: snippets.map((s) => s.id), context };
}

async function evaluateOne(
  testCase: EvalCase,
  options: RunEvaluationOptions,
): Promise<CaseResult> {
  const { workflow, bundle, provider, judge, config } = options;
  const { system, user, retrievedRefs, context } = renderPrompt(workflow, testCase, bundle);

  const base = {
    caseId: testCase.id,
    category: testCase.category,
    weight: testCase.weight,
    input: testCase.input,
    expected: testCase.expected,
    retrievedRefs,
  };

  let completion;
  try {
    completion = await withRetry(() =>
      provider.complete({
        model: workflow.model,
        system,
        user,
        maxOutputTokens: workflow.maxOutputTokens,
        fixtureKey: `${workflow.id}@${workflow.version}::${testCase.id}`,
      }),
    );
  } catch (error) {
    // One failed case must not lose the other 29. Record it, score it zero,
    // and let the summary surface `erroredCases`.
    const message = error instanceof Error ? error.message : 'unknown provider failure';
    return {
      ...base,
      actual: '',
      latencyMs: 0,
      usage: { inputTokens: 0, outputTokens: 0, estimated: true },
      costUsd: 0,
      scores: {
        correctness: { score: 0, rationale: 'provider call failed', details: {} },
        groundedness: { score: 0, rationale: 'provider call failed', details: {} },
        completeness: { score: 0, rationale: 'provider call failed', details: {} },
        overall: 0,
      },
      passed: false,
      failureReasons: [`Provider error: ${message}`],
      error: message,
    };
  }

  const verdict = await judge.judge({
    input: testCase.input,
    expected: testCase.expected,
    actual: completion.text,
    keyPoints: testCase.keyPoints,
  });

  const { scores, passed, failureReasons } = scoreCase({
    testCase,
    actual: completion.text,
    // The customer's own message counts as grounding: repeating a number the
    // customer supplied is not a hallucination.
    groundingContext: `${context}\n${testCase.input}`,
    verdict,
    weights: config.weights,
    passThreshold: config.passThreshold,
  });

  return {
    ...base,
    actual: completion.text,
    latencyMs: completion.latencyMs,
    usage: completion.usage,
    costUsd: estimateCostUsd(completion.model, completion.usage),
    scores,
    passed,
    failureReasons: verdict.degraded
      ? [...failureReasons, `Judge degraded to fallback: ${verdict.rationale}`]
      : failureReasons,
  };
}

/** Retry only errors the provider marked retryable (rate limits, 5xx, network). */
async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!(error instanceof ProviderError) || !error.retryable || attempt === attempts - 1) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a workflow across every case in a dataset and produce a complete,
 * self-contained Run.
 *
 * A Run embeds everything needed to reproduce and audit it: the prompts' inputs,
 * the outputs, the scores, the config and the dataset hash. That is what makes
 * "compare run 11 to run 12" a real answer rather than a vibe.
 */
export async function runEvaluation(options: RunEvaluationOptions): Promise<Run> {
  const { bundle, workflow, provider, judge, config } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = Date.now();
  const cases = bundle.dataset.cases;
  const results = new Array<CaseResult>(cases.length);

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, cases.length));
  let cursor = 0;
  let completed = 0;

  // Bounded worker pool. Results are written back by index so the run order
  // always matches the dataset order regardless of completion order.
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= cases.length) return;
      const testCase = cases[index];
      if (!testCase) return;
      const result = await evaluateOne(testCase, options);
      results[index] = result;
      completed += 1;
      options.onProgress?.({ completed, total: cases.length, caseId: result.caseId, passed: result.passed });
    }
  });

  await Promise.all(workers);

  const materialised = results.filter((result): result is CaseResult => Boolean(result));

  return {
    id: options.idFactory?.() ?? `run_${crypto.randomUUID().slice(0, 8)}`,
    label: `${workflow.id}@${workflow.version}`,
    createdAt: now().toISOString(),
    datasetId: bundle.dataset.id,
    datasetName: bundle.dataset.name,
    datasetHash: bundle.hash,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    config: { ...config, providerId: provider.id, judgeId: judge.id },
    results: materialised,
    summary: summarise(materialised),
    durationMs: Date.now() - startedAt,
    notes: options.notes ?? '',
  };
}

/**
 * Aggregate case results into a run summary.
 *
 * Quality metrics are weighted by `case.weight` (a payment-policy case can
 * matter more than a greeting); latency and cost are plain means, because
 * weighting an operational cost by business importance would be nonsense.
 * Human overrides are honoured in pass/fail but never rewrite the model scores.
 */
export function summarise(results: CaseResult[]): RunSummary {
  const empty: RunSummary = {
    totalCases: 0, passedCases: 0, failedCases: 0, erroredCases: 0, reviewedCases: 0,
    passRate: 0, correctness: 0, groundedness: 0, completeness: 0, overall: 0,
    meanLatencyMs: 0, p95LatencyMs: 0, totalCostUsd: 0, meanCostUsd: 0, byCategory: {},
  };
  if (results.length === 0) return empty;

  const totalWeight = results.reduce((sum, result) => sum + result.weight, 0);
  const weightedMean = (pick: (result: CaseResult) => number): number =>
    round(results.reduce((sum, result) => sum + pick(result) * result.weight, 0) / totalWeight);

  const passed = results.filter(effectivePassed);
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const totalCost = results.reduce((sum, result) => sum + result.costUsd, 0);

  const byCategory: RunSummary['byCategory'] = {};
  for (const result of results) {
    const bucket = byCategory[result.category] ?? { total: 0, passed: 0, overall: 0 };
    bucket.total += 1;
    if (effectivePassed(result)) bucket.passed += 1;
    bucket.overall += result.scores.overall;
    byCategory[result.category] = bucket;
  }
  for (const bucket of Object.values(byCategory)) {
    bucket.overall = round(bucket.overall / bucket.total);
  }

  return {
    totalCases: results.length,
    passedCases: passed.length,
    failedCases: results.length - passed.length,
    erroredCases: results.filter((result) => result.error).length,
    reviewedCases: results.filter((result) => result.review).length,
    passRate: round(passed.length / results.length),
    correctness: weightedMean((result) => result.scores.correctness.score),
    groundedness: weightedMean((result) => result.scores.groundedness.score),
    completeness: weightedMean((result) => result.scores.completeness.score),
    overall: weightedMean((result) => result.scores.overall),
    meanLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p95LatencyMs: percentile(latencies, 0.95),
    totalCostUsd: totalCost,
    meanCostUsd: totalCost / results.length,
    byCategory,
  };
}

/** Nearest-rank p95 on an already-sorted array. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
