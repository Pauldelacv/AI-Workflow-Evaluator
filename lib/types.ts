import { z } from 'zod';

/**
 * Every schema in this file is the single source of truth for a persisted or
 * user-authored artefact. Datasets and workflows are hand-edited JSON, so they
 * are parsed (never cast) at every entry point: CLI, API route and test.
 */

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

/**
 * Case categories exist so failures can be sliced by *kind* of question.
 * "My accuracy dropped 5 points" is not actionable; "my accuracy dropped 5
 * points and all of it is in `out-of-scope`" is.
 */
export const CaseCategory = z.enum([
  'straightforward',
  'ambiguous',
  'edge-case',
  'policy',
  'out-of-scope',
  'adversarial',
  'hallucination-bait',
  'precision',
]);
export type CaseCategory = z.infer<typeof CaseCategory>;

export const KnowledgeSnippet = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  /** Keywords used by the naive retriever. Kept explicit so retrieval is inspectable. */
  keywords: z.array(z.string().min(1)).default([]),
});
export type KnowledgeSnippet = z.infer<typeof KnowledgeSnippet>;

export const EvalCase = z
  .object({
    id: z.string().min(1),
    input: z.string().min(1),
    /** Reference answer. Used by the judge and shown in failure analysis. */
    expected: z.string().min(1),
    category: CaseCategory,
    /**
     * Atomic facts the answer must convey. Drives the completeness metric and
     * produces the "what was missing" line in failure analysis.
     */
    keyPoints: z.array(z.string().min(1)).min(1),
    /** Literal strings that must appear (case-insensitive). Deterministic gate. */
    mustInclude: z.array(z.string().min(1)).default([]),
    /** Literal strings that must NOT appear. Catches known hallucinations. */
    mustNotInclude: z.array(z.string().min(1)).default([]),
    /** Knowledge snippets that support the expected answer. */
    groundingRefs: z.array(z.string().min(1)).default([]),
    /** True when the correct behaviour is to decline / escalate rather than answer. */
    shouldRefuse: z.boolean().default(false),
    /** Relative importance in the aggregate score. */
    weight: z.number().positive().max(10).default(1),
    notes: z.string().optional(),
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

export const Dataset = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    knowledgeBase: z.array(KnowledgeSnippet).default([]),
    cases: z.array(EvalCase).min(1),
  })
  .strict()
  .superRefine((dataset, ctx) => {
    const seenCases = new Set<string>();
    for (const [index, testCase] of dataset.cases.entries()) {
      if (seenCases.has(testCase.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cases', index, 'id'],
          message: `Duplicate case id "${testCase.id}"`,
        });
      }
      seenCases.add(testCase.id);
    }

    const snippetIds = new Set(dataset.knowledgeBase.map((snippet) => snippet.id));
    for (const [index, testCase] of dataset.cases.entries()) {
      for (const ref of testCase.groundingRefs) {
        if (!snippetIds.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['cases', index, 'groundingRefs'],
            message: `Case "${testCase.id}" references unknown knowledge snippet "${ref}"`,
          });
        }
      }
    }

    const seenSnippets = new Set<string>();
    for (const [index, snippet] of dataset.knowledgeBase.entries()) {
      if (seenSnippets.has(snippet.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['knowledgeBase', index, 'id'],
          message: `Duplicate knowledge snippet id "${snippet.id}"`,
        });
      }
      seenSnippets.add(snippet.id);
    }
  });
export type Dataset = z.infer<typeof Dataset>;

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

/**
 * How much of the knowledge base the workflow sees.
 * This is a real behavioural difference between versions, not just prompt text:
 * `none` is why v1 hallucinates policy numbers.
 */
export const RetrievalStrategy = z.enum(['none', 'keyword', 'all']);
export type RetrievalStrategy = z.infer<typeof RetrievalStrategy>;

export const Workflow = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    description: z.string().default(''),
    /** Model id passed to the provider. Ignored by the mock provider. */
    model: z.string().min(1),
    systemPrompt: z.string().min(1),
    retrieval: RetrievalStrategy,
    /** Max snippets injected when retrieval is `keyword`. */
    retrievalTopK: z.number().int().positive().max(20).default(3),
    maxOutputTokens: z.number().int().positive().max(8192).default(512),
    changelog: z.string().default(''),
  })
  .strict();
export type Workflow = z.infer<typeof Workflow>;

/** Stable identity of a workflow revision, used as the run label. */
export function workflowKey(workflow: Pick<Workflow, 'id' | 'version'>): string {
  return `${workflow.id}@${workflow.version}`;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const MetricName = z.enum(['correctness', 'groundedness', 'completeness', 'overall']);
export type MetricName = z.infer<typeof MetricName>;

export const MetricScore = z.object({
  score: z.number().min(0).max(1),
  /** Human-readable justification. Always populated - this is what makes failures diagnosable. */
  rationale: z.string(),
  /** Machine-readable detail used by the case-detail view. */
  details: z.record(z.unknown()).default({}),
});
export type MetricScore = z.infer<typeof MetricScore>;

export const CaseScores = z.object({
  correctness: MetricScore,
  groundedness: MetricScore,
  completeness: MetricScore,
  /** Weighted aggregate of the three metrics above. */
  overall: z.number().min(0).max(1),
});
export type CaseScores = z.infer<typeof CaseScores>;

export const TokenUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** True when token counts are estimated locally rather than reported by the provider. */
  estimated: z.boolean(),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const HumanReview = z.object({
  verdict: z.enum(['accept', 'reject']),
  comment: z.string().default(''),
  reviewer: z.string().default('anonymous'),
  reviewedAt: z.string().datetime(),
});
export type HumanReview = z.infer<typeof HumanReview>;

export const CaseResult = z.object({
  caseId: z.string(),
  category: CaseCategory,
  /** Copied from the case so a Run stays self-describing after the dataset moves on. */
  weight: z.number().positive(),
  input: z.string(),
  expected: z.string(),
  actual: z.string(),
  /** Knowledge snippet ids actually injected into the prompt for this case. */
  retrievedRefs: z.array(z.string()),
  latencyMs: z.number().nonnegative(),
  usage: TokenUsage,
  costUsd: z.number().nonnegative(),
  scores: CaseScores,
  /** Automated pass/fail, before any human override. */
  passed: z.boolean(),
  failureReasons: z.array(z.string()),
  /** Set when the provider call itself failed; the case is scored 0 and marked failed. */
  error: z.string().optional(),
  review: HumanReview.optional(),
});
export type CaseResult = z.infer<typeof CaseResult>;

/** Effective pass/fail: a human verdict always wins over the automated one. */
export function effectivePassed(result: CaseResult): boolean {
  if (result.review) return result.review.verdict === 'accept';
  return result.passed;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const RunSummary = z.object({
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  erroredCases: z.number().int().nonnegative(),
  /** Cases whose automated verdict was overridden by a human. */
  reviewedCases: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  correctness: z.number().min(0).max(1),
  groundedness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  meanLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  meanCostUsd: z.number().nonnegative(),
  byCategory: z.record(
    z.object({
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      overall: z.number().min(0).max(1),
    }),
  ),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const ScoringWeights = z.object({
  correctness: z.number().min(0).max(1),
  groundedness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
});
export type ScoringWeights = z.infer<typeof ScoringWeights>;

export const RunConfig = z.object({
  weights: ScoringWeights,
  /** A case passes when its overall score reaches this threshold. */
  passThreshold: z.number().min(0).max(1),
  providerId: z.string(),
  judgeId: z.string(),
  seed: z.number().int().nonnegative(),
});
export type RunConfig = z.infer<typeof RunConfig>;

export const Run = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    createdAt: z.string().datetime(),
    datasetId: z.string(),
    datasetName: z.string(),
    /** Content hash of the dataset. Comparing runs across different hashes is flagged. */
    datasetHash: z.string(),
    workflowId: z.string(),
    workflowVersion: z.string(),
    config: RunConfig,
    results: z.array(CaseResult),
    summary: RunSummary,
    durationMs: z.number().nonnegative(),
    notes: z.string().default(''),
  })
  .strict();
export type Run = z.infer<typeof Run>;

// ---------------------------------------------------------------------------
// Regression detection
// ---------------------------------------------------------------------------

/** Which direction counts as an improvement for a given metric. */
export const MetricDirection = z.enum(['higher-is-better', 'lower-is-better']);
export type MetricDirection = z.infer<typeof MetricDirection>;

export const MetricThreshold = z.object({
  direction: MetricDirection,
  /**
   * Tolerated movement in the wrong direction before it counts as a regression.
   * Quality metrics use absolute percentage points; latency/cost use a relative
   * fraction, because "+0.03s" and "+30%" mean very different things.
   */
  mode: z.enum(['absolute-points', 'relative']),
  tolerance: z.number().nonnegative(),
  /** Blocking metrics fail CI. Non-blocking ones are reported as tradeoffs. */
  blocking: z.boolean(),
});
export type MetricThreshold = z.infer<typeof MetricThreshold>;

export const RegressionPolicy = z.object({
  metrics: z.record(MetricThreshold),
  /** How many previously-passing cases may newly fail before the run is blocked. */
  maxNewFailures: z.number().int().nonnegative(),
});
export type RegressionPolicy = z.infer<typeof RegressionPolicy>;

export type FindingSeverity = 'regression' | 'improvement' | 'tradeoff' | 'neutral';

export interface MetricDelta {
  metric: string;
  baseline: number;
  candidate: number;
  delta: number;
  /** Relative change vs baseline; null when the baseline is 0. */
  relativeDelta: number | null;
  direction: MetricDirection;
  severity: FindingSeverity;
  blocking: boolean;
  /** True when the movement exceeded the configured tolerance in the wrong direction. */
  breachedThreshold: boolean;
}

export interface CaseTransition {
  caseId: string;
  category: CaseCategory;
  baselineScore: number;
  candidateScore: number;
}

export type RegressionVerdict = 'improved' | 'regressed' | 'mixed' | 'neutral';

export interface RegressionReport {
  baselineRunId: string;
  candidateRunId: string;
  /** True when the two runs used different dataset content - deltas are not comparable. */
  datasetMismatch: boolean;
  /** Cases present in only one of the runs; excluded from case-level transitions. */
  unmatchedCaseIds: string[];
  metricDeltas: MetricDelta[];
  newFailures: CaseTransition[];
  newPasses: CaseTransition[];
  verdict: RegressionVerdict;
  /** True when a blocking threshold was breached. Drives the CLI exit code. */
  blocked: boolean;
  findings: string[];
}
