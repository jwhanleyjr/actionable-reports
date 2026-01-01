import { NextResponse } from 'next/server';

import { completeTask } from '../../../../../../lib/bloomerangTasks';

export async function PUT(_request: Request, { params }: { params: { id: string } }) {
  const taskId = Number(params.id);

  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ ok: false, error: 'Task id is required.' }, { status: 400 });
  }

  try {
    const result = await completeTask(taskId);
    return NextResponse.json({ ok: true, task: result.task, data: result.data, status: result.status });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    const bodyPreview = (error as { bodyPreview?: string })?.bodyPreview;
    const message = error instanceof Error ? error.message : 'Unable to complete task.';

    return NextResponse.json({ ok: false, status, error: message, bodyPreview }, { status });
  }
}
