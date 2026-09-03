import Link from 'next/link';
import { notFound } from 'next/navigation';
import { runStore } from '../../../lib/runs/store';
import { effectivePassed } from '../../../lib/types';
import { pct, scoreTone, seconds, timestamp, usd } from '../../../lib/display';
import { Badge, LinkButton, Metric, Panel, ScoreBar, Table, Td, Th } from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await runStore.get(runId).catch(() => null);
  if (!run) notFound();

  const previous = await runStore.latestFor(run.datasetId, undefined, run.id);
  const failures = run.results.filter((result) => !effectivePassed(result));
  const summary = run.summary;

  return (
    <>
      <Panel
        title={`${run.workflowId}@${run.workflowVersion}`}
        description={`${run.id} · ${run.datasetName} · ${timestamp(run.createdAt)} · provider ${run.config.providerId} · judge ${run.config.judgeId}`}
        action={
          <div className="flex gap-2">
            {previous ? (
              <LinkButton href={`/compare?baseline=${previous.id}&candidate=${run.id}`}>Compare</LinkButton>
            ) : null}
            <LinkButton href={`/api/runs/${run.id}/export?format=csv`}>CSV</LinkButton>
            <LinkButton href={`/api/runs/${run.id}/export?format=json`}>JSON</LinkButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 divide-x divide-stone-100 sm:grid-cols-4 dark:divide-stone-800">
          <Metric label="Overall" value={pct(summary.overall)} tone={scoreTone(summary.overall)} />
          <Metric
            label="Pass rate"
            value={pct(summary.passRate)}
            sub={`${summary.passedCases}/${summary.totalCases} cases`}
          />
          <Metric label="Mean latency" value={seconds(summary.meanLatencyMs)} sub={`p95 ${seconds(summary.p95LatencyMs)}`} />
          <Metric label="Cost / case" value={usd(summary.meanCostUsd)} sub={`${usd(summary.totalCostUsd)} total`} />
        </div>
        <div className="grid grid-cols-3 divide-x divide-stone-100 border-t border-stone-100 dark:divide-stone-800 dark:border-stone-800">
          <Metric label="Correctness" value={pct(summary.correctness)} tone={scoreTone(summary.correctness)} />
          <Metric label="Groundedness" value={pct(summary.groundedness)} tone={scoreTone(summary.groundedness)} />
          <Metric label="Completeness" value={pct(summary.completeness)} tone={scoreTone(summary.completeness)} />
        </div>
        {run.notes ? (
          <div className="border-t border-stone-100 px-4 py-2 text-xs text-stone-600 dark:border-stone-800 dark:text-stone-400">
            {run.notes}
          </div>
        ) : null}
        {summary.reviewedCases > 0 || summary.erroredCases > 0 ? (
          <div className="flex gap-3 border-t border-stone-100 px-4 py-2 text-xs text-stone-600 dark:border-stone-800 dark:text-stone-400">
            {summary.reviewedCases > 0 ? <span>{summary.reviewedCases} case(s) with a human override</span> : null}
            {summary.erroredCases > 0 ? (
              <span className="text-rose-600 dark:text-rose-400">{summary.erroredCases} provider error(s)</span>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel title="By category" description="Where the failures actually live. Worst first.">
        <Table
          head={
            <tr>
              <Th>Category</Th>
              <Th right>Passed</Th>
              <Th right>Mean score</Th>
            </tr>
          }
        >
          {Object.entries(summary.byCategory)
            .sort((a, b) => a[1].overall - b[1].overall)
            .map(([category, bucket]) => (
              <tr key={category}>
                <Td>{category}</Td>
                <Td right mono>
                  {bucket.passed === bucket.total ? (
                    <Badge tone="pass">{bucket.passed}/{bucket.total}</Badge>
                  ) : (
                    <Badge tone="fail">{bucket.passed}/{bucket.total}</Badge>
                  )}
                </Td>
                <Td right>
                  <div className="flex justify-end">
                    <ScoreBar score={bucket.overall} />
                  </div>
                </Td>
              </tr>
            ))}
        </Table>
      </Panel>

      <Panel
        title={failures.length > 0 ? `Failing cases (${failures.length})` : 'All cases passed'}
        description={
          failures.length > 0 ? 'Click a case to see the prompt, the retrieved context and the scoring breakdown.' : undefined
        }
      >
        <Table
          head={
            <tr>
              <Th>Case</Th>
              <Th>Input</Th>
              <Th>Why it failed</Th>
              <Th right>Score</Th>
            </tr>
          }
        >
          {(failures.length > 0 ? failures : run.results.slice(0, 5)).map((result) => (
            <tr key={result.caseId} className="align-top hover:bg-stone-50 dark:hover:bg-stone-800/50">
              <Td mono>
                <Link className="underline underline-offset-2" href={`/runs/${run.id}/cases/${result.caseId}`}>
                  {result.caseId}
                </Link>
                <div className="mt-1 text-stone-500">{result.category}</div>
                {result.review ? (
                  <div className="mt-1">
                    <Badge tone={result.review.verdict === 'accept' ? 'pass' : 'fail'}>
                      human: {result.review.verdict}
                    </Badge>
                  </div>
                ) : null}
              </Td>
              <Td>
                <div className="max-w-xs text-stone-700 dark:text-stone-300">{result.input}</div>
              </Td>
              <Td>
                <ul className="max-w-md list-disc space-y-0.5 pl-4 text-xs text-stone-600 dark:text-stone-400">
                  {result.failureReasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                  {result.failureReasons.length === 0 ? <li>Passed all checks.</li> : null}
                </ul>
              </Td>
              <Td right>
                <div className="flex justify-end">
                  <ScoreBar score={result.scores.overall} />
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="All cases">
        <Table
          head={
            <tr>
              <Th>Case</Th>
              <Th>Category</Th>
              <Th right>Correct</Th>
              <Th right>Grounded</Th>
              <Th right>Complete</Th>
              <Th right>Overall</Th>
              <Th right>Latency</Th>
              <Th right>Status</Th>
            </tr>
          }
        >
          {run.results.map((result) => (
            <tr key={result.caseId} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
              <Td mono>
                <Link className="underline underline-offset-2" href={`/runs/${run.id}/cases/${result.caseId}`}>
                  {result.caseId}
                </Link>
              </Td>
              <Td>{result.category}</Td>
              <Td right mono>{pct(result.scores.correctness.score, 0)}</Td>
              <Td right mono>{pct(result.scores.groundedness.score, 0)}</Td>
              <Td right mono>{pct(result.scores.completeness.score, 0)}</Td>
              <Td right mono>{pct(result.scores.overall, 0)}</Td>
              <Td right mono>{seconds(result.latencyMs)}</Td>
              <Td right>
                {effectivePassed(result) ? <Badge tone="pass">pass</Badge> : <Badge tone="fail">fail</Badge>}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
