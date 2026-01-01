import { NextRequest, NextResponse } from 'next/server';

import { getBloomerangBaseUrl } from '../../../../../lib/bloomerangBase';
import { fetchJsonWithModes, getApiKey, pickNumber, pickString } from '../../utils';

function mapUserProfile(data: Record<string, unknown> | null | undefined) {
  const source = data ?? {};

  return {
    id: pickNumber(source, ['Id', 'id']),
    userName: pickString(source, ['UserName', 'userName']),
    name: pickString(source, ['Name', 'name']),
    email: pickString(source, ['Email', 'email']),
    bccEmail: pickString(source, ['BccEmail', 'bccEmail']),
  };
}

export async function GET(request: NextRequest) {
  const baseUrl = getBloomerangBaseUrl();
  const url = new URL(`${baseUrl}/user/current`);

  const incomingAuth = request.headers.get('authorization');

  if (incomingAuth) {
    const response = await fetch(url, {
      headers: (() => {
        const headers = new Headers();
        headers.set('Accept', 'application/json');
        headers.set('Authorization', incomingAuth);
        return headers;
      })(),
    });

    const contentType = response.headers.get('content-type');
    const bodyText = await response.text();

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        url: url.toString(),
        status: response.status,
        contentType,
        bodyPreview: bodyText.slice(0, 300),
      }, { status: response.status });
    }

    try {
      const data = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};
      return NextResponse.json({
        ok: true,
        url: url.toString(),
        status: response.status,
        contentType,
        user: mapUserProfile(data),
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

  let apiKey: string;

  try {
    apiKey = getApiKey();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'BLOOMERANG_API_KEY is not configured.',
    }, { status: 500 });
  }

  const result = await fetchJsonWithModes(url, apiKey);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status ?? 502 });
  }

  const data = result.data as Record<string, unknown> | null | undefined;

  return NextResponse.json({
    ok: true,
    url: result.url,
    status: result.status,
    contentType: result.contentType,
    user: mapUserProfile(data ?? {}),
  }, { status: result.status });
}
