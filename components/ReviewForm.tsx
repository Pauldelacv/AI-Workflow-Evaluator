'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { HumanReview } from '../lib/types';

/**
 * Human-in-the-loop override.
 *
 * The automated score is never overwritten - the verdict is stored beside it.
 * That matters twice over: the disagreement stays auditable, and the set of
 * cases where humans overrule the judge is the data you need to decide whether
 * the judge is good enough.
 */
export function ReviewForm({
  runId,
  caseId,
  review,
  automatedPassed,
}: {
  runId: string;
  caseId: string;
  review?: HumanReview;
  automatedPassed: boolean;
}) {
  const router = useRouter();
  const [comment, setComment] = useState(review?.comment ?? '');
  const [reviewer, setReviewer] = useState(review?.reviewer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(verdict: 'accept' | 'reject' | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId,
          caseId,
          review: verdict === null ? null : { verdict, comment, reviewer: reviewer.trim() || 'anonymous' },
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw new Error(
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : `Review failed with status ${response.status}`,
        );
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Automated verdict: <strong>{automatedPassed ? 'pass' : 'fail'}</strong>. A human verdict overrides it in the
        run summary; the automated score is kept for the record.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={reviewer}
          onChange={(event) => setReviewer(event.target.value)}
          placeholder="Reviewer"
          className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-950"
        />
        <input
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Why? (e.g. technically correct but misses the main question)"
          className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-950"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit('accept')}
          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit('reject')}
          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
        >
          Reject
        </button>
        {review ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(null)}
            className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Clear override
          </button>
        ) : null}
      </div>

      {review ? (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          Current override: <strong>{review.verdict}</strong> by {review.reviewer}
          {review.comment ? ` - "${review.comment}"` : ''}
        </p>
      ) : null}
      {error ? <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
    </div>
  );
}
