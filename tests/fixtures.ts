import type { EvalCase, ScoringWeights } from '../lib/types';
import type { JudgeVerdict } from '../lib/judge/types';

/** Shared deterministic fixtures. Tests never reach for the real dataset. */

export const WEIGHTS: ScoringWeights = { correctness: 0.5, groundedness: 0.25, completeness: 0.25 };

export function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'case-x',
    input: 'Can I get a refund after 60 days?',
    expected: 'No. Refunds are only available within 30 days of purchase.',
    category: 'precision',
    keyPoints: ['refunds only within 30 days of purchase'],
    mustInclude: [],
    mustNotInclude: [],
    groundingRefs: [],
    shouldRefuse: false,
    weight: 1,
    ...overrides,
  };
}

export function makeVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    judgeId: 'test',
    semanticScore: 1,
    keyPointHits: [{ keyPoint: 'refunds only within 30 days of purchase', covered: true, confidence: 1 }],
    rationale: 'test verdict',
    contradictions: [],
    degraded: false,
    ...overrides,
  };
}
