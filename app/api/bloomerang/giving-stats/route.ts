import { NextRequest, NextResponse } from 'next/server';

import { fetchJsonWithModes, getApiKey, normalizeBoolean, pickNumber, readValue } from '../utils';

type Transaction = Record<string, unknown>;

type GivingStats = {
  lifetimeTotal: number;
  lastYearTotal: number;
  ytdTotal: number;
  lastGiftAmount: number | null;
  lastGiftDate: string | null;
};

type StatsResult = {
  ok: true;
  constituentId: number;
  stats: GivingStats;
  debug: { transactionCount: number; includedCount: number };
} | {
  ok: false;
  status?: number;
  url?: string;
  bodyPreview?: string;
  error?: string;
};

const INCLUDED_TYPES = new Set(['Donation', 'PledgePayment', 'RecurringDonationPayment']);
const TAKE = 50;

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

export async function calculateGivingStats(constituentId: number, apiKey: string): Promise<StatsResult> {
  const transactions: Transaction[] = [];
  let skip = 0;

  while (true) {
    const url = new URL('https://api.bloomerang.co/v2/transactions');
    url.searchParams.set('accountId', String(constituentId));
    url.searchParams.set('skip', String(skip));
    url.searchParams.set('take', String(TAKE));
    url.searchParams.set('orderBy', 'Date');
    url.searchParams.set('orderDirection', 'Desc');

    const response = await fetchJsonWithModes(url, apiKey);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url: response.url,
        bodyPreview: response.bodyPreview,
        error: response.error,
      };
    }

    const pageResults = normalizeTransactions(response.data);
    transactions.push(...pageResults);

    if (pageResults.length < TAKE) {
      break;
    }

    skip += TAKE;
  }

  const stats = summarizeTransactions(transactions);

  return {
    ok: true,
    constituentId,
    stats: stats.stats,
    debug: stats.debug,
  };
}

function normalizeTransactions(data: unknown): Transaction[] {
  if (Array.isArray((data as { Results?: unknown[] })?.Results)) {
    return ((data as { Results: unknown[] }).Results).filter((entry): entry is Transaction => !!entry && typeof entry === 'object');
  }

  if (Array.isArray(data)) {
    return (data as unknown[]).filter((entry): entry is Transaction => !!entry && typeof entry === 'object');
  }

  return [];
}

function summarizeTransactions(transactions: Transaction[]) {
  const now = new Date();
  const currentYearStart = new Date(now.getFullYear(), 0, 1);
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);

  let lifetimeTotal = 0;
  let lastYearTotal = 0;
  let ytdTotal = 0;
  let lastGiftAmount: number | null = null;
  let lastGiftDate: string | null = null;
  let includedCount = 0;

  for (const transaction of transactions) {
    if (!shouldIncludeTransaction(transaction)) {
      continue;
    }

    includedCount += 1;

    const amount = getTransactionAmount(transaction);
    lifetimeTotal += amount;

    const dateString = getTransactionDate(transaction);

    if (dateString) {
      const transactionDate = new Date(dateString);

      if (!Number.isNaN(transactionDate.getTime())) {
        if (transactionDate >= lastYearStart && transactionDate <= lastYearEnd) {
          lastYearTotal += amount;
        }

        if (transactionDate >= currentYearStart && transactionDate <= now) {
          ytdTotal += amount;
        }

        if (!lastGiftDate || new Date(lastGiftDate) < transactionDate) {
          lastGiftDate = transactionDate.toISOString();
          lastGiftAmount = amount;
        }
      }
    }
  }

  return {
    stats: {
      lifetimeTotal,
      lastYearTotal,
      ytdTotal,
      lastGiftAmount,
      lastGiftDate,
    },
    debug: {
      transactionCount: transactions.length,
      includedCount,
    },
  };
}

function shouldIncludeTransaction(transaction: Transaction) {
  const type = readValue(transaction, 'Type') ?? readValue(transaction, 'type');

  if (typeof type !== 'string' || !INCLUDED_TYPES.has(type)) {
    return false;
  }

  const refundFlag = readValue(transaction, 'IsRefunded') ?? readValue(transaction, 'isRefunded');
  const refundIds = readValue(transaction, 'RefundIds') ?? readValue(transaction, 'refundIds');

  if (typeof refundFlag === 'string' && refundFlag.trim().toLowerCase() === 'yes') {
    return false;
  }

  const normalizedRefundFlag = normalizeBoolean(refundFlag);

  if (normalizedRefundFlag === true) {
    return false;
  }

  if (Array.isArray(refundIds) && refundIds.length > 0) {
    return false;
  }

  return true;
}

function getTransactionAmount(transaction: Transaction) {
  const amount = pickNumber(transaction, [
    'Amount',
    'amount',
    'Amount.Value',
    'AmountValue',
    'amountValue',
  ]);

  return amount ?? 0;
}

function getTransactionDate(transaction: Transaction) {
  const date = readValue(transaction, 'Date') ?? readValue(transaction, 'date');
  return typeof date === 'string' && date.trim() ? date : null;
}
