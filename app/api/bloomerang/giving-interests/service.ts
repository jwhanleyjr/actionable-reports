import 'server-only';

import { fetchTransactionsForConstituent, summarizeTransactions, TransactionDesignation } from '../giving-stats/service';

export type GivingInterest = {
  fund: string | null;
  campaign: string | null;
  appeal: string | null;
  totalAmount: number;
  giftCount: number;
  firstGiftDate: string | null;
  lastGiftDate: string | null;
};

export type HouseholdGivingInterestsResult = {
  ok: true;
  givingInterests: GivingInterest[];
  requestUrls: string[];
} | {
  ok: false;
  error: string;
  status?: number;
  requestUrls: string[];
};

export async function buildHouseholdGivingInterests(
  memberIds: number[],
  apiKey: string,
): Promise<HouseholdGivingInterestsResult> {
  const designations: TransactionDesignation[] = [];
  const requestUrls: string[] = [];

  for (const memberId of memberIds) {
    const transactionsResult = await fetchTransactionsForConstituent(memberId, apiKey);
    requestUrls.push(...transactionsResult.requestUrls);

    if (!transactionsResult.ok) {
      console.error('Failed to fetch transactions for giving interests', {
        memberId,
        status: transactionsResult.status,
        url: transactionsResult.url,
      });

      return {
        ok: false as const,
        error: transactionsResult.error ?? 'Unable to load giving interests.',
        status: transactionsResult.status,
        requestUrls,
      };
    }

    const summary = summarizeTransactions(transactionsResult.transactions);
    designations.push(...summary.designations);
  }

  const givingInterests = aggregateGivingInterests(designations);

  console.log('Derived giving interests for household', {
    memberCount: memberIds.length,
    interestCount: givingInterests.length,
    designationCount: designations.length,
  });

  return { ok: true as const, givingInterests, requestUrls };
}

function aggregateGivingInterests(designations: TransactionDesignation[]): GivingInterest[] {
  const grouped = new Map<string, GivingInterest>();

  for (const designation of designations) {
    const key = [designation.fundName ?? '', designation.campaignName ?? '', designation.appealName ?? ''].join('||');
    const existing = grouped.get(key) ?? {
      fund: designation.fundName ?? null,
      campaign: designation.campaignName ?? null,
      appeal: designation.appealName ?? null,
      totalAmount: 0,
      giftCount: 0,
      firstGiftDate: null,
      lastGiftDate: null,
    } satisfies GivingInterest;

    const amount = Number.isFinite(designation.amount) ? designation.amount : 0;
    existing.totalAmount += amount;
    existing.giftCount += 1;

    const parsedDate = parseDate(designation.date);

    if (parsedDate) {
      if (!existing.firstGiftDate || parsedDate < existing.firstGiftDate) {
        existing.firstGiftDate = parsedDate;
      }

      if (!existing.lastGiftDate || parsedDate > existing.lastGiftDate) {
        existing.lastGiftDate = parsedDate;
      }
    }

    grouped.set(key, existing);
  }

  const interests = Array.from(grouped.values());

  interests.sort((a, b) => {
    if (b.totalAmount !== a.totalAmount) {
      return b.totalAmount - a.totalAmount;
    }

    const bTime = b.lastGiftDate ? new Date(b.lastGiftDate).getTime() : 0;
    const aTime = a.lastGiftDate ? new Date(a.lastGiftDate).getTime() : 0;

    return bTime - aTime;
  });

  if (interests.length <= 5) {
    return interests;
  }

  const top = interests.slice(0, 5);
  const remainder = interests.slice(5);

  const otherInterest = remainder.reduce<GivingInterest | null>((accumulator, interest) => {
    if (!accumulator) {
      return { ...interest, fund: 'Other', campaign: null, appeal: null };
    }

    return {
      fund: 'Other',
      campaign: null,
      appeal: null,
      totalAmount: accumulator.totalAmount + interest.totalAmount,
      giftCount: accumulator.giftCount + interest.giftCount,
      firstGiftDate: earliestDate(accumulator.firstGiftDate, interest.firstGiftDate),
      lastGiftDate: latestDate(accumulator.lastGiftDate, interest.lastGiftDate),
    };
  }, null);

  return otherInterest ? [...top, otherInterest] : top;
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function earliestDate(existing: string | null, candidate: string | null) {
  if (!existing) {
    return candidate;
  }

  if (!candidate) {
    return existing;
  }

  return existing < candidate ? existing : candidate;
}

function latestDate(existing: string | null, candidate: string | null) {
  if (!existing) {
    return candidate;
  }

  if (!candidate) {
    return existing;
  }

  return existing > candidate ? existing : candidate;
}
