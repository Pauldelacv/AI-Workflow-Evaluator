import Link from 'next/link';
import { notFound } from 'next/navigation';
import { runStore } from '../../../../../lib/runs/store';
import { loadDatasetBundle } from '../../../../../lib/datasets';
import { effectivePassed } from '../../../../../lib/types';
import { pct, scoreTone, seconds, usd } from '../../../../../lib/display';
import { Badge, Panel, ScoreBar } from '../../../../../components/ui';
import { ReviewForm } from '../../../../../components/ReviewForm';

export const dynamic = 'force-dynamic';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export default async function CasePage({ params }: { params: Promise<{ runId: string; caseId: string }> }) {
  const { runId, caseId } = await params;
  const run = await runStore.get(runId).catch(() => null);
  if (!run) notFound();

  const result = run.results.find((entry) => entry.caseId === caseId);
  if (!result) notFound();

  // The knowledge snippets the workflow actually saw, so the reader can judge
  // whether a groundedness failure was the model's fault or retrieval's.
  const bundle = loadDatasetBundle(run.datasetId);
  const retrieved = bundle.dataset.knowledgeBase.filter((snippet) => result.retrievedRefs.includes(snippet.id));

  const metrics = [
    { name: 'Correctness', score: result.scores.correctness },
    { name: 'Groundedness', score: result.scores.groundedness },
    { name: 'Completeness', score: result.scores.completeness },
  ];

  return (
    <>
      <div className="text-xs text-stone-500 dark:text-stone-400">
        <Link className="underline underline-offset-2" href={`/runs/${run.id}`}>
          {run.id}
        </Link>{' '}
        / {result.caseId}
      </div>

      <Panel
        title={`${result.caseId} · ${result.category}`}
        description={`${run.workflowId}@${run.workflowVersion}`}
        action={
          <div className="flex items-center gap-2">
            {effectivePassed(result) ? <Badge tone="pass">pass</Badge> : <Badge tone="fail">fail</Badge>}
            <span className={`num text-sm font-semibold ${scoreTone(result.scores.overall)}`}>
              {pct(result.scores.overall)}
            </span>
          </div>
        }
      >
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          <Field label="Customer message">{result.input}</Field>
          <Field label="Expected">{result.expected}</Field>
          <Field label="Actual output">
            {result.actual ? (
              <span>{result.actual}</span>
            ) : (
              <span className="text-rose-600 dark:text-rose-400">(no output — {result.error ?? 'unknown error'})</span>
            )}
          </Field>
          {result.failureReasons.length > 0 ? (
            <Field label="Why it failed">
              <ul className="list-disc space-y-1 pl-4 text-stone-700 dark:text-stone-300">
                {result.failureReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Field>
          ) : null}
        </div>
      </Panel>

      <Panel title="Score breakdown" description="Each metric reports the evidence behind its number.">
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {metrics.map((metric) => (
            <div key={metric.name} className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">{metric.name}</span>
                <ScoreBar score={metric.score.score} label={pct(metric.score.score)} />
              </div>
              <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{metric.score.rationale}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Execution metadata"
        description="What it cost to produce this answer."
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
          {[
            ['Latency', seconds(result.latencyMs)],
            ['Input tokens', String(result.usage.inputTokens)],
            ['Output tokens', String(result.usage.outputTokens)],
            ['Estimated cost', usd(result.costUsd, 6)],
            ['Case weight', String(result.weight)],
            ['Token counts', result.usage.estimated ? 'estimated locally' : 'reported by provider'],
            ['Provider', run.config.providerId],
            ['Judge', run.config.judgeId],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</dt>
              <dd className="num font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel
        title="Retrieved context"
        description={
          retrieved.length === 0
            ? 'Nothing was retrieved for this case. Any specific figure in the answer came from the model, not from policy.'
            : `${retrieved.length} snippet(s) were placed in the prompt.`
        }
      >
        {retrieved.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-500 dark:text-stone-400">
            No policy snippet matched this question. If the answer still failed on groundedness, the fix is retrieval,
            not the prompt.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {retrieved.map((snippet) => (
              <li key={snippet.id} className="px-4 py-3">
                <div className="font-mono text-xs text-stone-500 dark:text-stone-400">{snippet.id}</div>
                <div className="text-sm font-medium">{snippet.title}</div>
                <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-400">{snippet.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Human review" description="Automated evaluation is a proxy. This is where a human overrules it.">
        <ReviewForm
          runId={run.id}
          caseId={result.caseId}
          review={result.review}
          automatedPassed={result.passed}
        />
      </Panel>
    </>
  );
}
