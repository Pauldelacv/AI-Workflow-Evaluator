import { NextResponse } from 'next/server';
import { runStore } from '../../../../lib/runs/store';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await context.params;
  try {
    const run = await runStore.get(runId);
    if (!run) return NextResponse.json({ error: `Run "${runId}" not found` }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await context.params;
  try {
    const deleted = await runStore.delete(runId);
    return NextResponse.json({ deleted }, { status: deleted ? 200 : 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 400 });
  }
}
