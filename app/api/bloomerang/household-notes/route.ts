import { NextRequest, NextResponse } from 'next/server';

import { fetchHouseholdNotes } from '../notes/service';
import { getApiKey } from '../utils';

export async function POST(request: NextRequest) {
  let payload: { memberIds?: unknown };

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid JSON body.',
    }, { status: 400 });
  }

  const memberIds = Array.isArray(payload.memberIds)
    ? payload.memberIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];

  if (!memberIds.length) {
    return NextResponse.json({
      ok: false,
      error: 'memberIds must be a non-empty array of numbers.',
    }, { status: 400 });
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

  const result = await fetchHouseholdNotes(memberIds, apiKey);

  if (!result.ok) {
    console.error('Failed to fetch household notes', {
      memberIds,
      requestUrls: result.requestUrls,
    });

    return NextResponse.json(result, { status: result.status ?? 502 });
  }

  console.log('Household notes fetched', {
    memberIds,
    fetchedCount: result.notes.length,
    totalFetched: result.notesMeta.totalFetched,
  });

  return NextResponse.json({
    ok: true,
    notes: result.notes,
    notesMeta: {
      ...result.notesMeta,
      usedCount: result.notes.length,
    },
  });
}
