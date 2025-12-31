import { NextRequest, NextResponse } from 'next/server';

import { calculateGivingStats } from '../giving-stats/service';
import {
  fetchJsonWithModes,
  getApiKey,
  normalizeBoolean,
  pickNumber,
  readValue,
} from '../utils';

type MemberWithStats = {
  constituent: Record<string, unknown> | null;
  constituentId: number;
  stats?: {
    lifetimeTotal: number;
    lastYearTotal: number;
    ytdTotal: number;
    lastGiftAmount: number | null;
    lastGiftDate: string | null;
  };
  recentTransactions?: Array<{
    id: string | number | null;
    amount: number;
    date: string | null;
    type: string | null;
  }>;
  statsError?: string;
  constituentError?: string;
};

type HouseholdTotals = {
  lifetimeTotal: number;
  lastYearTotal: number;
  ytdTotal: number;
  lastGiftAmount: number | null;
  lastGiftDate: string | null;
};

export async function POST(request: NextRequest) {
  let payload: { accountNumber?: unknown };

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid JSON body.',
    }, { status: 400 });
  }

  const accountNumber = typeof payload.accountNumber === 'string'
    ? payload.accountNumber.trim()
    : String(payload.accountNumber ?? '').trim();

  if (!accountNumber) {
    return NextResponse.json({
      ok: false,
      error: 'accountNumber is required.',
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

  const searchResult = await searchConstituent(accountNumber, apiKey);

  if (!searchResult.ok) {
    return NextResponse.json(searchResult, { status: searchResult.status ?? 404 });
  }

  const constituent = searchResult.constituent;
  const constituentId = searchResult.constituentId;

  const isInHousehold = searchResult.isInHousehold;
  const householdId = searchResult.householdId;

  let household: Record<string, unknown> | null = null;
  let householdError: string | undefined;
  let members: MemberWithStats[] = [];

  if (Number.isFinite(householdId) && isInHousehold !== false) {
    const householdResult = await getHousehold(householdId as number, apiKey);

    if (householdResult.ok) {
      household = householdResult.household;
      members = await loadMembersFromHousehold(householdResult.household, apiKey);
    } else {
      householdError = householdResult.error ?? 'Unable to load household data.';
    }
  }

  if (!members.length && Number.isFinite(constituentId)) {
    members = [await buildMemberWithStats(constituentId as number, apiKey, constituent ?? null)];
  }

  const householdTotals = computeHouseholdTotals(members);

  return NextResponse.json({
    ok: true,
    constituent,
    household,
    householdError,
    members,
    householdTotals,
  });
}

async function searchConstituent(accountNumber: string, apiKey: string) {
  const url = new URL('https://api.bloomerang.co/v2/constituents/search');
  url.searchParams.set('skip', '0');
  url.searchParams.set('take', '10');
  url.searchParams.set('search', accountNumber);

  const result = await fetchJsonWithModes(url, apiKey);

  if (!result.ok) {
    return {
      ok: false as const,
      status: result.status,
      url: result.url,
      contentType: result.contentType,
      bodyPreview: result.bodyPreview,
      error: result.error,
    };
  }

  const firstResult = Array.isArray((result.data as { Results?: unknown[] })?.Results)
    ? (result.data as { Results: unknown[] }).Results[0]
    : null;

  if (!firstResult || typeof firstResult !== 'object') {
    return {
      ok: false as const,
      status: result.status,
      url: result.url,
      contentType: result.contentType,
      error: 'No constituent found',
      data: result.data,
    };
  }

  const householdId = pickNumber(firstResult as Record<string, unknown>, ['HouseholdId', 'householdId']);
  const isInHousehold = normalizeBoolean(readValue(firstResult as Record<string, unknown>, 'IsInHousehold')
    ?? readValue(firstResult as Record<string, unknown>, 'isInHousehold'));
  const constituentId = pickNumber(firstResult as Record<string, unknown>, [
    'id',
    'Id',
    'constituentId',
    'ConstituentId',
    'accountId',
    'AccountId',
  ]);

  return {
    ok: true as const,
    status: result.status,
    url: result.url,
    contentType: result.contentType,
    constituent: firstResult as Record<string, unknown>,
    constituentId,
    householdId,
    isInHousehold,
  };
}

async function getHousehold(householdId: number, apiKey: string) {
  const url = new URL(`https://api.bloomerang.co/v2/household/${householdId}`);
  const result = await fetchJsonWithModes(url, apiKey);

  if (!result.ok) {
    return {
      ok: false as const,
      status: result.status,
      url: result.url,
      contentType: result.contentType,
      bodyPreview: result.bodyPreview,
      error: result.error,
    };
  }

  return {
    ok: true as const,
    household: result.data as Record<string, unknown>,
  };
}

async function loadMembersFromHousehold(household: Record<string, unknown>, apiKey: string): Promise<MemberWithStats[]> {
  const memberRecords = getMemberArray(household);
  const ids = memberRecords
    .map((member) => pickNumber(member, [
      'accountId',
      'AccountId',
      'constituentId',
      'ConstituentId',
      'Id',
      'id',
    ]))
    .filter((id): id is number => Number.isFinite(id));

  const uniqueIds = Array.from(new Set(ids));

  if (!uniqueIds.length) {
    return [];
  }

  const members = await mapWithConcurrency(uniqueIds, 3, async (id) => buildMemberWithStats(id, apiKey));
  return members;
}

async function buildMemberWithStats(constituentId: number, apiKey: string, existingProfile: Record<string, unknown> | null = null): Promise<MemberWithStats> {
  const profileResult = existingProfile
    ? { ok: true as const, constituent: existingProfile }
    : await fetchConstituent(constituentId, apiKey);

  const statsResult = await calculateGivingStats(constituentId, apiKey);

  return {
    constituent: profileResult.ok ? profileResult.constituent : null,
    constituentId,
    stats: statsResult.ok ? statsResult.stats : undefined,
    recentTransactions: statsResult.ok ? statsResult.recentTransactions : undefined,
    statsError: statsResult.ok ? undefined : statsResult.error ?? statsResult.bodyPreview,
    constituentError: profileResult.ok ? undefined : profileResult.error,
  };
}

async function fetchConstituent(constituentId: number, apiKey: string) {
  const url = new URL(`https://api.bloomerang.co/v2/constituent/${constituentId}`);
  const result = await fetchJsonWithModes(url, apiKey);

  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error ?? result.bodyPreview ?? 'Unable to load constituent.',
    };
  }

  return {
    ok: true as const,
    constituent: (result.data as Record<string, unknown>) ?? null,
  };
}

function computeHouseholdTotals(members: MemberWithStats[]): HouseholdTotals {
  let lifetimeTotal = 0;
  let lastYearTotal = 0;
  let ytdTotal = 0;
  let lastGiftDate: string | null = null;
  let lastGiftAmount: number | null = null;

  for (const member of members) {
    if (!member.stats) {
      continue;
    }

    lifetimeTotal += member.stats.lifetimeTotal;
    lastYearTotal += member.stats.lastYearTotal;
    ytdTotal += member.stats.ytdTotal;

    if (member.stats.lastGiftDate) {
      const giftDate = new Date(member.stats.lastGiftDate);

      if (!Number.isNaN(giftDate.getTime()) && (!lastGiftDate || new Date(lastGiftDate) < giftDate)) {
        lastGiftDate = giftDate.toISOString();
        lastGiftAmount = member.stats.lastGiftAmount ?? 0;
      }
    }
  }

  return {
    lifetimeTotal,
    lastYearTotal,
    ytdTotal,
    lastGiftAmount,
    lastGiftDate,
  };
}

function getMemberArray(data: unknown): Array<Record<string, unknown>> {
  const candidate = (data as { members?: unknown; Members?: unknown; Results?: unknown[] }) ?? {};
  const fromRoot = extractMemberList(candidate.members) ?? extractMemberList(candidate.Members);

  if (fromRoot) {
    return fromRoot.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
  }

  const firstResult = Array.isArray(candidate.Results)
    ? candidate.Results[0]
    : null;

  if (firstResult && typeof firstResult === 'object') {
    const nested = extractMemberList((firstResult as { members?: unknown; Members?: unknown }).members)
      ?? extractMemberList((firstResult as { Members?: unknown }).Members)
      ?? [];

    return nested.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
  }

  return [];
}

function extractMemberList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    const asRecord = value as Record<string, unknown>;

    if (Array.isArray(asRecord.Results)) {
      return asRecord.Results as unknown[];
    }
  }

  return null;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, iterator: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing: Promise<void>[] = [];

  let index = 0;

  const enqueue = async () => {
    if (index >= items.length) {
      return;
    }

    const currentIndex = index;
    index += 1;

    const task = (async () => {
      results[currentIndex] = await iterator(items[currentIndex]);
    })();

    executing.push(task);

    task.finally(() => {
      const position = executing.indexOf(task);
      if (position >= 0) {
        executing.splice(position, 1);
      }
    });

    if (executing.length >= limit) {
      await Promise.race(executing);
    }

    await enqueue();
  };

  await enqueue();
  await Promise.all(executing);

  return results;
}
