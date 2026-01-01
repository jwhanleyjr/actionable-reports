import { NextRequest, NextResponse } from 'next/server';

import { createTask } from '../../../../lib/bloomerangTasks';

export async function POST(request: NextRequest) {
  let payload: {
    constituentId?: unknown;
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

  const constituentId = Number(payload.constituentId);
  if (!Number.isFinite(constituentId)) {
    return NextResponse.json({ ok: false, error: 'constituentId is required.' }, { status: 400 });
  }

  const dueDate = typeof payload.dueDate === 'string' ? payload.dueDate.trim() : '';
  if (!dueDate) {
    return NextResponse.json({ ok: false, error: 'dueDate is required.' }, { status: 400 });
  }

  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  if (!subject) {
    return NextResponse.json({ ok: false, error: 'subject is required.' }, { status: 400 });
  }

  const note = typeof payload.note === 'string' ? payload.note : undefined;
  const channel = typeof payload.channel === 'string' ? payload.channel : undefined;
  const purpose = typeof payload.purpose === 'string' ? payload.purpose : undefined;
  const userId = Number(payload.userId);

  try {
    const result = await createTask({
      accountId: constituentId,
      dueDate,
      subject,
      note: note ?? null,
      channel: channel ?? null,
      purpose: purpose ?? null,
      userId: Number.isFinite(userId) ? userId : undefined,
    });

    return NextResponse.json({ ok: true, task: result.task, data: result.data, status: result.status });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    const bodyPreview = (error as { bodyPreview?: string })?.bodyPreview;
    const message = error instanceof Error ? error.message : 'Unable to create task.';

    return NextResponse.json({ ok: false, status, error: message, bodyPreview }, { status });
  }
}
