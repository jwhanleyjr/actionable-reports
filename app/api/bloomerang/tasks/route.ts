import { NextRequest, NextResponse } from 'next/server';

import { getActiveTasksForConstituent } from '../../../../lib/bloomerangTasks';

export async function GET(request: NextRequest) {
  const constituentIdParam = request.nextUrl.searchParams.get('constituentId');
  const constituentId = constituentIdParam ? Number(constituentIdParam) : NaN;

  if (!Number.isFinite(constituentId)) {
    return NextResponse.json({ ok: false, error: 'constituentId is required.' }, { status: 400 });
  }

  try {
    const result = await getActiveTasksForConstituent(constituentId);
    return NextResponse.json({
      ok: true,
      constituentId,
      tasks: result.tasks,
      data: result.data,
      status: result.status,
    });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    const bodyPreview = (error as { bodyPreview?: string })?.bodyPreview;
    const message = error instanceof Error ? error.message : 'Unable to load tasks.';

    return NextResponse.json({
      ok: false,
      constituentId,
      error: message,
      status,
      bodyPreview,
    }, { status });
  }
}
