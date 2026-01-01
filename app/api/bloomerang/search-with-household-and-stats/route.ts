import { NextRequest, NextResponse } from 'next/server';

import { StatsDebug, calculateGivingStats } from '../giving-stats/service';
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
  statsDebug?: StatsDebug;
  requestUrls?: string[];
  profileUrl?: string;
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

  let isInHousehold = searchResult.isInHousehold;
  let householdId = searchResult.householdId;
  let primaryProfile: Record<string, unknown> | null = (constituent as Record<string, unknown> | null) ?? null;

  if ((!Number.isFinite(householdId) || isInHousehold === null) && Number.isFinite(constituentId)) {
    const profileResult = await fetchConstituent(constituentId as number, apiKey);

    if (profileResult.ok) {
      primaryProfile = profileResult.constituent;

      const profileHouseholdId = pickNumber(profileResult.constituent, ['HouseholdId', 'householdId']);
      const profileHouseholdFlag = normalizeBoolean(readValue(profileResult.constituent, 'IsInHousehold')
        ?? readValue(profileResult.constituent, 'isInHousehold'));

      if (Number.isFinite(profileHouseholdId)) {
        householdId = profileHouseholdId as number;
      }

      if (profileHouseholdFlag !== null) {
        isInHousehold = profileHouseholdFlag;
      }
    }
  }

  let household: Record<string, unknown> | null = null;
  let householdError: string | undefined;
  let householdUrl: string | undefined;
  let members: MemberWithStats[] = [];

  if (Number.isFinite(householdId) && isInHousehold !== false) {
    const householdResult = await getHousehold(householdId as number, apiKey);

    if (householdResult.ok) {
      household = householdResult.household;
      householdUrl = householdResult.url;
      members = await loadMembersFromHousehold(householdResult.household, apiKey);
    } else {
      householdError = householdResult.error ?? 'Unable to load household data.';
      householdUrl = householdResult.url;
    }
  }

  if (Number.isFinite(constituentId)) {
    const existingIds = new Set(members.map((member) => member.constituentId));

    if (!existingIds.has(constituentId as number)) {
      members.unshift(await buildMemberWithStats(constituentId as number, apiKey, primaryProfile));
    }
  }

  if (!members.length && Number.isFinite(constituentId)) {
    members = [await buildMemberWithStats(constituentId as number, apiKey, primaryProfile)];
  }

  const householdTotals = computeHouseholdTotals(members);

  return NextResponse.json({
    ok: true,
    constituent,
    household,
    householdError,
    members,
    householdTotals,
    searchUrl: searchResult.url,
    householdUrl,
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
    url: result.url,
    household: result.data as Record<string, unknown>,
  };
}

async function loadMembersFromHousehold(household: Record<string, unknown>, apiKey: string): Promise<MemberWithStats[]> {
  const memberRecords = getMemberArray(household);
  const idsFromRecords = memberRecords
    .map((member) => pickNumber(member, [
      'accountId',
      'AccountId',
      'constituentId',
      'ConstituentId',
      'Id',
      'id',
    ]))
    .filter((id): id is number => Number.isFinite(id));

  const idsFromLists = getMemberIdsFromHousehold(household);
  const combinedIds = [...idsFromRecords, ...idsFromLists];
  const uniqueIds = Array.from(new Set(combinedIds));

  if (!uniqueIds.length) {
    return [];
  }

  const members = await mapWithConcurrency(uniqueIds, 3, async (id) => buildMemberWithStats(id, apiKey));
  return members;
}

function getMemberIdsFromHousehold(household: Record<string, unknown>): number[] {
  const candidate = household ?? {};
  const idFields = [
    'MemberIds',
    'memberIds',
    'Members',
    'members',
    'AccountIds',
    'accountIds',
    'ConstituentIds',
    'constituentIds',
  ];

  const collected: number[] = [];

  for (const field of idFields) {
    const rawValue = (candidate as Record<string, unknown>)[field];
    const ids = extractIds(rawValue);

    if (ids.length) {
      collected.push(...ids);
    }
  }

  return collected.filter((value) => Number.isFinite(value));
}

function extractIds(value: unknown): number[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'number') {
          return entry;
        }

        if (typeof entry === 'string' && entry.trim()) {
          const parsed = Number(entry);
          return Number.isFinite(parsed) ? parsed : null;
        }

        if (entry && typeof entry === 'object') {
          return pickNumber(entry as Record<string, unknown>, [
            'accountId',
            'AccountId',
            'constituentId',
            'ConstituentId',
            'Id',
            'id',
          ]);
        }

        return null;
      })
      .filter((id): id is number => Number.isFinite(id));
  }

  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).Results)) {
    return extractIds((value as Record<string, unknown>).Results);
  }

  return [];
}

async function buildMemberWithStats(constituentId: number, apiKey: string, existingProfile: Record<string, unknown> | null = null): Promise<MemberWithStats> {
  const profileResult = existingProfile
    ? { ok: true as const, constituent: existingProfile, url: undefined as string | undefined }
    : await fetchConstituent(constituentId, apiKey);

  const statsResult = await calculateGivingStats(constituentId, apiKey);
  const requestUrls = statsResult.ok
    ? statsResult.debug.requestUrls
    : statsResult.requestUrls ?? (statsResult.url ? [statsResult.url] : []);

  return {
    constituent: profileResult.ok ? profileResult.constituent : null,
    constituentId,
    stats: statsResult.ok ? statsResult.stats : undefined,
    statsDebug: statsResult.ok ? statsResult.debug : undefined,
    requestUrls,
    profileUrl: profileResult.url,
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
      url: result.url,
    };
  }

  return {
    ok: true as const,
    constituent: (result.data as Record<string, unknown>) ?? null,
    url: result.url,
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
  const memberFields = ['members', 'Members', 'HouseholdMembers', 'householdMembers', 'Constituents', 'constituents'];
  const collected: unknown[] = [];

  for (const field of memberFields) {
    const list = extractMemberList((candidate as Record<string, unknown>)[field]);
    if (list) {
      collected.push(...list);
    }
  }

  if (collected.length) {
    return collected.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
  }

  const firstResult = Array.isArray(candidate.Results)
    ? candidate.Results[0]
    : null;

  if (firstResult && typeof firstResult === 'object') {
    for (const field of memberFields) {
      const nested = extractMemberList((firstResult as Record<string, unknown>)[field]);
      if (nested?.length) {
        return nested.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
      }
    }
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
