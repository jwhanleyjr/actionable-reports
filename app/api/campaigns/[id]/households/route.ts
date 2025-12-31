import { NextResponse } from 'next/server';

import { findCampaign, getCampaignAccountIds, getCampaignHouseholds, usingMockStorage } from '@/lib/dataStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

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

function isUuid(value: string | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(_request: Request, { params }: Params) {
  const campaignId = params?.id;

  if (!isUuid(campaignId)) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
  }

  if (usingMockStorage()) {
    const campaign = findCampaign(campaignId);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const accountIds = getCampaignAccountIds(campaignId);
    const { households, members, constituents } = getCampaignHouseholds(campaignId, accountIds);

    const householdsResponse = households.map((household) => ({
      householdId: household.householdId,
      household: household.data,
      members: members
        .filter((member) => member.householdId === household.householdId)
        .map((member) => ({
          accountId: member.memberAccountId,
          constituent:
            constituents.find((constituent) => constituent.accountId === member.memberAccountId)?.data ?? null,
        })),
    }));

    return NextResponse.json({
      campaignId,
      households: householdsResponse,
      counts: { households: householdsResponse.length, members: accountIds.length },
    });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError) {
      console.error('Households query failed', campaignError);
      return NextResponse.json(
        {
          error: campaignError.message,
          code: campaignError.code,
          details: campaignError.details,
          hint: campaignError.hint,
        },
        { status: 500 },
      );
    }

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const { data: importRows, error: importError } = await supabase
      .from('campaign_import_rows')
      .select('account_id')
      .eq('campaign_id', campaignId);

    if (importError) {
      console.error('Households query failed', importError);
      return NextResponse.json(
        {
          error: importError.message,
          code: importError.code,
          details: importError.details,
          hint: importError.hint,
        },
        { status: 500 },
      );
    }

    const accountIds = Array.from(
      new Set((importRows ?? []).map((row) => row.account_id).filter((value) => typeof value === 'number')),
    );

    if (accountIds.length === 0) {
      return NextResponse.json({ campaignId, households: [], message: 'No households found for this campaign.' });
    }

    const { data: memberRows, error: memberError } = await supabase
      .from('household_members')
      .select('household_id,member_account_id')
      .in('member_account_id', accountIds);

    if (memberError) {
      console.error('Households query failed', memberError);
      return NextResponse.json(
        {
          error: memberError.message,
          code: memberError.code,
          details: memberError.details,
          hint: memberError.hint,
        },
        { status: 500 },
      );
    }

    const householdIds = Array.from(
      new Set((memberRows ?? []).map((row) => row.household_id).filter((value) => typeof value === 'number')),
    );

    if (householdIds.length === 0) {
      return NextResponse.json({ campaignId, households: [], message: 'No households found for this campaign.' });
    }

    const memberAccountIds = Array.from(
      new Set((memberRows ?? []).map((row) => row.member_account_id).filter((value) => typeof value === 'number')),
    );

    if (memberAccountIds.length === 0) {
      return NextResponse.json({ campaignId, households: [], message: 'No households found for this campaign.' });
    }

    const [householdsResult, constituentsResult] = await Promise.all([
      supabase
        .from('households')
        .select('household_id,data')
        .in('household_id', householdIds),
      supabase
        .from('constituents')
        .select('account_id,data')
        .in('account_id', memberAccountIds),
    ]);

    if (householdsResult.error) {
      console.error('Households query failed', householdsResult.error);
      return NextResponse.json(
        {
          error: householdsResult.error.message,
          code: householdsResult.error.code,
          details: householdsResult.error.details,
          hint: householdsResult.error.hint,
        },
        { status: 500 },
      );
    }

    if (constituentsResult.error) {
      console.error('Households query failed', constituentsResult.error);
      return NextResponse.json(
        {
          error: constituentsResult.error.message,
          code: constituentsResult.error.code,
          details: constituentsResult.error.details,
          hint: constituentsResult.error.hint,
        },
        { status: 500 },
      );
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

    if (households.length === 0) {
      return NextResponse.json({ campaignId, households: [], message: 'No households found for this campaign.' });
    }

    return NextResponse.json({
      campaignId,
      households,
      counts: {
        households: households.length,
        members: memberAccountIds.length,
      },
    });
  } catch (error) {
    console.error('Unexpected error loading households', error);
    return NextResponse.json({ error: 'Unexpected error loading households.' }, { status: 500 });
  }
}
