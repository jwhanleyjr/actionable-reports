import { NextResponse } from 'next/server';

import { findCampaign, getCampaignAccountIds, getCampaignHouseholds, usingMockStorage } from '@/lib/dataStore';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

type Params = {
  params: { id?: string };
};

type CampaignHouseholdRecord = {
  household_id: number;
  household_snapshot: Record<string, unknown> | null;
};

type CampaignMemberRecord = {
  household_id: number;
  constituent_id: number;
  member_snapshot: Record<string, unknown> | null;
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
      household_id: household.householdId,
      household_snapshot: household.data,
      members: members
        .filter((member) => member.householdId === household.householdId)
        .map((member) => ({
          constituent_id: member.memberAccountId,
          member_snapshot:
            constituents.find((constituent) => constituent.accountId === member.memberAccountId)?.data ?? null,
        })),
    }));

    return NextResponse.json({
      campaign_id: campaignId,
      households: householdsResponse,
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

    const [{ data: households, error: householdsError }, { data: members, error: membersError }] = await Promise.all([
      supabase
        .from('campaign_households')
        .select('household_id,household_snapshot')
        .eq('campaign_id', campaignId),
      supabase
        .from('campaign_members')
        .select('household_id,constituent_id,member_snapshot')
        .eq('campaign_id', campaignId),
    ]);

    if (householdsError) {
      console.error('Households query failed', householdsError);
      return NextResponse.json(
        {
          error: householdsError.message,
          code: householdsError.code,
          details: householdsError.details,
          hint: householdsError.hint,
        },
        { status: 500 },
      );
    }

    if (membersError) {
      console.error('Households query failed', membersError);
      return NextResponse.json(
        {
          error: membersError.message,
          code: membersError.code,
          details: membersError.details,
          hint: membersError.hint,
        },
        { status: 500 },
      );
    }

    const householdsResponse = (households ?? []).map((household: CampaignHouseholdRecord) => ({
      household_id: household.household_id,
      household_snapshot: household.household_snapshot,
      members: (members ?? [])
        .filter((member): member is CampaignMemberRecord => member.household_id === household.household_id)
        .map((member) => ({
          constituent_id: member.constituent_id,
          member_snapshot: member.member_snapshot,
        })),
    }));

    if (householdsResponse.length === 0) {
      return NextResponse.json({
        campaign_id: campaignId,
        households: [],
        message: 'No households found for this campaign.',
      });
    }

    return NextResponse.json({
      campaign_id: campaignId,
      households: householdsResponse,
    });
  } catch (error) {
    console.error('Unexpected error loading households', error);
    return NextResponse.json({ error: 'Unexpected error loading households.' }, { status: 500 });
  }
}
