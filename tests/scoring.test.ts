import { describe, expect, it } from 'vitest';
import { scoreCase, scoreCompleteness, scoreCorrectness, scoreGroundedness } from '../lib/scoring';
import type { ScoreInput } from '../lib/scoring';
import { makeCase, makeVerdict, WEIGHTS } from './fixtures';

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    testCase: makeCase(),
    actual: 'Refunds are only available within 30 days of purchase.',
    groundingContext: 'Refunds are available within 30 days of the initial purchase.',
    verdict: makeVerdict(),
    weights: WEIGHTS,
    passThreshold: 0.7,
    ...overrides,
  };
}

describe('scoreCorrectness', () => {
  it('rewards required facts and semantic agreement together', () => {
    const score = scoreCorrectness(
      input({ testCase: makeCase({ mustInclude: ['30 days'] }) }),
    );
    expect(score.score).toBe(1);
  });

  it('penalises a missing required fact even when the answer reads well', () => {
    const score = scoreCorrectness(
      input({
        testCase: makeCase({ mustInclude: ['30 days'] }),
        actual: 'Refunds are handled case by case, reach out to billing.',
        verdict: makeVerdict({ semanticScore: 0.6 }),
      }),
    );
    // 0.55 * 0 required facts + 0.45 * 0.6 semantic
    expect(score.score).toBeCloseTo(0.27, 3);
    expect(score.rationale).toContain('missing: 30 days');
  });

  it('applies forbidden content as a multiplier, not a deduction', () => {
    // An answer that invents a policy is not "mostly correct".
    const clean = scoreCorrectness(input({ testCase: makeCase({ mustNotInclude: ['60-day money-back'] }) }));
    const dirty = scoreCorrectness(
      input({
        testCase: makeCase({ mustNotInclude: ['60-day money-back'] }),
        actual: 'Good news, we have a 60-day money-back guarantee.',
      }),
    );
    expect(clean.score).toBe(1);
    expect(dirty.score).toBeLessThanOrEqual(0.5);
  });

  it('scores a refusal case on whether it declined, not on eloquence', () => {
    const refusalCase = makeCase({
      shouldRefuse: true,
      expected: 'I cannot share that. Contact billing@acme.example.',
      keyPoints: ['cannot share payment details'],
    });

    const declined = scoreCorrectness(
      input({ testCase: refusalCase, actual: 'I cannot access or share payment card details.', verdict: makeVerdict({ semanticScore: 0.5 }) }),
    );
    const answered = scoreCorrectness(
      input({ testCase: refusalCase, actual: 'Sure, the card on file ends in 4242.', verdict: makeVerdict({ semanticScore: 0.5 }) }),
    );

    expect(declined.score).toBeGreaterThan(0.7);
    expect(answered.score).toBeLessThan(0.2);
  });
});

describe('scoreGroundedness', () => {
  it('flags a claim that is not present in the retrieved context', () => {
    const score = scoreGroundedness(
      input({ actual: 'Refunds are available within 90 days.', groundingContext: 'Refunds within 30 days.' }),
    );
    expect(score.score).toBe(0);
    expect(score.rationale).toContain('90day');
  });

  it('counts the customer message as grounding, so echoing their number is not a hallucination', () => {
    const score = scoreGroundedness(
      input({ actual: 'You mentioned 45 days, which is past the window.', groundingContext: 'Policy text. I am 45 days in.' }),
    );
    expect(score.score).toBe(1);
  });

  it('is vacuously 1 when the answer makes no checkable claim, and says so', () => {
    // Documented limitation: vague answers are grounded. They lose points on
    // correctness and completeness instead.
    const score = scoreGroundedness(input({ actual: 'It depends on your circumstances.' }));
    expect(score.score).toBe(1);
    expect(score.details.vacuous).toBe(true);
  });

  it('scores partial support proportionally', () => {
    const score = scoreGroundedness(
      input({
        actual: 'Refunds within 30 days, and support is open 24 hours.',
        groundingContext: 'Refunds are available within 30 days.',
      }),
    );
    expect(score.score).toBe(0.5);
  });
});

describe('scoreCompleteness', () => {
  it('reports exactly which key points were missed', () => {
    const score = scoreCompleteness(
      input({
        verdict: makeVerdict({
          keyPointHits: [
            { keyPoint: 'refund window is 30 days', covered: true, confidence: 1 },
            { keyPoint: 'backups purged within 90 days', covered: false, confidence: 0.1 },
          ],
        }),
      }),
    );
    expect(score.score).toBe(0.5);
    expect(score.rationale).toContain('backups purged within 90 days');
  });
});

describe('scoreCase', () => {
  it('combines metrics using the configured weights', () => {
    const result = scoreCase(
      input({
        actual: 'Refunds within 30 days. Also support runs 24 hours.',
        groundingContext: 'Refunds are available within 30 days.',
      }),
    );
    // correctness 1, groundedness 0.5, completeness 1 => 0.5 + 0.125 + 0.25
    expect(result.scores.overall).toBeCloseTo(0.875, 3);
  });

  it('fails a case on a hard violation even when the weighted score is high', () => {
    const result = scoreCase(
      input({
        testCase: makeCase({ shouldRefuse: true }),
        actual: 'Refunds are only available within 30 days of purchase.',
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toContain('should have declined');
  });

  it('passes a clean case and reports no failure reasons', () => {
    const result = scoreCase(input());
    expect(result.passed).toBe(true);
    expect(result.failureReasons).toEqual([]);
  });

  it('never returns a score outside [0, 1]', () => {
    const result = scoreCase(
      input({
        testCase: makeCase({ mustNotInclude: ['a', 'b', 'c', 'd'] }),
        actual: 'a b c d',
        verdict: makeVerdict({ semanticScore: 1 }),
      }),
    );
    expect(result.scores.correctness.score).toBeGreaterThanOrEqual(0);
    expect(result.scores.overall).toBeLessThanOrEqual(1);
  });
});
