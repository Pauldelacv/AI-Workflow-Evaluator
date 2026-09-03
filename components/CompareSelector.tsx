'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RunIndexEntry } from '../lib/runs/store';

/** Two selects and a button. The comparison itself is rendered on the server. */
export function CompareSelector({
  runs,
  baselineId,
  candidateId,
}: {
  runs: RunIndexEntry[];
  baselineId?: string;
  candidateId?: string;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(baselineId ?? runs[1]?.id ?? '');
  const [candidate, setCandidate] = useState(candidateId ?? runs[0]?.id ?? '');

  const label = (run: RunIndexEntry) =>
    `${run.workflowVersion} · ${run.id} · ${(run.overall * 100).toFixed(0)}%`;

  const selectClass =
    'w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-950';

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Baseline</span>
        <select value={baseline} onChange={(event) => setBaseline(event.target.value)} className={selectClass}>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {label(run)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Candidate</span>
        <select value={candidate} onChange={(event) => setCandidate(event.target.value)} className={selectClass}>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {label(run)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        disabled={!baseline || !candidate || baseline === candidate}
        onClick={() => router.push(`/compare?baseline=${baseline}&candidate=${candidate}`)}
        className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800"
      >
        Compare
      </button>
    </div>
  );
}
