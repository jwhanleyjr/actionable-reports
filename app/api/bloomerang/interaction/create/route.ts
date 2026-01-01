import { NextRequest, NextResponse } from 'next/server';

import { getBloomerangBaseUrl } from '../../../../lib/bloomerangBase';
import { buildHeaders, getApiKey } from '../../utils';

type InteractionPayload = {
  accountId: number;
  channel: string;
  purpose?: string | null;
  subject?: string | null;
  date?: string | null;
  isInbound?: boolean;
  note?: string | null;
};

export async function POST(request: NextRequest) {
  let payload: InteractionPayload;

  try {
    payload = (await request.json()) as InteractionPayload;
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const accountId = Number(payload.accountId);
  if (!Number.isFinite(accountId)) {
    return NextResponse.json({ ok: false, error: 'accountId is required and must be a number.' }, { status: 400 });
  }

  const channel = typeof payload.channel === 'string' && payload.channel.trim();
  if (!channel) {
    return NextResponse.json({ ok: false, error: 'channel is required.' }, { status: 400 });
  }

  const purpose = typeof payload.purpose === 'string' ? payload.purpose.trim() : null;
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : null;
  const note = typeof payload.note === 'string' ? payload.note.trim() : null;
  const date = typeof payload.date === 'string' ? payload.date.trim() : null;
  const isInbound = typeof payload.isInbound === 'boolean' ? payload.isInbound : undefined;

  const apiKey = getApiKey();
  const url = `${getBloomerangBaseUrl()}/interaction`;

  const body = {
    AccountId: accountId,
    Channel: channel,
    Purpose: purpose || null,
    Subject: subject || null,
    Date: date || null,
    IsInbound: typeof isInbound === 'boolean' ? isInbound : null,
    NoteText: note || null,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: (() => {
      const headers = buildHeaders('both', apiKey);
      headers.set('Content-Type', 'application/json');
      return headers;
    })(),
    body: JSON.stringify(body),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    return NextResponse.json({
      ok: false,
      status: response.status,
      url,
      bodyPreview: bodyText.slice(0, 300),
    }, { status: response.status });
  }

  try {
    const data = bodyText ? JSON.parse(bodyText) : null;
    return NextResponse.json({ ok: true, data }, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: response.status,
      url,
      bodyPreview: bodyText.slice(0, 300),
      error: 'Failed to parse interaction response.',
    }, { status: 502 });
  }
}
