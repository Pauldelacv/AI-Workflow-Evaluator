/**
 * Presentation helpers shared by the CLI and the web UI, so a number is
 * formatted identically wherever it is read.
 */

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function usd(value: number, digits = 4): string {
  return `$${value.toFixed(digits)}`;
}

export function points(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts`;
}

export function relativePct(value: number | null): string {
  if (value === null) return '-';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`;
}

/** Compact absolute timestamp - an eval tool should never say "3 hours ago" and hide when. */
export function timestamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16).concat(' UTC');
}

/** Tailwind text colour for a 0..1 score, on the same scale everywhere. */
export function scoreTone(score: number): string {
  if (score >= 0.9) return 'text-emerald-700 dark:text-emerald-400';
  if (score >= 0.7) return 'text-amber-700 dark:text-amber-400';
  return 'text-rose-700 dark:text-rose-400';
}

export function scoreBarTone(score: number): string {
  if (score >= 0.9) return 'bg-emerald-500';
  if (score >= 0.7) return 'bg-amber-500';
  return 'bg-rose-500';
}
