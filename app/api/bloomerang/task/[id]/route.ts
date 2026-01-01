import { NextRequest, NextResponse } from 'next/server';

import { updateTask } from '../../../../../lib/bloomerangTasks';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const taskId = Number(params.id);

  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ ok: false, error: 'Task id is required.' }, { status: 400 });
  }

  let payload: {
    dueDate?: unknown;
    subject?: unknown;
    note?: unknown;
    channel?: unknown;
    purpose?: unknown;
    userId?: unknown;
  };

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const body = {
    dueDate: typeof payload.dueDate === 'string' ? payload.dueDate.trim() : undefined,
    subject: typeof payload.subject === 'string' ? payload.subject.trim() : undefined,
    note: typeof payload.note === 'string' ? payload.note : undefined,
    channel: typeof payload.channel === 'string' ? payload.channel : undefined,
    purpose: typeof payload.purpose === 'string' ? payload.purpose : undefined,
    userId: Number.isFinite(Number(payload.userId)) ? Number(payload.userId) : undefined,
  };

  try {
    const result = await updateTask(taskId, body);
    return NextResponse.json({ ok: true, task: result.task, data: result.data, status: result.status });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    const bodyPreview = (error as { bodyPreview?: string })?.bodyPreview;
    const message = error instanceof Error ? error.message : 'Unable to update task.';

    return NextResponse.json({ ok: false, status, error: message, bodyPreview }, { status });
  }
}
