import type { JudgeVerdict } from '../judge/types';
import { canonicalClaim, extractClaims, includesPhrase, looksLikeRefusal } from '../text';
import type { CaseScores, EvalCase, MetricScore, ScoringWeights } from '../types';

export interface ScoreInput {
  testCase: EvalCase;
  /** The workflow's answer. */
  actual: string;
  /**
   * Everything the workflow was allowed to see: retrieved knowledge snippets
   * plus the customer's own message. Groundedness is measured against this and
   * nothing else - grading against facts the workflow never had would measure
   * the dataset, not the workflow.
   */
  groundingContext: string;
  verdict: JudgeVerdict;
  weights: ScoringWeights;
  passThreshold: number;
}

export interface ScoreResult {
  scores: CaseScores;
  passed: boolean;
  failureReasons: string[];
}

/**
 * Correctness: does the answer give the customer the right outcome?
 *
 * Three signals, in decreasing order of trust:
 *  1. Hard requirements (`mustInclude` / `mustNotInclude`) - literal, auditable.
 *  2. Refusal expectation - for out-of-scope and adversarial cases the correct
 *     behaviour is to decline, and an eloquent wrong answer is worse than none.
 *  3. The judge's semantic score.
 *
 * `mustNotInclude` is multiplicative rather than additive on purpose: an answer
 * that invents a phone line is not "80% correct", it is wrong.
 */
export function scoreCorrectness(input: ScoreInput): MetricScore {
  const { testCase, actual, verdict } = input;

  const requiredHits = testCase.mustInclude.filter((phrase) => includesPhrase(actual, phrase));
  const missingRequired = testCase.mustInclude.filter((phrase) => !includesPhrase(actual, phrase));
  const forbiddenHits = testCase.mustNotInclude.filter((phrase) => includesPhrase(actual, phrase));

  const factRatio = testCase.mustInclude.length === 0 ? null : requiredHits.length / testCase.mustInclude.length;
  const refused = looksLikeRefusal(actual);

  let base: number;
  let basis: string;

  if (testCase.shouldRefuse) {
    // Declining is the primary requirement; the remainder rewards a decline
    // that also points the customer somewhere useful.
    base = refused ? 0.6 + 0.4 * verdict.semanticScore : 0.2 * verdict.semanticScore;
    basis = refused ? 'declined as expected' : 'answered a question it should have declined';
  } else if (factRatio === null) {
    base = verdict.semanticScore;
    basis = `semantic agreement ${fmt(verdict.semanticScore)}`;
  } else {
    base = 0.55 * factRatio + 0.45 * verdict.semanticScore;
    basis = `required facts ${requiredHits.length}/${testCase.mustInclude.length}, semantic ${fmt(verdict.semanticScore)}`;
  }

  const penalty = forbiddenHits.length === 0 ? 1 : Math.max(0, 1 - 0.5 * forbiddenHits.length);
  const score = clamp01(base * penalty);

  const rationale = [
    basis,
    missingRequired.length > 0 ? `missing: ${missingRequired.join(', ')}` : null,
    forbiddenHits.length > 0 ? `forbidden content: ${forbiddenHits.join(', ')}` : null,
    verdict.contradictions.length > 0 ? verdict.contradictions.join('; ') : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    score: round(score),
    rationale,
    details: { requiredHits, missingRequired, forbiddenHits, refused, semanticScore: verdict.semanticScore },
  };
}

/**
 * Groundedness: is every checkable claim traceable to what the workflow saw?
 *
 * "Checkable claim" means a number with a unit or a currency - durations,
 * prices, seat counts, percentages. Those are what customers act on and what
 * models most reliably invent.
 *
 * Known limitation: an answer with no numbers scores 1.0 by construction. Vague
 * answers are *grounded*; they lose points on correctness and completeness
 * instead. Read groundedness together with the other two, never alone.
 */
export function scoreGroundedness(input: ScoreInput): MetricScore {
  const claims = extractClaims(input.actual).map(canonicalClaim);

  if (claims.length === 0) {
    return {
      score: 1,
      rationale: 'no checkable claims in the answer (vacuously grounded)',
      details: { claims: [], unsupported: [], vacuous: true },
    };
  }

  const supportedClaims = new Set(extractClaims(input.groundingContext).map(canonicalClaim));
  const unsupported = claims.filter((claim) => !supportedClaims.has(claim));
  const score = (claims.length - unsupported.length) / claims.length;

  return {
    score: round(score),
    rationale:
      unsupported.length === 0
        ? `all ${claims.length} claim(s) supported by retrieved context`
        : `unsupported claim(s): ${unsupported.join(', ')}`,
    details: { claims, unsupported, vacuous: false },
  };
}

/** Completeness: how many of the case's key points did the answer actually cover? */
export function scoreCompleteness(input: ScoreInput): MetricScore {
  const hits = input.verdict.keyPointHits;
  if (hits.length === 0) {
    return { score: 1, rationale: 'no key points defined', details: { covered: [], missed: [] } };
  }

  const covered = hits.filter((hit) => hit.covered);
  const missed = hits.filter((hit) => !hit.covered);

  return {
    score: round(covered.length / hits.length),
    rationale:
      missed.length === 0
        ? `all ${hits.length} key point(s) covered`
        : `missing key point(s): ${missed.map((hit) => hit.keyPoint).join('; ')}`,
    details: { covered: covered.map((h) => h.keyPoint), missed: missed.map((h) => h.keyPoint) },
  };
}

/**
 * Score a case end to end.
 *
 * A case fails if its weighted score is below the pass threshold **or** if it
 * trips a hard violation. Hard violations exist because some failures should
 * never be averaged away: emitting forbidden content, or confidently answering
 * a question the workflow is not allowed to answer.
 */
export function scoreCase(input: ScoreInput): ScoreResult {
  const correctness = scoreCorrectness(input);
  const groundedness = scoreGroundedness(input);
  const completeness = scoreCompleteness(input);

  const { weights } = input;
  const weightSum = weights.correctness + weights.groundedness + weights.completeness;
  const overall =
    weightSum === 0
      ? 0
      : (correctness.score * weights.correctness +
          groundedness.score * weights.groundedness +
          completeness.score * weights.completeness) /
        weightSum;

  const forbiddenHits = (correctness.details.forbiddenHits as string[] | undefined) ?? [];
  const refused = Boolean(correctness.details.refused);

  const hardViolations: string[] = [];
  if (forbiddenHits.length > 0) {
    hardViolations.push(`Answer contains forbidden content: ${forbiddenHits.join(', ')}`);
  }
  if (input.testCase.shouldRefuse && !refused) {
    hardViolations.push('Answer should have declined or escalated, but answered instead');
  }

  const passed = hardViolations.length === 0 && overall >= input.passThreshold;

  const failureReasons = passed
    ? []
    : [
        ...hardViolations,
        ...(overall < input.passThreshold
          ? [`Overall score ${fmt(overall)} is below the ${fmt(input.passThreshold)} pass threshold`]
          : []),
        ...(correctness.score < 0.7 ? [`Correctness: ${correctness.rationale}`] : []),
        ...(groundedness.score < 0.9 ? [`Groundedness: ${groundedness.rationale}`] : []),
        ...(completeness.score < 1 ? [`Completeness: ${completeness.rationale}`] : []),
      ];

  return {
    scores: { correctness, groundedness, completeness, overall: round(overall) },
    passed,
    failureReasons,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fmt(value: number): string {
  return value.toFixed(2);
}
