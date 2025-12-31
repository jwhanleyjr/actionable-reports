import { NextResponse } from 'next/server';

import { getConstituent, getHousehold } from '@/lib/bloomerang';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type Params = {
  params: { id?: string };
};

type ConstituentProfile = {
  accountId?: number;
  householdId?: number;
  [key: string]: unknown;
};

type HouseholdProfile = {
  householdId?: number;
  members?: Array<{ accountId?: number; constituentId?: number }>;
  [key: string]: unknown;
};

export async function POST(_request: Request, { params }: Params) {
  const campaignId = Number(params?.id);

  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
  }

  const { data: importRows, error: importError } = await supabaseAdmin
    .from('campaign_import_rows')
    .select('account_id')
    .eq('campaign_id', campaignId);

  if (importError) {
    return NextResponse.json(
      { error: 'Failed to load campaign import rows' },
      { status: 500 }
    );
  }

  if (!importRows || importRows.length === 0) {
    return NextResponse.json(
      { error: 'No imported rows found for this campaign' },
      { status: 404 }
    );
  }

  const constituentCache = new Map<number, ConstituentProfile>();
  const householdCache = new Map<number, HouseholdProfile>();
  const householdMemberCache = new Map<string, { household_id: number; member_account_id: number }>();

  const accountIds = Array.from(new Set(importRows.map((row) => row.account_id)));

  try {
    for (const accountId of accountIds) {
      await processConstituent(accountId, constituentCache, householdCache, householdMemberCache);
    }
  } catch (error) {
    console.error('Enhancement failed', error);
    return NextResponse.json(
      { error: 'Failed to enhance campaign constituent data' },
      { status: 502 }
    );
  }

  const constituentRecords = Array.from(constituentCache.entries()).map(([accountId, profile]) => ({
    account_id: accountId,
    data: profile,
  }));

  const householdRecords = Array.from(householdCache.entries()).map(([householdId, profile]) => ({
    household_id: householdId,
    data: profile,
  }));

  const householdMemberRecords = Array.from(householdMemberCache.values());

  const upsertResults = await Promise.all([
    constituentRecords.length
      ? supabaseAdmin.from('constituents').upsert(constituentRecords, { onConflict: 'account_id' })
      : Promise.resolve({ error: null }),
    householdRecords.length
      ? supabaseAdmin.from('households').upsert(householdRecords, { onConflict: 'household_id' })
      : Promise.resolve({ error: null }),
    householdMemberRecords.length
      ? supabaseAdmin
          .from('household_members')
          .upsert(householdMemberRecords, { onConflict: 'household_id,member_account_id' })
      : Promise.resolve({ error: null }),
  ]);

  const [constituentResult, householdResult, memberResult] = upsertResults;

  if (constituentResult.error || householdResult.error || memberResult.error) {
    console.error('Upsert errors', {
      constituents: constituentResult.error,
      households: householdResult.error,
      members: memberResult.error,
    });
    return NextResponse.json(
      { error: 'Failed to cache enhanced data' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    campaignId,
    processedAccounts: constituentRecords.length,
    processedHouseholds: householdRecords.length,
    processedHouseholdMembers: householdMemberRecords.length,
  });
}

async function processConstituent(
  accountId: number,
  constituentCache: Map<number, ConstituentProfile>,
  householdCache: Map<number, HouseholdProfile>,
  householdMemberCache: Map<string, { household_id: number; member_account_id: number }>
): Promise<void> {
  if (constituentCache.has(accountId)) {
    return;
  }

  const constituent = (await getConstituent(accountId)) as ConstituentProfile;
  constituentCache.set(accountId, constituent);

  const householdId = extractHouseholdId(constituent);

  if (!householdId || householdCache.has(householdId)) {
    if (householdId) {
      addHouseholdMember(householdId, accountId, householdMemberCache);
    }
    return;
  }

  const household = (await getHousehold(householdId)) as HouseholdProfile;
  householdCache.set(householdId, household);
  addHouseholdMember(householdId, accountId, householdMemberCache);

  const memberIds = extractHouseholdMemberIds(household);
  for (const memberId of memberIds) {
    addHouseholdMember(householdId, memberId, householdMemberCache);
    await processConstituent(memberId, constituentCache, householdCache, householdMemberCache);
  }
}

function extractHouseholdId(constituent: ConstituentProfile): number | null {
  const value = constituent.householdId;
  const id = typeof value === 'number' ? value : null;
  return Number.isFinite(id) ? id : null;
}

function extractHouseholdMemberIds(household: HouseholdProfile): number[] {
  if (!household?.members || !Array.isArray(household.members)) {
    return [];
  }

  return household.members
    .map((member) => {
      const id = typeof member.accountId === 'number' ? member.accountId : member.constituentId;
      return typeof id === 'number' && Number.isFinite(id) ? id : null;
    })
    .filter((id): id is number => id !== null);
}

function addHouseholdMember(
  householdId: number,
  memberId: number,
  cache: Map<string, { household_id: number; member_account_id: number }>
) {
  const key = `${householdId}-${memberId}`;
  if (!cache.has(key)) {
    cache.set(key, { household_id: householdId, member_account_id: memberId });
  }
}
