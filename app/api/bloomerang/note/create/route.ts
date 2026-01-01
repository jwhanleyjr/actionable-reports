import { NextRequest, NextResponse } from 'next/server';

import { getBloomerangBaseUrl } from '../../../../lib/bloomerangBase';
import { buildHeaders, getApiKey } from '../../utils';

type NotePayload = {
  accountId: number;
  date?: string;
  note?: string;
};

function isValidDateString(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export async function POST(request: NextRequest) {
  let payload: NotePayload;

  try {
    payload = (await request.json()) as NotePayload;
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const accountId = Number(payload.accountId);
  if (!Number.isFinite(accountId)) {
    return NextResponse.json({ ok: false, error: 'accountId is required and must be a number.' }, { status: 400 });
  }

  const date = payload.date?.trim();
  if (!isValidDateString(date)) {
    return NextResponse.json({ ok: false, error: 'date is required and must be in YYYY-MM-DD format.' }, { status: 400 });
  }

  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  if (!note) {
    return NextResponse.json({ ok: false, error: 'note is required.' }, { status: 400 });
  }

  const apiKey = getApiKey();
  const url = `${getBloomerangBaseUrl()}/note`;

  const body = {
    AccountId: accountId,
    Date: date,
    Note: note,
    CustomValues: [],
    Attachments: [],
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
  const contentType = response.headers.get('content-type');

  if (!response.ok) {
    return NextResponse.json({
      ok: false,
      status: response.status,
      url,
      contentType,
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
      contentType,
      bodyPreview: bodyText.slice(0, 300),
      error: 'Failed to parse note response.',
    }, { status: 502 });
  }
}
