import Link from 'next/link';
import { runStore } from '../../lib/runs/store';
import { pct, seconds, timestamp, usd } from '../../lib/display';
import { Badge, EmptyState, Panel, ScoreBar, Table, Td, Th } from '../../components/ui';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const runs = await runStore.list();

  return (
    <Panel title="Run history" description="Every evaluation, newest first. Pick any two to compare.">
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          hint="npm run eval -- run acme-support v1-baseline --baseline none"
        />
      ) : (
        <Table
          head={
            <tr>
              <Th>Run</Th>
              <Th>Workflow</Th>
              <Th>Dataset</Th>
              <Th right>Overall</Th>
              <Th right>Pass</Th>
              <Th right>Latency</Th>
              <Th right>Cost / case</Th>
              <Th right>Created</Th>
            </tr>
          }
        >
          {runs.map((run, index) => {
            const previous = runs[index + 1];
            return (
              <tr key={run.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
                <Td mono>
                  <Link className="underline underline-offset-2" href={`/runs/${run.id}`}>
                    {run.id}
                  </Link>
                  {previous ? (
                    <Link
                      className="ml-2 text-stone-400 underline underline-offset-2 hover:text-stone-700 dark:hover:text-stone-200"
                      href={`/compare?baseline=${previous.id}&candidate=${run.id}`}
                    >
                      diff
                    </Link>
                  ) : null}
                </Td>
                <Td>
                  {run.workflowVersion}{' '}
                  {run.providerId === 'mock' ? <Badge tone="info">recorded</Badge> : <Badge tone="neutral">live</Badge>}
                </Td>
                <Td mono>
                  {run.datasetId}
                  <span className="text-stone-400">@{run.datasetHash}</span>
                </Td>
                <Td right>
                  <div className="flex justify-end">
                    <ScoreBar score={run.overall} />
                  </div>
                </Td>
                <Td right mono>{pct(run.passRate, 0)}</Td>
                <Td right mono>{seconds(run.meanLatencyMs)}</Td>
                <Td right mono>{usd(run.meanCostUsd)}</Td>
                <Td right mono>{timestamp(run.createdAt)}</Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Panel>
  );
}
