import { NextResponse } from 'next/server';
import { listDatasetIds } from '../../../lib/datasets';

export const dynamic = 'force-dynamic';

/** Liveness probe for the container. Confirms datasets are readable, not just that Node is up. */
export async function GET(): Promise<NextResponse> {
  try {
    const datasets = listDatasetIds();
    return NextResponse.json({ status: 'ok', datasets });
  } catch (error) {
    return NextResponse.json(
      { status: 'degraded', error: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    );
  }
}
