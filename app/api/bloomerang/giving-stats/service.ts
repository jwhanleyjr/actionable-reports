import 'server-only';

import { fetchJsonWithModes, normalizeBoolean, pickNumber, readValue } from '../utils';

type Transaction = Record<string, unknown>;

export type GivingStats = {
  lifetimeTotal: number;
  lastYearTotal: number;
  ytdTotal: number;
  lastGiftAmount: number | null;
  lastGiftDate: string | null;
};

export type StatsDebug = { transactionCount: number; includedCount: number; requestUrls: string[] };

export type StatsResult = {
  ok: true;
  constituentId: number;
  stats: GivingStats;
  recentTransactions: Array<{ id: string | number | null; amount: number; date: string | null; type: string | null }>;
  debug: StatsDebug;
} | {
  ok: false;
  status?: number;
  url?: string;
  bodyPreview?: string;
  error?: string;
  requestUrls?: string[];
};

const INCLUDED_TYPES = new Set(['Donation', 'PledgePayment', 'RecurringDonationPayment']);
const TAKE = 50;

export async function calculateGivingStats(constituentId: number, apiKey: string): Promise<StatsResult> {
  const transactions: Transaction[] = [];
  const requestUrls: string[] = [];
  let skip = 0;

  while (true) {
    const url = new URL('https://api.bloomerang.co/v2/transactions');
    url.searchParams.set('accountId', String(constituentId));
    url.searchParams.set('skip', String(skip));
    url.searchParams.set('take', String(TAKE));
    url.searchParams.set('orderBy', 'Date');
    url.searchParams.set('orderDirection', 'Desc');

    const response = await fetchJsonWithModes(url, apiKey);

    requestUrls.push(url.toString());

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url: response.url,
        bodyPreview: response.bodyPreview,
        error: response.error,
        requestUrls,
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
    recentTransactions: stats.recentTransactions,
    debug: { ...stats.debug, requestUrls },
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
  const includedTransactions: Array<{ id: string | number | null; amount: number; date: string | null; type: string | null }> = [];

  for (const transaction of transactions) {
    if (!shouldIncludeTransaction(transaction)) {
      continue;
    }

    includedCount += 1;

    const amount = getTransactionAmount(transaction);
    lifetimeTotal += amount;

    const dateString = getTransactionDate(transaction);
    const type = getTransactionType(transaction);
    const id = getTransactionId(transaction);

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

    includedTransactions.push({
      id,
      amount,
      date: dateString,
      type,
    });
  }

  return {
    stats: {
      lifetimeTotal,
      lastYearTotal,
      ytdTotal,
      lastGiftAmount,
      lastGiftDate,
    },
    recentTransactions: includedTransactions.slice(0, 5),
    debug: {
      transactionCount: transactions.length,
      includedCount,
    },
  };
}

function shouldIncludeTransaction(transaction: Transaction) {
  const type = getTransactionType(transaction);

  if (typeof type !== 'string') {
    return false;
  }

  const normalizedType = type.trim();

  if (!normalizedType || !INCLUDED_TYPES.has(normalizedType)) {
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
    'Amount.amount',
    'Amount.Amount',
  ]);

  return amount ?? 0;
}

function getTransactionDate(transaction: Transaction) {
  const date = readValue(transaction, 'Date') ?? readValue(transaction, 'date');
  return typeof date === 'string' && date.trim() ? date : null;
}

function getTransactionType(transaction: Transaction) {
  const typeValue = readValue(transaction, 'Type')
    ?? readValue(transaction, 'type')
    ?? readValue(transaction, 'TransactionType')
    ?? readValue(transaction, 'transactionType');

  return typeof typeValue === 'string' && typeValue.trim() ? typeValue : null;
}

function getTransactionId(transaction: Transaction) {
  const id = readValue(transaction, 'Id')
    ?? readValue(transaction, 'id')
    ?? readValue(transaction, 'TransactionId')
    ?? readValue(transaction, 'transactionId');

  if (typeof id === 'string' || typeof id === 'number') {
    return id;
  }

  return null;
}
