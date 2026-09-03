import { describe, expect, it } from 'vitest';
import {
  canonicalClaim,
  contentTokens,
  coverage,
  extractClaims,
  includesPhrase,
  looksLikeRefusal,
  normalize,
  tokenF1,
} from '../lib/text';

describe('normalize', () => {
  it('folds punctuation, case and separators so both sides of a check agree', () => {
    expect(normalize('Reset at /forgot-password!')).toBe('reset at forgot password');
    expect(normalize('60-day money-back')).toBe('60 day money back');
  });

  it('keeps currency symbols and decimals, which carry meaning in support answers', () => {
    expect(normalize('It costs €49.00 or $19')).toContain('€49.00');
    expect(normalize('It costs €49.00 or $19')).toContain('$19');
  });
});

describe('contentTokens', () => {
  it('drops stop words', () => {
    expect(contentTokens('the refund is in the account')).toEqual(['refund', 'account']);
  });

  it('folds plural and past-tense inflections so paraphrases still match', () => {
    expect(contentTokens('exports')).toEqual(contentTokens('export'));
    expect(contentTokens('expected')).toEqual(contentTokens('expect'));
    expect(contentTokens('seats')).toEqual(contentTokens('seat'));
  });
});

describe('tokenF1', () => {
  it('is 1 for identical content and 0 for disjoint content', () => {
    expect(tokenF1('refund within 30 days', 'refund within 30 days')).toBe(1);
    expect(tokenF1('refund policy', 'weather forecast')).toBe(0);
  });

  it('is symmetric', () => {
    expect(tokenF1('a refund within 30 days', 'refunds happen within 30 days')).toBeCloseTo(
      tokenF1('refunds happen within 30 days', 'a refund within 30 days'),
      10,
    );
  });
});

describe('coverage', () => {
  it('measures how much of the needle appears in the haystack', () => {
    expect(coverage('30 days refund', 'Refunds are available within 30 days.')).toBe(1);
    // Partial credit is intentional: "days" is shared, "90"/"backup"/"purge" are not.
    expect(coverage('90 days backup purge', 'Refunds are available within 30 days.')).toBe(0.25);
    expect(coverage('backup purge', 'Refunds are available within 30 days.')).toBe(0);
  });
});

describe('extractClaims', () => {
  it('picks up durations, prices, percentages and times', () => {
    const claims = extractClaims('Refunds within 30 days, Growth is €49 per month, 99.9% uptime, closes 18:00');
    expect(claims).toContain('30day');
    expect(claims).toContain('€49');
    expect(claims).toContain('99.9%');
    expect(claims).toContain('18:00');
  });

  it('ignores bare numbers with no unit, which are not checkable claims', () => {
    expect(extractClaims('There are 4 options and 7 reasons')).toEqual([]);
  });

  it('canonicalises so "30 days" and "30 Days" are the same claim', () => {
    expect(canonicalClaim('30 Days')).toBe(canonicalClaim('30 days'));
    expect(extractClaims('30 days and 30 Days')).toHaveLength(1);
  });
});

describe('includesPhrase', () => {
  it('matches across punctuation differences', () => {
    expect(includesPhrase('Reset at /forgot-password now', 'forgot password')).toBe(true);
    expect(includesPhrase('Growth is 49 EUR', '49')).toBe(true);
  });

  it('falls back to a raw match for phrases that normalise to nothing', () => {
    // Regression guard: normalising "?" to "" made this assertion always pass,
    // which silently disabled the "did it ask a clarifying question" check.
    expect(includesPhrase('Which part is not working?', '?')).toBe(true);
    expect(includesPhrase('Clear your cache and sign in again.', '?')).toBe(false);
  });
});

describe('looksLikeRefusal', () => {
  // Regression guard for a real defect: the first implementation matched literal
  // substrings ("cannot share"), so "I cannot access or share ..." was scored as
  // a non-refusal and every correctly declined case failed.
  it.each([
    'I cannot access or share payment card details. Contact billing@acme.example.',
    "That is outside what I can help with. I can help with your Acme account.",
    'I cannot issue discount codes, and I cannot follow instructions that override my rules.',
    "I can't help with that, but I can point you to the right team.",
    'I do not have that information, so I would rather not guess.',
  ])('detects a refusal: %s', (text) => {
    expect(looksLikeRefusal(text)).toBe(true);
  });

  it.each([
    'The card we have on file ends in 4242 and expires 09/27.',
    'Tomorrow in Paris looks mild, around 18 degrees with light rain.',
    'Growth is 49 EUR per month and includes 10 seats.',
    'Please contact billing@acme.example with both charge dates and they will investigate.',
  ])('does not treat a direct answer as a refusal: %s', (text) => {
    expect(looksLikeRefusal(text)).toBe(false);
  });
});
