/**
 * Small, dependency-free text utilities shared by the scorers and the
 * heuristic judge. Everything here is deterministic - identical inputs always
 * produce identical outputs, which is what makes offline runs reproducible.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'into', 'about',
  'you', 'your', 'yours', 'we', 'our', 'ours', 'i', 'me', 'my', 'it', 'its', 'they', 'them',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'have', 'has', 'had', 'there', 'here', 'what', 'which', 'who', 'when', 'where', 'how',
  'please', 'thanks', 'thank', 'hello', 'hi',
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // `/` and `-` become separators so "/forgot-password" and "forgot password"
    // compare equal on both sides of every check.
    .replace(/[/\-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s%$€£.']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Content tokens with stop words removed and plurals folded. Used for overlap
 * scoring only - never for the literal `mustInclude` / `mustNotInclude` checks,
 * which stay exact on purpose.
 */
export function contentTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((token) => token.replace(/^[.']+|[.']+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

/**
 * Poor-man's stemmer: fold the common English inflections so "export" matches
 * "exports" and "expect" matches "expected".
 *
 * Applied identically to both sides of every comparison, so a bad stem
 * ("status" -> "statu") is harmless - it just has to be consistent. Irregular
 * forms ("saw" / "see") are not handled, which is one concrete reason the LLM
 * judge exists.
 */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) {
    return token.endsWith('es') && token.length > 4 ? token.slice(0, -2) : token.slice(0, -1);
  }
  return token;
}

export function tokenSet(text: string): Set<string> {
  return new Set(contentTokens(text));
}

/**
 * Symmetric token-overlap F1. A blunt instrument, deliberately: it is fast,
 * explainable and never disagrees with itself. The LLM judge is the semantic
 * upgrade path, see docs/evaluation.md.
 */
export function tokenF1(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  if (intersection === 0) return 0;

  const precision = intersection / left.size;
  const recall = intersection / right.size;
  return (2 * precision * recall) / (precision + recall);
}

/** Fraction of `needle`'s content tokens present in `haystack`. */
export function coverage(needle: string, haystack: string): number {
  const needed = tokenSet(needle);
  if (needed.size === 0) return 1;
  const available = tokenSet(haystack);
  let hits = 0;
  for (const token of needed) if (available.has(token)) hits += 1;
  return hits / needed.size;
}

/**
 * Literal containment check used by `mustInclude` / `mustNotInclude`.
 *
 * Both sides are normalised so punctuation and casing don't cause false
 * negatives. A phrase that normalises to nothing (e.g. "?") falls back to a raw
 * substring match - otherwise the assertion would silently always pass, which
 * is the worst possible failure mode for a test assertion.
 */
export function includesPhrase(haystack: string, phrase: string): boolean {
  const needle = normalize(phrase);
  if (needle.length === 0) return haystack.toLowerCase().includes(phrase.toLowerCase());
  return normalize(haystack).includes(needle);
}

/**
 * Checkable claims: numbers with a unit or currency, plus bare percentages.
 * These are the parts of a support answer that are objectively right or wrong,
 * and the parts an LLM most often invents.
 */
const CLAIM_PATTERN =
  /(?:\$|€|£)\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\s?(?:days?|day|hours?|hrs?|months?|month|weeks?|week|years?|seats?|users?|gb|mb|business days?)\b|\b\d{2}:\d{2}\b/gi;

export function extractClaims(text: string): string[] {
  const matches = text.match(CLAIM_PATTERN) ?? [];
  const seen = new Set<string>();
  const claims: string[] = [];
  for (const match of matches) {
    const claim = canonicalClaim(match);
    if (!seen.has(claim)) {
      seen.add(claim);
      claims.push(claim);
    }
  }
  return claims;
}

/** Normalise a claim so "30 days", "30 Days" and "30days" compare equal. */
export function canonicalClaim(claim: string): string {
  return claim
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/(days?|day)$/, 'day')
    .replace(/(hours?|hrs?)$/, 'hour')
    .replace(/(months?)$/, 'month')
    .replace(/(weeks?)$/, 'week')
    .replace(/(years?)$/, 'year')
    .replace(/(seats?)$/, 'seat')
    .replace(/(users?)$/, 'user')
    .replace(/businessday$/, 'day')
    .replace(/\.0+$/, '');
}

/**
 * Refusal patterns.
 *
 * These are regexes, not substrings, and that matters: an early version matched
 * literal phrases like "cannot share" and scored "I cannot access or share
 * payment card details" as a non-refusal, failing every correctly declined
 * case. Real refusals put words between the verb and the object, so the
 * patterns allow a short gap.
 */
const REFUSAL_PATTERNS: readonly RegExp[] = [
  // "I can't access or share ...", "I'm not able to issue ..."
  /\b(?:i|we)\s*(?:'m|'re| am| are)?\s*(?:can(?:no|')?t|cannot|do(?:n'|\s+no)?t|(?:am|are)\s+(?:not\s+able|unable)|(?:not\s+able|unable))\s+(?:to\s+)?(?:\w+\s+){0,3}(?:access|share|provide|disclose|issue|help|do|give|confirm|apply|extend|edit|reveal|discuss|assist|perform|reissue|update|create|write)\b/,
  // "that's outside what I can help with", "this is beyond what I can do"
  /\b(?:outside|beyond)\s+(?:what|the\s+scope|my|acme)\b/,
  /\bout\s+of\s+scope\b/,
  // "that's not something I can help with"
  /\bnot\s+something\s+(?:i|we)\s+can\b/,
  // "I don't have access to that", "I don't have that information"
  /\b(?:i|we)\s+(?:do\s*n(?:o|')t|don't)\s+have\s+(?:access|that|the|any|those|this)\b/,
  // "I can't help with that"
  /\b(?:can(?:no|')?t|cannot)\s+help\s+(?:with|you\s+with)\b/,
];

/**
 * Heuristic: does the answer decline or escalate rather than assert an answer?
 *
 * Used only for cases marked `shouldRefuse`. False negatives are the dangerous
 * direction here (a correct refusal scored as a failure), which is why the
 * patterns are permissive about intervening words.
 */
export function looksLikeRefusal(text: string): boolean {
  const normalized = normalize(text);
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function truncate(text: string, max = 160): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
