import { NextResponse } from 'next/server';
import { runStore } from '../../../../../lib/runs/store';
import { effectivePassed } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';

/**
 * Export a run as JSON or CSV.
 *
 * CSV exists because the person who has to sign off on shipping a workflow
 * usually reads spreadsheets, not JSON.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await context.params;
  const format = new URL(request.url).searchParams.get('format') ?? 'json';

  let run;
  try {
    run = await runStore.get(runId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 });
  }
  if (!run) return NextResponse.json({ error: `Run "${runId}" not found` }, { status: 404 });

  if (format === 'csv') {
    const header = [
      'run_id', 'workflow_version', 'case_id', 'category', 'status', 'human_review',
      'overall', 'correctness', 'groundedness', 'completeness',
      'latency_ms', 'input_tokens', 'output_tokens', 'estimated_cost_usd',
      'input', 'expected', 'actual', 'failure_reasons',
    ];
    const rows = run.results.map((result) => [
      run.id, run.workflowVersion, result.caseId, result.category,
      effectivePassed(result) ? 'pass' : 'fail', result.review?.verdict ?? '',
      result.scores.overall, result.scores.correctness.score, result.scores.groundedness.score,
      result.scores.completeness.score, result.latencyMs, result.usage.inputTokens,
      result.usage.outputTokens, result.costUsd.toFixed(6),
      result.input, result.expected, result.actual, result.failureReasons.join(' | '),
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${run.id}.csv"`,
      },
    });
  }

  return new NextResponse(JSON.stringify(run, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${run.id}.json"`,
    },
  });
}

/** RFC 4180 quoting: answers contain commas, quotes and newlines. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
