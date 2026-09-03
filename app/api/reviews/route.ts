import { NextResponse } from 'next/server';
import { ApiError, ReviewRequest, applyReview, parseBody } from '../../../lib/api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json().catch(() => {
      throw new ApiError('Request body must be JSON', 400);
    });
    const run = await applyReview(parseBody(ReviewRequest, body));
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
