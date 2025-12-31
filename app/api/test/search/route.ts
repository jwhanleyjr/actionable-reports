import { NextResponse } from 'next/server';

import { BloomerangRequestError } from '@/lib/bloomerang';

function getApiKey(): string {
  const apiKey = process.env.BLOOMERANG_API_KEY;
  if (!apiKey) {
    throw new Error('BLOOMERANG_API_KEY is not set');
  }
  return apiKey;
}

function getBaseUrl(): string {
  const baseUrl = process.env.BLOOMERANG_BASE_URL;
  if (!baseUrl) {
    throw new Error('BLOOMERANG_BASE_URL is not set');
  }
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function buildSearchUrl(accountNumber: string): string {
  const url = new URL('constituents/search', getBaseUrl());
  url.searchParams.set('skip', '0');
  url.searchParams.set('take', '10');
  url.searchParams.set('search', accountNumber);
  return url.toString();
}

function extractResults(payload: unknown): any[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    if (Array.isArray((payload as Record<string, unknown>).Results)) {
      return (payload as { Results: any[] }).Results;
    }

    if (Array.isArray((payload as Record<string, unknown>).results)) {
      return (payload as { results: any[] }).results;
    }

    if (Array.isArray((payload as Record<string, unknown>).items)) {
      return (payload as { items: any[] }).items;
    }
  }

  return [];
}

function normalizeAccountNumber(value: unknown): string {
  return String(value ?? '').trim();
}

function deriveTotalFiltered(payload: unknown): number | null {
  if (payload && typeof payload === 'object') {
    const total =
      (payload as Record<string, unknown>).TotalFiltered ??
      (payload as Record<string, unknown>).totalFiltered ??
      (payload as Record<string, unknown>).TotalCount ??
      (payload as Record<string, unknown>).totalCount;

    if (typeof total === 'number' && Number.isFinite(total)) {
      return total;
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawAccountNumber = typeof body.accountNumber === 'string' ? body.accountNumber : '';
    const accountNumber = normalizeAccountNumber(rawAccountNumber);

    if (!accountNumber) {
      return NextResponse.json({ error: 'accountNumber is required' }, { status: 400 });
    }

    const searchUrl = buildSearchUrl(accountNumber);
    const headers = new Headers();
    headers.set('X-API-KEY', getApiKey());
    headers.set('Accept', 'application/json');

    const response = await fetch(searchUrl, { headers });

    const contentType = response.headers.get('content-type');
    console.log('Bloomerang search response', { url: searchUrl, status: response.status, contentType });

    const payload = await response.json().catch(async () => {
      const fallbackText = await response.text().catch(() => '');
      throw new BloomerangRequestError('Unable to parse Bloomerang response as JSON', searchUrl, response.status, fallbackText);
    });

    const results = extractResults(payload);
    const totalFiltered = deriveTotalFiltered(payload);

    const topResults = results.slice(0, 10).map((result) => ({
      id:
        (result && typeof result === 'object' && (result as Record<string, unknown>).Id) ??
        (result && typeof result === 'object' && (result as Record<string, unknown>).id) ??
        null,
      accountNumber:
        (result && typeof result === 'object' && (result as Record<string, unknown>).AccountNumber) ??
        (result && typeof result === 'object' && (result as Record<string, unknown>).accountNumber) ??
        null,
      fullName:
        (result && typeof result === 'object' && (result as Record<string, unknown>).FullName) ??
        (result && typeof result === 'object' && (result as Record<string, unknown>).fullName) ??
        null,
    }));

    const requestAccount = normalizeAccountNumber(accountNumber);
    const exactMatch = results.find((result) => {
      const accountValue =
        (result && typeof result === 'object' && (result as Record<string, unknown>).AccountNumber) ??
        (result && typeof result === 'object' && (result as Record<string, unknown>).accountNumber) ??
        null;
      return normalizeAccountNumber(accountValue) === requestAccount;
    });

    return NextResponse.json({
      requested: accountNumber,
      status: response.status,
      totalFiltered,
      topResults,
      ...(exactMatch
        ? {
            exactMatch: {
              id:
                (exactMatch && typeof exactMatch === 'object' && (exactMatch as Record<string, unknown>).Id) ??
                (exactMatch && typeof exactMatch === 'object' && (exactMatch as Record<string, unknown>).id) ??
                null,
              accountNumber:
                (exactMatch && typeof exactMatch === 'object' && (exactMatch as Record<string, unknown>).AccountNumber) ??
                (exactMatch && typeof exactMatch === 'object' && (exactMatch as Record<string, unknown>).accountNumber) ??
                null,
              fullName:
                (exactMatch && typeof exactMatch === 'object' && (exactMatch as Record<string, unknown>).FullName) ??
                (exactMatch && typeof exactMatch === 'object' && (exactMatch as Record<string, unknown>).fullName) ??
                null,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error('Bloomerang test search failed', error);
    if (error instanceof BloomerangRequestError) {
      return NextResponse.json(
        {
          error: error.message,
          status: error.status,
          url: error.url,
          bodySnippet: error.bodySnippet,
          contentType: error.contentType,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ error: 'Unable to run test search' }, { status: 500 });
  }
}
