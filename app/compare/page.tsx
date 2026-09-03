import Link from 'next/link';
import { DEFAULT_REGRESSION_POLICY } from '../../lib/config';
import { detectRegression } from '../../lib/regression';
import { runStore } from '../../lib/runs/store';
import { pct, points, relativePct, seconds, timestamp, usd } from '../../lib/display';
import type { MetricDelta } from '../../lib/types';
import { Badge, EmptyState, Panel, Table, Td, Th } from '../../components/ui';
import { CompareSelector } from '../../components/CompareSelector';

export const dynamic = 'force-dynamic';

function formatValue(metric: string, value: number): string {
  if (metric === 'meanLatencyMs') return seconds(value);
  if (metric === 'meanCostUsd') return usd(value);
  return pct(value);
}

function formatDelta(delta: MetricDelta): string {
  if (delta.metric === 'meanLatencyMs' || delta.metric === 'meanCostUsd') return relativePct(delta.relativeDelta);
  return points(delta.delta);
}

function severityBadge(severity: MetricDelta['severity']) {
  switch (severity) {
    case 'regression':
      return <Badge tone="fail">regression</Badge>;
    case 'tradeoff':
      return <Badge tone="warn">tradeoff</Badge>;
    case 'improvement':
      return <Badge tone="pass">improved</Badge>;
    default:
      return <Badge>unchanged</Badge>;
  }
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ baseline?: string; candidate?: string }>;
}) {
  const { baseline: baselineId, candidate: candidateId } = await searchParams;
  const runs = await runStore.list();

  if (runs.length < 2) {
    return (
      <Panel title="Compare runs">
        <EmptyState
          title="At least two runs are needed to compare"
          hint="Run a second workflow version, then come back. The comparison is where the tool earns its keep."
        />
      </Panel>
    );
  }

  const baseline = baselineId ? await runStore.get(baselineId).catch(() => null) : null;
  const candidate = candidateId ? await runStore.get(candidateId).catch(() => null) : null;

  if (!baseline || !candidate) {
    return (
      <Panel title="Compare runs" description="Pick a baseline and a candidate.">
        <CompareSelector runs={runs} baselineId={baselineId} candidateId={candidateId} />
      </Panel>
    );
  }

  const report = detectRegression({ baseline, candidate, policy: DEFAULT_REGRESSION_POLICY });

  const verdictTone =
    report.verdict === 'regressed' ? 'fail' : report.verdict === 'improved' ? 'pass' : report.verdict === 'mixed' ? 'warn' : 'neutral';

  return (
    <>
      <Panel title="Compare runs">
        <CompareSelector runs={runs} baselineId={baseline.id} candidateId={candidate.id} />
      </Panel>

      <Panel
        title="Verdict"
        description={`${baseline.workflowVersion} (${baseline.id}) → ${candidate.workflowVersion} (${candidate.id})`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={verdictTone}>{report.verdict}</Badge>
            {report.blocked ? <Badge tone="fail">blocked</Badge> : <Badge tone="pass">not blocked</Badge>}
          </div>
        }
      >
        <div className="space-y-2 px-4 py-3 text-sm">
          {report.datasetMismatch ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              These runs used different dataset content ({baseline.datasetHash} vs {candidate.datasetHash}). The deltas
              below mix workflow changes with dataset changes.
            </p>
          ) : null}
          {report.findings.length === 0 ? (
            <p className="text-stone-500 dark:text-stone-400">Nothing moved beyond the configured thresholds.</p>
          ) : (
            <ul className="space-y-1">
              {report.findings.map((finding) => (
                <li key={finding} className="text-stone-700 dark:text-stone-300">
                  {finding}
                </li>
              ))}
            </ul>
          )}
          <p className="pt-1 text-xs text-stone-500 dark:text-stone-400">
            A verdict of <strong>mixed</strong> means the change bought something and cost something. The tool reports
            the tradeoff; whether it is worth taking is a business call.
          </p>
        </div>
      </Panel>

      <Panel title="Metrics">
        <Table
          head={
            <tr>
              <Th>Metric</Th>
              <Th right>{baseline.workflowVersion}</Th>
              <Th right>{candidate.workflowVersion}</Th>
              <Th right>Delta</Th>
              <Th right>Verdict</Th>
            </tr>
          }
        >
          {report.metricDeltas.map((delta) => (
            <tr key={delta.metric}>
              <Td>
                {delta.metric}
                {delta.blocking ? null : <span className="ml-2 text-xs text-stone-400">non-blocking</span>}
              </Td>
              <Td right mono>{formatValue(delta.metric, delta.baseline)}</Td>
              <Td right mono>{formatValue(delta.metric, delta.candidate)}</Td>
              <Td right mono>{formatDelta(delta)}</Td>
              <Td right>{severityBadge(delta.severity)}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      {report.newFailures.length > 0 ? (
        <Panel
          title={`Newly failing cases (${report.newFailures.length})`}
          description="These passed on the baseline and fail now. This is the list that decides whether you ship."
        >
          <Table
            head={
              <tr>
                <Th>Case</Th>
                <Th>Category</Th>
                <Th right>Before</Th>
                <Th right>After</Th>
              </tr>
            }
          >
            {report.newFailures.map((transition) => (
              <tr key={transition.caseId}>
                <Td mono>
                  <Link className="underline underline-offset-2" href={`/runs/${candidate.id}/cases/${transition.caseId}`}>
                    {transition.caseId}
                  </Link>
                </Td>
                <Td>{transition.category}</Td>
                <Td right mono>{pct(transition.baselineScore)}</Td>
                <Td right mono>{pct(transition.candidateScore)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}

      {report.newPasses.length > 0 ? (
        <Panel title={`Newly passing cases (${report.newPasses.length})`}>
          <Table
            head={
              <tr>
                <Th>Case</Th>
                <Th>Category</Th>
                <Th right>Before</Th>
                <Th right>After</Th>
              </tr>
            }
          >
            {report.newPasses.map((transition) => (
              <tr key={transition.caseId}>
                <Td mono>
                  <Link className="underline underline-offset-2" href={`/runs/${candidate.id}/cases/${transition.caseId}`}>
                    {transition.caseId}
                  </Link>
                </Td>
                <Td>{transition.category}</Td>
                <Td right mono>{pct(transition.baselineScore)}</Td>
                <Td right mono>{pct(transition.candidateScore)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}

      <p className="text-xs text-stone-500 dark:text-stone-400">
        Baseline run {timestamp(baseline.createdAt)} · candidate run {timestamp(candidate.createdAt)}
      </p>
    </>
  );
}
