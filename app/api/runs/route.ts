import { NextResponse } from 'next/server';
import { ApiError, CreateRunRequest, createRun, parseBody } from '../../../lib/api';
import { runStore } from '../../../lib/runs/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const runs = await runStore.list({
    datasetId: url.searchParams.get('datasetId') ?? undefined,
    workflowId: url.searchParams.get('workflowId') ?? undefined,
    limit: limitParam ? Number(limitParam) : undefined,
  });
  return NextResponse.json({ runs });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json().catch(() => {
      throw new ApiError('Request body must be JSON', 400);
    });
    const run = await createRun(parseBody(CreateRunRequest, body));
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Run failed' },
      { status: 500 },
    );
  }
}
