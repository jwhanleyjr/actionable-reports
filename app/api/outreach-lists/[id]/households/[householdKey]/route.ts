import { NextRequest, NextResponse } from 'next/server';

import {
  computeHouseholdStatus,
  fetchTransactionsForConstituent,
  HouseholdStatus,
  summarizeTransactions,
  Transaction,
} from '../../../../bloomerang/giving-stats/service';
import {
  fetchJsonWithModes,
  getApiKey,
  pickNumber,
  pickString,
} from '../../../../bloomerang/utils';
import { getActiveTasksForConstituent } from '../../../../../../lib/bloomerangTasks';
import { getSupabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { BloomerangTask } from '../../../../../../types/bloomerang';

type MemberTaskSummary = {
  active: BloomerangTask[];
  loadedAt: string;
  requestUrl?: string;
};

type MemberWithStats = {
  constituent: Record<string, unknown> | null;
  constituentId: number;
  tasks?: MemberTaskSummary;
  stats?: {
    lifetimeTotal: number;
    lastYearTotal: number;
    ytdTotal: number;
    lastGiftAmount: number | null;
    lastGiftDate: string | null;
  };
  statsDebug?: {
    transactionCount: number;
    includedCount: number;
    requestUrls: string[];
  };
  requestUrls?: string[];
  profileUrl?: string;
  statsError?: string;
  constituentError?: string;
  tasksError?: string;
};

type CombinedSearchResult = {
  ok: boolean;
  constituent?: unknown;
  household?: unknown | null;
  householdError?: string;
  members?: MemberWithStats[];
  householdTotals?: HouseholdTotals;
  householdStatus?: HouseholdStatus;
  searchUrl?: string;
  householdUrl?: string;
  bodyPreview?: string;
  error?: string;
  message?: string;
};

type HouseholdTotals = {
  lifetimeTotal: number;
  lastYearTotal: number;
  ytdTotal: number;
  lastGiftAmount: number | null;
  lastGiftDate: string | null;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: NextRequest, { params }: { params: { id: string; householdKey: string } }) {
  const { id, householdKey } = params;

  if (!householdKey || !householdKey.includes(':')) {
    return NextResponse.json({ ok: false, error: 'Invalid household key.' }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 500 });
  }

  let apiKey: string;

  try {
    apiKey = getApiKey();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Missing API key.',
    }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const householdId = householdKey.startsWith('h:') ? Number(householdKey.slice(2)) : null;
  const soloConstituentId = householdKey.startsWith('c:') ? Number(householdKey.slice(2)) : null;

  if (householdId == null && soloConstituentId == null) {
    return NextResponse.json({ ok: false, error: 'Unable to resolve household key.' }, { status: 400 });
  }

  const { data: householdRecord } = await supabase
    .from('outreach_list_households')
    .select('*')
    .eq('outreach_list_id', id)
    .eq('household_key', householdKey)
    .maybeSingle();

  const outreachListHouseholdId = householdRecord?.id ?? null;

  let memberQuery = supabase
    .from('outreach_list_members')
    .select('*')
    .eq('outreach_list_id', id);

  if (outreachListHouseholdId) {
    memberQuery = memberQuery.eq('outreach_list_household_id', outreachListHouseholdId);
  } else if (Number.isFinite(householdId)) {
    memberQuery = memberQuery.eq('household_id', householdId);
  } else if (Number.isFinite(soloConstituentId)) {
    memberQuery = memberQuery.eq('constituent_id', soloConstituentId);
  }

  const { data: memberRows } = await memberQuery.returns<{ constituent_id: number; id: string }[]>();

  let memberIds = (memberRows ?? []).map((row) => row.constituent_id).filter((idNum) => Number.isFinite(idNum));

  if (!memberIds.length && Number.isFinite(soloConstituentId)) {
    memberIds = [soloConstituentId as number];
  }

  let householdPayload: Record<string, unknown> | null = null;
  let householdError: string | undefined;
  let householdUrl: string | undefined;

  if (!memberIds.length && Number.isFinite(householdId)) {
    const householdResult = await fetchHouseholdDetails(householdId as number, apiKey);

    if (householdResult.ok) {
      householdPayload = householdResult.household;
      householdUrl = householdResult.url;
      memberIds = householdResult.memberIds;
    } else {
      householdError = householdResult.bodySnippet ?? 'Unable to load household.';
      householdUrl = householdResult.url;
    }
  }

  const memberPromises = memberIds.map((memberId) => buildMemberWithStats(memberId, apiKey, null));
  const members = await Promise.all(memberPromises);

  const householdTotals = computeHouseholdTotals(members);
  const householdTransactions = members.flatMap((member) => member.transactions ?? []);
  const householdStatus = computeHouseholdStatus(householdTransactions);
  const membersForResponse = members.map(({ transactions, ...rest }) => rest);

  if (members.length) {
    await persistMemberSnapshots({
      supabase,
      members,
      outreachListId: id,
      outreachListHouseholdId,
      householdKey,
    });
  }

  if (householdPayload) {
    await supabase
      .from('outreach_list_households')
      .upsert({
        id: outreachListHouseholdId ?? undefined,
        outreach_list_id: id,
        household_key: householdKey,
        household_id: householdId,
        household_snapshot: {
          ...(householdRecord?.household_snapshot ?? {}),
          displayName: pickString(householdPayload, ['Name', 'FullName', 'InformalName', 'FormalName'])
            ?? householdRecord?.household_snapshot?.displayName,
          householdId,
        },
      });
  }

  const primaryConstituent = members[0]?.constituent ?? null;

  return NextResponse.json({
    ok: true,
    household: householdPayload,
    householdError,
    householdUrl,
    householdTotals,
    householdStatus,
    members: membersForResponse,
    constituent: primaryConstituent,
  } satisfies CombinedSearchResult);
}

async function persistMemberSnapshots({
  supabase,
  members,
  outreachListId,
  outreachListHouseholdId,
  householdKey,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  members: (MemberWithStats & { constituent: Record<string, unknown> | null })[];
  outreachListId: string;
  outreachListHouseholdId: string | null;
  householdKey: string;
}) {
  const memberSnapshots = members.map((member) => {
    const displayName = buildDisplayName(member.constituent ?? {}, member.constituentId);
    const email = pickString(member.constituent ?? {}, ['Email', 'PrimaryEmail', 'PrimaryEmail.Address']);
    const phone = pickString(member.constituent ?? {}, [
      'PrimaryPhone',
      'primaryPhone',
      'Phone',
      'phone',
      'Phones[0].Number',
    ]);

    return {
      outreach_list_id: outreachListId,
      outreach_list_household_id: outreachListHouseholdId,
      household_id: pickNumber(member.constituent ?? {}, ['HouseholdId', 'householdId']) ?? null,
      constituent_id: member.constituentId,
      member_snapshot: {
        displayName,
        email: email ?? undefined,
        phone: phone ?? undefined,
        householdKey,
      },
    };
  });

  if (!memberSnapshots.length) {
    return;
  }

  await supabase.from('outreach_list_members').upsert(memberSnapshots);

  const constituentRows = members.map((member) => ({
    constituent_id: member.constituentId,
    display_name: buildDisplayName(member.constituent ?? {}, member.constituentId),
    payload: member.constituent,
  }));

  await supabase.from('constituents').upsert(constituentRows);
}

function buildDisplayName(member: Record<string, unknown>, fallbackId: number) {
  const nameFields = [
    pickString(member, ['FullName', 'fullName']),
    pickString(member, ['InformalName', 'informalName']),
    pickString(member, ['FormalName', 'formalName']),
  ].filter(Boolean);

  if (nameFields.length && nameFields[0]) {
    return nameFields[0];
  }

  const firstName = pickString(member, ['FirstName', 'firstName']);
  const lastName = pickString(member, ['LastName', 'lastName']);

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }

  if (firstName) {
    return firstName;
  }

  if (lastName) {
    return lastName;
  }

  return `Constituent ${fallbackId}`;
}

function computeHouseholdTotals(members: (MemberWithStats & { transactions?: Transaction[] })[]) {
  return members.reduce<HouseholdTotals>((totals, member) => {
    if (!member.stats) {
      return totals;
    }

    totals.lifetimeTotal += member.stats.lifetimeTotal;
    totals.lastYearTotal += member.stats.lastYearTotal;
    totals.ytdTotal += member.stats.ytdTotal;

    if (member.stats.lastGiftDate) {
      const dateValue = new Date(member.stats.lastGiftDate).getTime();
      const totalsDate = totals.lastGiftDate ? new Date(totals.lastGiftDate).getTime() : 0;

      if (!totals.lastGiftDate || dateValue > totalsDate) {
        totals.lastGiftDate = member.stats.lastGiftDate;
        totals.lastGiftAmount = member.stats.lastGiftAmount;
      }
    }

    return totals;
  }, {
    lifetimeTotal: 0,
    lastYearTotal: 0,
    ytdTotal: 0,
    lastGiftAmount: null,
    lastGiftDate: null,
  });
}

async function buildMemberWithStats(constituentId: number, apiKey: string, profile?: Record<string, unknown> | null) {
  const requestUrls: string[] = [];
  const existingProfile = profile ?? null;
  const constituentUrl = new URL(`https://api.bloomerang.co/v2/constituent/${constituentId}`);

  if (!existingProfile) {
    requestUrls.push(constituentUrl.toString());
  }

  let constituent = existingProfile;

  if (!constituent) {
    const profileResult = await fetchJsonWithModes(constituentUrl, apiKey);

    if (!profileResult.ok) {
      return {
        constituent: null,
        constituentId,
        requestUrls,
        constituentError: profileResult.error ?? profileResult.bodyPreview ?? 'Unable to load constituent.',
      } satisfies MemberWithStats & { transactions?: Transaction[] };
    }

    constituent = (profileResult.data as Record<string, unknown>) ?? {};
  }

  const transactionsResult = await fetchTransactionsForConstituent(constituentId, apiKey);

  let activeTasksResult: Awaited<ReturnType<typeof getActiveTasksForConstituent>> | null = null;
  let activeTasksError: string | undefined;

  try {
    activeTasksResult = await getActiveTasksForConstituent(constituentId);
  } catch (error) {
    activeTasksError = error instanceof Error ? error.message : 'Unable to load tasks.';
  }

  const transactions = transactionsResult.ok ? transactionsResult.transactions : [];
  const summarized = summarizeTransactions(transactions);

  const member: MemberWithStats & { transactions?: Transaction[] } = {
    constituent,
    constituentId,
    stats: summarized.stats,
    statsDebug: { ...summarized.debug, requestUrls },
    requestUrls,
    profileUrl: constituentUrl.toString(),
    transactions,
  };

  if (!transactionsResult.ok) {
    member.statsError = transactionsResult.error ?? 'Unable to load transactions.';
  }

  if (activeTasksError) {
    member.tasksError = activeTasksError;
  } else if (activeTasksResult) {
    member.tasks = {
      active: activeTasksResult.tasks,
      loadedAt: new Date().toISOString(),
      requestUrl: activeTasksResult.url,
    };
  }

  return member;
}

async function fetchHouseholdDetails(householdId: number, apiKey: string) {
  const url = new URL(`https://api.bloomerang.co/v2/households/${householdId}`);
  const response = await fetchJsonWithModes(url, apiKey);

  if (!response.ok) {
    return { ok: false as const, status: response.status, url: response.url, bodySnippet: response.bodyPreview };
  }

  const household = (response.data ?? {}) as Record<string, unknown>;
  const memberIds: number[] = [];

  if (Array.isArray((household as { MemberIds?: unknown[] }).MemberIds)) {
    (household as { MemberIds?: unknown[] }).MemberIds?.forEach((memberId) => {
      if (Number.isFinite(memberId)) {
        memberIds.push(Number(memberId));
      }
    });
  }

  if (Array.isArray((household as { Members?: unknown[] }).Members)) {
    (household as { Members?: unknown[] }).Members?.forEach((member) => {
      if (member && typeof member === 'object') {
        const memberId = pickNumber(member as Record<string, unknown>, ['Id', 'id', 'ConstituentId', 'constituentId']);

        if (Number.isFinite(memberId)) {
          memberIds.push(memberId as number);
        }
      }
    });
  }

  return { ok: true as const, household, memberIds: Array.from(new Set(memberIds)), url: response.url };
}

