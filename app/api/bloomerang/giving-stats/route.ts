import { NextRequest, NextResponse } from 'next/server';

import { getApiKey } from '../utils';
import { calculateGivingStats } from './service';

export async function POST(request: NextRequest) {
  let payload: { constituentId?: unknown };

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid JSON body.',
    }, { status: 400 });
  }

  const constituentId = typeof payload.constituentId === 'number'
    ? payload.constituentId
    : Number(payload.constituentId);

  if (!Number.isFinite(constituentId)) {
    return NextResponse.json({
      ok: false,
      error: 'constituentId must be a number.',
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

  const stats = await calculateGivingStats(constituentId, apiKey);

  if (!stats.ok) {
    return NextResponse.json(stats, { status: stats.status ?? 502 });
  }

  return NextResponse.json(stats);
}
