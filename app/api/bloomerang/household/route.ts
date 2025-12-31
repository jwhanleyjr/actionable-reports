import { NextRequest, NextResponse } from 'next/server';

type HeaderMode = 'both' | 'x-only' | 'auth-only';

function buildHeaders(mode: HeaderMode, apiKey: string) {
  const headers = new Headers();
  headers.set('Accept', 'application/json');

  if (mode === 'both' || mode === 'x-only') {
    headers.set('X-Api-Key', apiKey);
  }

  if (mode === 'both' || mode === 'auth-only') {
    headers.set('Authorization', `ApiKey ${apiKey}`);
  }

  return headers;
}

export async function POST(request: NextRequest) {
  let payload: { householdId?: unknown };

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid JSON body.',
    }, { status: 400 });
  }

  const householdId = typeof payload.householdId === 'number'
    ? payload.householdId
    : Number(payload.householdId);

  if (!Number.isFinite(householdId)) {
    return NextResponse.json({
      ok: false,
      error: 'householdId must be a number.',
    }, { status: 400 });
  }

  const apiKey = process.env.BLOOMERANG_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: 'BLOOMERANG_API_KEY is not configured.',
    }, { status: 500 });
  }

  const url = new URL(`https://api.bloomerang.co/v2/household/${householdId}`);

  const modes: HeaderMode[] = ['both', 'x-only', 'auth-only'];

  for (const mode of modes) {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(mode, apiKey),
    });

    const contentType = response.headers.get('content-type');
    const bodyText = await response.text();

    console.log('Bloomerang household response', {
      url: url.toString(),
      status: response.status,
      contentType,
      headerMode: mode,
    });

    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && mode !== modes[modes.length - 1]) {
        continue;
      }

      const error = response.status === 404 ? 'Household not found' : undefined;

      return NextResponse.json({
        ok: false,
        url: url.toString(),
        status: response.status,
        contentType,
        error,
        bodyPreview: bodyText.slice(0, 300),
      }, { status: response.status });
    }

    try {
      const data = JSON.parse(bodyText);

      return NextResponse.json({
        ok: true,
        url: url.toString(),
        status: response.status,
        contentType,
        data,
      }, { status: response.status });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        url: url.toString(),
        status: response.status,
        contentType,
        error: 'Failed to parse JSON from Bloomerang.',
        bodyPreview: bodyText.slice(0, 300),
      }, { status: 502 });
    }
  }

  return NextResponse.json({
    ok: false,
    url: url.toString(),
    error: 'Unable to complete Bloomerang household lookup.',
  }, { status: 502 });
}
