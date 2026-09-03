import type { MetricDelta, RegressionReport, Run } from '../lib/types';
import { effectivePassed } from '../lib/types';
import { formatMetricDelta } from '../lib/regression';
import { pct, seconds, usd } from '../lib/display';

/** Colour only when attached to a terminal, and honour NO_COLOR. CI logs stay clean. */
const useColour = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const RESET = '\u001b[0m';

function paint(code: string, text: string): string {
  return useColour ? `\u001b[${code}m${text}${RESET}` : text;
}

export const red = (t: string) => paint('31', t);
export const green = (t: string) => paint('32', t);
export const yellow = (t: string) => paint('33', t);
export const dim = (t: string) => paint('2', t);
export const bold = (t: string) => paint('1', t);

export { pct, seconds, usd };

/** Fixed-width table with a header rule. Widths are computed per column. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd();
  return [line(headers), dim(widths.map((width) => '-'.repeat(width)).join('  ')), ...rows.map(line)].join('\n');
}

export function renderRunSummary(run: Run): string {
  const s = run.summary;
  return [
    `${bold(run.id)}  ${run.label}  ${dim(run.createdAt)}`,
    `${dim('dataset')} ${run.datasetId}@${run.datasetHash}  ${dim('provider')} ${run.config.providerId}  ${dim('judge')} ${run.config.judgeId}`,
    '',
    table(
      ['metric', 'value'],
      [
        ['pass rate', `${pct(s.passRate)}  (${s.passedCases}/${s.totalCases})`],
        ['correctness', pct(s.correctness)],
        ['groundedness', pct(s.groundedness)],
        ['completeness', pct(s.completeness)],
        ['overall', pct(s.overall)],
        ['mean latency', seconds(s.meanLatencyMs)],
        ['p95 latency', seconds(s.p95LatencyMs)],
        ['mean cost/case', usd(s.meanCostUsd)],
        ['total cost', usd(s.totalCostUsd)],
        ...(s.erroredCases > 0 ? [['errored cases', red(String(s.erroredCases))]] : []),
      ],
    ),
  ].join('\n');
}

/** Per-category breakdown: where the failures actually live. */
export function renderCategoryBreakdown(run: Run): string {
  const rows = Object.entries(run.summary.byCategory)
    .sort((a, b) => a[1].overall - b[1].overall)
    .map(([category, bucket]) => [
      category,
      `${bucket.passed}/${bucket.total}`,
      pct(bucket.overall),
      bucket.passed === bucket.total ? green('ok') : red('failures'),
    ]);
  return table(['category', 'passed', 'mean score', ''], rows);
}

export function renderFailures(run: Run, limit = 10): string {
  const failures = run.results.filter((result) => !effectivePassed(result));
  if (failures.length === 0) return green('No failing cases.');

  const shown = failures.slice(0, limit);
  const blocks = shown.map((result) =>
    [
      `${bold(result.caseId.toUpperCase())} ${dim(`[${result.category}]`)}  score ${red(pct(result.scores.overall))}  ${dim(seconds(result.latencyMs))}  ${dim(usd(result.costUsd))}`,
      `  ${dim('input   ')} ${result.input}`,
      `  ${dim('expected')} ${result.expected}`,
      `  ${dim('actual  ')} ${result.actual || dim('(no output)')}`,
      ...result.failureReasons.map((reason) => `  ${red('why')}      ${reason}`),
    ].join('\n'),
  );

  const more = failures.length > shown.length ? [dim(`... and ${failures.length - shown.length} more`)] : [];
  return [...blocks, ...more].join('\n\n');
}

function severityLabel(delta: MetricDelta): string {
  switch (delta.severity) {
    case 'regression':
      return red('REGRESSION');
    case 'tradeoff':
      return yellow('TRADEOFF');
    case 'improvement':
      return green('IMPROVED');
    default:
      return dim('unchanged');
  }
}

export function renderComparison(report: RegressionReport, baseline: Run, candidate: Run): string {
  const rows = report.metricDeltas.map((delta) => [
    delta.metric,
    formatValue(delta.metric, delta.baseline),
    formatValue(delta.metric, delta.candidate),
    formatDelta(delta),
    severityLabel(delta),
  ]);

  const verdictLine =
    report.verdict === 'regressed'
      ? red('VERDICT: REGRESSED')
      : report.verdict === 'improved'
        ? green('VERDICT: IMPROVED')
        : report.verdict === 'mixed'
          ? yellow('VERDICT: MIXED - improvements and regressions in the same run')
          : dim('VERDICT: NO MEANINGFUL CHANGE');

  return [
    `${bold('baseline ')} ${baseline.id}  ${baseline.label}`,
    `${bold('candidate')} ${candidate.id}  ${candidate.label}`,
    '',
    table(['metric', 'baseline', 'candidate', 'delta', 'verdict'], rows),
    '',
    verdictLine,
    ...(report.findings.length > 0
      ? ['', ...report.findings.map((finding) => `  ${bulletFor(finding)} ${finding}`)]
      : []),
    ...(report.newFailures.length > 0
      ? [
          '',
          red(`${report.newFailures.length} newly failing case(s):`),
          ...report.newFailures.map(
            (t) => `  ${t.caseId} [${t.category}] ${pct(t.baselineScore)} -> ${pct(t.candidateScore)}`,
          ),
        ]
      : []),
    ...(report.newPasses.length > 0
      ? [
          '',
          green(`${report.newPasses.length} newly passing case(s):`),
          ...report.newPasses.map(
            (t) => `  ${t.caseId} [${t.category}] ${pct(t.baselineScore)} -> ${pct(t.candidateScore)}`,
          ),
        ]
      : []),
    '',
    report.blocked
      ? red('BLOCKED: a blocking threshold was breached.')
      : green('Not blocked by the regression policy.'),
  ].join('\n');
}

function bulletFor(finding: string): string {
  if (finding.startsWith('REGRESSION')) return red('x');
  if (finding.startsWith('TRADEOFF')) return yellow('!');
  if (finding.startsWith('IMPROVEMENT')) return green('+');
  return dim('-');
}

function formatValue(metric: string, value: number): string {
  if (metric === 'meanLatencyMs') return seconds(value);
  if (metric === 'meanCostUsd') return usd(value);
  return pct(value);
}

function formatDelta(delta: MetricDelta): string {
  const sign = delta.delta >= 0 ? '+' : '';
  if (delta.metric === 'meanLatencyMs' || delta.metric === 'meanCostUsd') {
    return delta.relativeDelta === null ? '-' : `${sign}${(delta.relativeDelta * 100).toFixed(0)}%`;
  }
  return `${sign}${(delta.delta * 100).toFixed(1)} pts`;
}

export { formatMetricDelta };
