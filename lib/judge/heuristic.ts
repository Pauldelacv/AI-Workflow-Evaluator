import { canonicalClaim, coverage, extractClaims, tokenF1 } from '../text';
import type { Judge, JudgeInput, JudgeVerdict, KeyPointHit } from './types';

/** A key point counts as covered above this token-coverage ratio. */
const KEY_POINT_THRESHOLD = 0.6;

/** Unit of a claim, e.g. "30day" -> "day". Used to spot contradictions. */
function claimUnit(claim: string): string {
  const match = claim.match(/[a-z%$€£]+$|^[$€£]/);
  return match ? match[0] : '';
}

function claimValue(claim: string): string {
  return claim.replace(/[^\d.]/g, '');
}

/**
 * Deterministic judge. No network, no API key, identical output for identical
 * input - which is what makes CI meaningful and scoring changes reviewable.
 *
 * It measures three things and combines them:
 *  - lexical agreement with the reference answer (token F1)
 *  - recall of the reference answer's *checkable claims* (numbers, durations,
 *    prices) - the parts customers actually act on
 *  - contradictions: the answer states a different value for the same unit
 *
 * It is a proxy for semantic equivalence, not semantic equivalence. It will
 * under-score a correct paraphrase that shares few tokens. See
 * docs/evaluation.md for the measured error rate against human labels.
 */
export class HeuristicJudge implements Judge {
  readonly id = 'heuristic';

  /** Async to satisfy the `Judge` interface; the work itself is synchronous. */
  judge(input: JudgeInput): Promise<JudgeVerdict> {
    return Promise.resolve(this.judgeSync(input));
  }

  judgeSync(input: JudgeInput): JudgeVerdict {
    const lexical = tokenF1(input.actual, input.expected);

    const expectedClaims = extractClaims(input.expected).map(canonicalClaim);
    const actualClaims = new Set(extractClaims(input.actual).map(canonicalClaim));

    const claimRecall =
      expectedClaims.length === 0
        ? 1
        : expectedClaims.filter((claim) => actualClaims.has(claim)).length / expectedClaims.length;

    const contradictions: string[] = [];
    for (const expectedClaim of expectedClaims) {
      if (actualClaims.has(expectedClaim)) continue;
      const unit = claimUnit(expectedClaim);
      if (!unit) continue;
      for (const actualClaim of actualClaims) {
        if (claimUnit(actualClaim) === unit && claimValue(actualClaim) !== claimValue(expectedClaim)) {
          contradictions.push(`expected "${expectedClaim}" but answer states "${actualClaim}"`);
          break;
        }
      }
    }

    const contradictionRate =
      expectedClaims.length === 0 ? 0 : Math.min(1, contradictions.length / expectedClaims.length);

    const semanticScore = clamp01((0.5 * lexical + 0.5 * claimRecall) * (1 - 0.5 * contradictionRate));

    const keyPointHits: KeyPointHit[] = input.keyPoints.map((keyPoint) => {
      const confidence = coverage(keyPoint, input.actual);
      return { keyPoint, covered: confidence >= KEY_POINT_THRESHOLD, confidence: round(confidence) };
    });

    const missed = keyPointHits.filter((hit) => !hit.covered).length;
    const rationale =
      `lexical ${round(lexical)}, claim recall ${round(claimRecall)}` +
      (contradictions.length > 0 ? `, ${contradictions.length} contradiction(s)` : '') +
      (missed > 0 ? `, ${missed}/${keyPointHits.length} key point(s) missing` : '');

    return {
      judgeId: this.id,
      semanticScore: round(semanticScore),
      keyPointHits,
      rationale,
      contradictions,
      degraded: false,
    };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
