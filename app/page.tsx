import Link from 'next/link';
import { DEFAULT_REGRESSION_POLICY } from '../lib/config';
import { listDatasetIds, loadDatasetBundle } from '../lib/datasets';
import { detectRegression } from '../lib/regression';
import { runStore } from '../lib/runs/store';
import { pct, scoreTone, seconds, timestamp, usd } from '../lib/display';
import { Badge, EmptyState, LinkButton, Metric, Panel, ScoreBar, Table, Td, Th } from '../components/ui';
import { RunLauncher } from '../components/RunLauncher';

// Runs are read from disk on every request; there is nothing to cache and a
// stale dashboard in an eval tool is worse than a slow one.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const datasetIds = listDatasetIds();
  const bundles = datasetIds.map((id) => loadDatasetBundle(id));
  const runs = await runStore.list({ limit: 10 });

  // Latest run per workflow version, so the dashboard answers "where does each
  // version stand right now".
  const latestByWorkflow = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    const key = `${run.workflowId}@${run.workflowVersion}`;
    if (!latestByWorkflow.has(key)) latestByWorkflow.set(key, run);
  }

  const newest = runs[0];
  const previous = runs.find((run) => run.id !== newest?.id && run.workflowVersion !== newest?.workflowVersion);

  // The dashboard's job is to answer one question on sight: did the last change
  // make this workflow better? A score with no baseline cannot answer it.
  const verdict =
    newest && previous
      ? await (async () => {
          const [baselineRun, candidateRun] = await Promise.all([
            runStore.get(previous.id),
            runStore.get(newest.id),
          ]);
          if (!baselineRun || !candidateRun) return null;
          return detectRegression({
            baseline: baselineRun,
            candidate: candidateRun,
            policy: DEFAULT_REGRESSION_POLICY,
          });
        })()
      : null;

  return (
    <>
      {newest ? (
        <Panel
          title="Latest run"
          description={`${newest.workflowId}@${newest.workflowVersion} on ${newest.datasetId}`}
          action={<LinkButton href={`/runs/${newest.id}`}>Open run</LinkButton>}
        >
          <div className="grid grid-cols-2 divide-x divide-stone-100 sm:grid-cols-4 dark:divide-stone-800">
            <Metric label="Overall" value={pct(newest.overall)} tone={scoreTone(newest.overall)} />
            <Metric label="Pass rate" value={pct(newest.passRate)} sub={`${newest.totalCases} cases`} />
            <Metric label="Mean latency" value={seconds(newest.meanLatencyMs)} />
            <Metric label="Cost / case" value={usd(newest.meanCostUsd)} />
          </div>
          {verdict && previous ? (
            <div
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-xs ${
                verdict.blocked
                  ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200'
                  : 'border-stone-100 text-stone-600 dark:border-stone-800 dark:text-stone-400'
              }`}
            >
              <Badge tone={verdict.blocked ? 'fail' : verdict.verdict === 'improved' ? 'pass' : 'warn'}>
                {verdict.blocked ? 'regression blocked' : verdict.verdict}
              </Badge>
              <span>
                vs {previous.workflowVersion}
                {verdict.newFailures.length > 0
                  ? `: ${verdict.newFailures.length} previously passing case(s) now fail (${verdict.newFailures
                      .map((transition) => transition.caseId)
                      .join(', ')})`
                  : ': no case-level regressions'}
              </span>
              <Link
                className="underline underline-offset-2 hover:opacity-80"
                href={`/compare?baseline=${previous.id}&candidate=${newest.id}`}
              >
                See the full comparison
              </Link>
            </div>
          ) : previous ? (
            <div className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
              <Link
                className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
                href={`/compare?baseline=${previous.id}&candidate=${newest.id}`}
              >
                Compare against {previous.workflowVersion} ({previous.id})
              </Link>
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Workflows" description="Latest recorded score for each version under evaluation.">
        {bundles.length === 0 ? (
          <EmptyState title="No datasets found" hint="Add a dataset under examples/<id>/dataset.json." />
        ) : (
          <Table
            head={
              <tr>
                <Th>Version</Th>
                <Th>Retrieval</Th>
                <Th>Model</Th>
                <Th right>Overall</Th>
                <Th right>Pass</Th>
                <Th right>Cost / case</Th>
                <Th right>Run</Th>
              </tr>
            }
          >
            {bundles.flatMap((bundle) =>
              bundle.workflows.map((workflow) => {
                const latest = latestByWorkflow.get(`${workflow.id}@${workflow.version}`);
                return (
                  <tr key={`${bundle.dataset.id}-${workflow.version}`} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
                    <Td>
                      <div className="font-medium">{workflow.version}</div>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{workflow.description}</div>
                    </Td>
                    <Td mono>
                      {workflow.retrieval}
                      {workflow.retrieval === 'keyword' ? `/${workflow.retrievalTopK}` : ''}
                    </Td>
                    <Td mono>{workflow.model}</Td>
                    <Td right>
                      {latest ? (
                        <div className="flex justify-end">
                          <ScoreBar score={latest.overall} />
                        </div>
                      ) : (
                        <span className="text-xs text-stone-400">never run</span>
                      )}
                    </Td>
                    <Td right mono>{latest ? pct(latest.passRate, 0) : '-'}</Td>
                    <Td right mono>{latest ? usd(latest.meanCostUsd) : '-'}</Td>
                    <Td right>
                      <RunLauncher datasetId={bundle.dataset.id} workflowVersion={workflow.version} />
                    </Td>
                  </tr>
                );
              }),
            )}
          </Table>
        )}
      </Panel>

      <Panel title="Datasets">
        <Table
          head={
            <tr>
              <Th>Dataset</Th>
              <Th right>Cases</Th>
              <Th right>Knowledge</Th>
              <Th right>Content hash</Th>
            </tr>
          }
        >
          {bundles.map((bundle) => (
            <tr key={bundle.dataset.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
              <Td>
                <Link className="font-medium underline underline-offset-2" href={`/datasets/${bundle.dataset.id}`}>
                  {bundle.dataset.name}
                </Link>
                <div className="text-xs text-stone-500 dark:text-stone-400">{bundle.dataset.description}</div>
              </Td>
              <Td right mono>{bundle.dataset.cases.length}</Td>
              <Td right mono>{bundle.dataset.knowledgeBase.length}</Td>
              <Td right mono>{bundle.hash}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="Recent runs"
        action={runs.length > 0 ? <LinkButton href="/runs">All runs</LinkButton> : undefined}
      >
        {runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            hint="Run a workflow from the table above, or from the command line: npm run eval -- run acme-support v1-baseline"
          />
        ) : (
          <Table
            head={
              <tr>
                <Th>Run</Th>
                <Th>Workflow</Th>
                <Th right>Overall</Th>
                <Th right>Pass</Th>
                <Th right>Latency</Th>
                <Th right>When</Th>
              </tr>
            }
          >
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
                <Td mono>
                  <Link className="underline underline-offset-2" href={`/runs/${run.id}`}>
                    {run.id}
                  </Link>
                </Td>
                <Td>
                  {run.workflowVersion}{' '}
                  {run.providerId === 'mock' ? <Badge tone="info">recorded</Badge> : <Badge tone="neutral">live</Badge>}
                </Td>
                <Td right>
                  <div className="flex justify-end">
                    <ScoreBar score={run.overall} />
                  </div>
                </Td>
                <Td right mono>{pct(run.passRate, 0)}</Td>
                <Td right mono>{seconds(run.meanLatencyMs)}</Td>
                <Td right mono>{timestamp(run.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
