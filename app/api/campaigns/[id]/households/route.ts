import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

type Params = {
  params: { id?: string };
};

type HouseholdRecord = {
  household_id: number;
  data: Record<string, unknown> | null;
};

type HouseholdMemberRecord = {
  household_id: number;
  member_account_id: number;
};

type ConstituentRecord = {
  account_id: number;
  data: Record<string, unknown> | null;
};

export async function GET(_request: Request, { params }: Params) {
  const campaignId = Number(params?.id);

  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
  }

  const { data: importRows, error: importError } = await supabaseAdmin
    .from('campaign_import_rows')
    .select('account_id')
    .eq('campaign_id', campaignId);

  if (importError) {
    return NextResponse.json({ error: 'Failed to load campaign import rows' }, { status: 500 });
  }

  const accountIds = Array.from(
    new Set((importRows ?? []).map((row) => row.account_id).filter((value) => typeof value === 'number')),
  );

  if (accountIds.length === 0) {
    return NextResponse.json({ campaignId, households: [] });
  }

  const { data: memberRows, error: memberError } = await supabaseAdmin
    .from('household_members')
    .select('household_id,member_account_id')
    .in('member_account_id', accountIds);

  if (memberError) {
    return NextResponse.json({ error: 'Failed to load household members' }, { status: 500 });
  }

  const householdIds = Array.from(
    new Set((memberRows ?? []).map((row) => row.household_id).filter((value) => typeof value === 'number')),
  );

  if (householdIds.length === 0) {
    return NextResponse.json({ campaignId, households: [] });
  }

  const memberAccountIds = Array.from(
    new Set((memberRows ?? []).map((row) => row.member_account_id).filter((value) => typeof value === 'number')),
  );

  if (memberAccountIds.length === 0) {
    return NextResponse.json({ campaignId, households: [] });
  }

  const [householdsResult, constituentsResult] = await Promise.all([
    supabaseAdmin
      .from('households')
      .select('household_id,data')
      .in('household_id', householdIds),
    supabaseAdmin
      .from('constituents')
      .select('account_id,data')
      .in('account_id', memberAccountIds),
  ]);

  if (householdsResult.error || constituentsResult.error) {
    return NextResponse.json({ error: 'Failed to load cached campaign data' }, { status: 500 });
  }

  const householdsById = new Map<number, HouseholdRecord>();
  for (const household of householdsResult.data ?? []) {
    householdsById.set(household.household_id, household);
  }

  const constituentsById = new Map<number, ConstituentRecord>();
  for (const constituent of constituentsResult.data ?? []) {
    constituentsById.set(constituent.account_id, constituent);
  }

  const households = householdIds.map((householdId) => {
    const household = householdsById.get(householdId) ?? null;
    const members = (memberRows ?? [])
      .filter((memberRow): memberRow is HouseholdMemberRecord => memberRow.household_id === householdId)
      .map((memberRow) => {
        const constituent = constituentsById.get(memberRow.member_account_id) ?? null;
        return {
          accountId: memberRow.member_account_id,
          constituent: constituent?.data ?? null,
        };
      });

    return {
      householdId,
      household: household?.data ?? null,
      members,
    };
  });

  return NextResponse.json({
    campaignId,
    households,
    counts: {
      households: households.length,
      members: memberAccountIds.length,
    },
  });
}
