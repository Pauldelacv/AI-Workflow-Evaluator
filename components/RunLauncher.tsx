'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Triggers an evaluation run and navigates to the result.
 *
 * The run is executed synchronously by the API route. With the recorded
 * provider a full 30-case run takes well under a second, and a real provider
 * run takes under a minute at concurrency 4. A job queue would be the right
 * answer at 1000 cases; it is not the right answer here, and pretending
 * otherwise would be the kind of complexity this project is arguing against.
 */
export function RunLauncher({
  datasetId,
  workflowVersion,
}: {
  datasetId: string;
  workflowVersion: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ datasetId, workflowVersion }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : `Run failed with status ${response.status}`;
        throw new Error(message);
      }
      const runId = (payload as { run: { id: string } }).run.id;
      startTransition(() => {
        router.push(`/runs/${runId}`);
        router.refresh();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void launch()}
        disabled={busy}
        className="inline-flex items-center rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
      >
        {busy ? 'Running...' : 'Run'}
      </button>
      {error ? <span className="max-w-48 text-right text-xs text-rose-600 dark:text-rose-400">{error}</span> : null}
    </div>
  );
}
