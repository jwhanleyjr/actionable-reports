import 'server-only';

import { fetchJsonWithModes, normalizeBoolean, pickNumber, readValue } from '../utils';

export type Transaction = Record<string, unknown>;

export type TransactionDesignation = {
  fundName: string | null;
  campaignName: string | null;
  appealName: string | null;
  amount: number;
  date: string | null;
};

export type GivingStats = {
  lifetimeTotal: number;
  lastYearTotal: number;
  ytdTotal: number;
  lastGiftAmount: number | null;
  lastGiftDate: string | null;
};

export type StatsDebug = {
  transactionCount: number;
  includedCount: number;
  requestUrls: string[];
};

export type StatsResult = {
  ok: true;
  constituentId: number;
  stats: GivingStats;
  debug: StatsDebug;
} | {
  ok: false;
  status?: number;
  url?: string;
  bodyPreview?: string;
  error?: string;
  requestUrls?: string[];
};

export type TransactionsResult = {
  ok: true;
  constituentId: number;
  transactions: Transaction[];
  requestUrls: string[];
} | {
  ok: false;
  status?: number;
  url?: string;
  bodyPreview?: string;
  error?: string;
  requestUrls: string[];
};

const INCLUDED_TYPES = new Set(['Donation', 'PledgePayment', 'RecurringDonationPayment']);
const TAKE = 50;

export async function calculateGivingStats(constituentId: number, apiKey: string): Promise<StatsResult> {
  const transactionsResult = await fetchTransactionsForConstituent(constituentId, apiKey);

  if (!transactionsResult.ok) {
    return { ...transactionsResult, ok: false };
  }

  const summary = summarizeTransactions(transactionsResult.transactions);

  return {
    ok: true,
    constituentId,
    stats: summary.stats,
    debug: { ...summary.debug, requestUrls: transactionsResult.requestUrls },
  };
}

export async function fetchTransactionsForConstituent(
  constituentId: number,
  apiKey: string,
): Promise<TransactionsResult> {
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

  return { ok: true as const, constituentId, transactions, requestUrls };
}

function normalizeTransactions(data: unknown): Transaction[] {
  const attemptNormalize = (value: unknown): Transaction[] => {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is Transaction => !!entry && typeof entry === 'object');
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const keys = ['Results', 'results', 'Transactions', 'transactions', 'Items', 'items'];

      for (const key of keys) {
        const nested = record[key];
        const normalized = attemptNormalize(nested);

        if (normalized.length) {
          return normalized;
        }
      }

      if (record.Data && typeof record.Data === 'object') {
        const normalized = attemptNormalize(record.Data);
        if (normalized.length) {
          return normalized;
        }
      }
    }

    return [];
  };

  return attemptNormalize(data);
}

export function summarizeTransactions(transactions: Transaction[]) {
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
  const designationDetails: TransactionDesignation[] = [];

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

    const designations = extractDesignationEntries(transaction, dateString);
    designationDetails.push(...designations);
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
    designations: designationDetails,
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

  if (typeof amount === 'number' && !Number.isNaN(amount)) {
    return amount;
  }

  const designations = readValue(transaction, 'Designations');

  if (Array.isArray(designations) && designations.length > 0) {
    const designationAmount = pickNumber(designations[0] as Transaction, [
      'Amount',
      'amount',
      'AmountValue',
      'amountValue',
      'Amount.Amount',
    ]);

    if (typeof designationAmount === 'number' && !Number.isNaN(designationAmount)) {
      return designationAmount;
    }
  }

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

  if (typeof typeValue === 'string' && typeValue.trim()) {
    return typeValue;
  }

  const designations = readValue(transaction, 'Designations');

  if (Array.isArray(designations) && designations.length > 0) {
    const designationType = readValue(designations[0] as Transaction, 'Type')
      ?? readValue(designations[0] as Transaction, 'type');

    if (typeof designationType === 'string' && designationType.trim()) {
      return designationType;
    }
  }

  return null;
}

function extractDesignationEntries(transaction: Transaction, fallbackDate: string | null): TransactionDesignation[] {
  const designations = readValue(transaction, 'Designations');

  if (!Array.isArray(designations) || !designations.length) {
    return [];
  }

  return designations
    .map((designation) => {
      if (!designation || typeof designation !== 'object') {
        return null;
      }

      const fundName = normalizeName(readValue(designation as Transaction, 'Fund.Name'))
        ?? normalizeName(readValue(designation as Transaction, 'FundName'));
      const campaignName = normalizeName(readValue(designation as Transaction, 'Campaign.Name'))
        ?? normalizeName(readValue(designation as Transaction, 'CampaignName'));
      const appealName = normalizeName(readValue(designation as Transaction, 'Appeal.Name'))
        ?? normalizeName(readValue(designation as Transaction, 'AppealName'));
      const amount = pickNumber(designation as Transaction, [
        'Amount',
        'amount',
        'AmountValue',
        'amountValue',
        'Amount.Amount',
      ]) ?? getTransactionAmount(transaction);
      const date = getTransactionDate(transaction) ?? fallbackDate;

      if (!fundName && !campaignName && !appealName && !amount) {
        return null;
      }

      return {
        fundName: fundName ?? null,
        campaignName: campaignName ?? null,
        appealName: appealName ?? null,
        amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : 0,
        date: typeof date === 'string' && date.trim() ? date : null,
      } satisfies TransactionDesignation;
    })
    .filter((entry): entry is TransactionDesignation => Boolean(entry));
}

function normalizeName(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

