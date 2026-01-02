import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { fetchJsonWithModes, getApiKey, normalizeBoolean, pickNumber, pickString } from '../../../bloomerang/utils';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

type EnhanceResult = {
  enhancedHouseholds: number;
  enhancedMembers: number;
  notFound: string[];
  errors: string[];
};

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Supabase configuration is missing.' },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({} as { concurrency?: number }));
  const concurrency = Math.max(1, Math.min(10, Number(body?.concurrency) || 4));

  let apiKey: string;

  try {
    apiKey = getApiKey();
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Missing API key.' }, { status: 500 });
  }

  const { data: importRows, error: importError } = await supabase
    .from('outreach_list_import_rows')
    .select('account_number')
    .eq('outreach_list_id', id)
    .order('row_number');

  if (importError) {
    return NextResponse.json({ ok: false, error: importError.message }, { status: 500 });
  }

  const result: EnhanceResult = { enhancedHouseholds: 0, enhancedMembers: 0, notFound: [], errors: [] };

  // Clear previous enhanced rows to keep the operation idempotent and avoid constraint collisions.
  const { error: deleteMembersError } = await supabase
    .from('outreach_list_members')
    .delete()
    .eq('outreach_list_id', id);

  if (deleteMembersError) {
    return NextResponse.json({ ok: false, error: deleteMembersError.message }, { status: 500 });
  }

  const { error: deleteHouseholdsError } = await supabase
    .from('outreach_list_households')
    .delete()
    .eq('outreach_list_id', id);

  if (deleteHouseholdsError) {
    return NextResponse.json({ ok: false, error: deleteHouseholdsError.message }, { status: 500 });
  }

  const queue = [...(importRows ?? [])];
  const executing: Promise<void>[] = [];
  const households = new Map<
    string,
    {
      householdId: number | null;
      soloConstituentId: number | null;
      snapshot: Record<string, unknown>;
      members: Map<number, Record<string, unknown>>;
    }
  >();

  const processNext = async () => {
    const next = queue.shift();
    if (!next) return;

    try {
      const search = await searchConstituent(next.account_number, apiKey);

      if (!search.ok || !search.constituentId) {
        result.notFound.push(next.account_number);
        return;
      }

      const rawHouseholdId = search.householdId;
      const householdId = Number.isFinite(rawHouseholdId) && (rawHouseholdId as number) > 0
        ? (rawHouseholdId as number)
        : null;
      const householdKey = householdId ? `h:${householdId}` : `c:${search.constituentId}`;
      const householdSnapshot = buildHouseholdSnapshot(search.constituent, householdId);
      const memberSnapshot = buildMemberSnapshot(search.constituent, householdKey);

      const { error: mapError } = await supabase.from('account_number_map').upsert({
        account_number: next.account_number,
        constituent_id: search.constituentId,
        raw: search.constituent,
        match_confidence: 'exact',
      });

      if (mapError) {
        result.errors.push(mapError.message);
        return;
      }

      const existing = households.get(householdKey);
      if (existing) {
        existing.members.set(search.constituentId, memberSnapshot);
      } else {
        households.set(householdKey, {
          householdId,
          soloConstituentId: householdId ? null : search.constituentId,
          snapshot: householdSnapshot,
          members: new Map([[search.constituentId, memberSnapshot]]),
        });
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown enhance error');
    }
  };

  for (let i = 0; i < concurrency; i += 1) {
    const promise = (async () => {
      while (queue.length) {
        await processNext();
      }
    })();
    executing.push(promise);
  }

  await Promise.all(executing);

  if (!households.size) {
    return NextResponse.json({ ok: true, ...result });
  }

  const householdRows = Array.from(households.entries()).map(([householdKey, data]) => ({
    outreach_list_id: id,
    household_key: householdKey,
    household_id: data.householdId,
    solo_constituent_id: data.soloConstituentId,
    origin: 'import',
    household_snapshot: data.snapshot,
  }));

  const memberRows = Array.from(households.entries()).flatMap(([_householdKey, data]) =>
    Array.from(data.members.entries()).map(([constituentId, memberSnapshot]) => ({
      outreach_list_id: id,
      household_id: data.householdId ?? constituentId,
      constituent_id: constituentId,
      origin: 'import',
      member_snapshot: memberSnapshot,
    }))
  );

  const { error: householdUpsertError } = await supabase
    .from('outreach_list_households')
    .upsert(householdRows, { onConflict: 'outreach_list_id,household_key' });

  if (householdUpsertError) {
    result.errors.push(householdUpsertError.message);
  }

  const { error: memberUpsertError } = await supabase
    .from('outreach_list_members')
    .upsert(memberRows, { onConflict: 'outreach_list_id,constituent_id' });

  if (memberUpsertError) {
    result.errors.push(memberUpsertError.message);
  }

  result.enhancedHouseholds = households.size;
  result.enhancedMembers = memberRows.length;

  return NextResponse.json({ ok: true, ...result });
}

async function searchConstituent(accountNumber: string, apiKey: string) {
  const url = new URL('https://api.bloomerang.co/v2/constituents/search');
  url.searchParams.set('skip', '0');
  url.searchParams.set('take', '1');
  url.searchParams.set('search', accountNumber);

  const result = await fetchJsonWithModes(url, apiKey);

  if (!result.ok) {
    return { ok: false as const };
  }

  const candidate = Array.isArray((result.data as { Results?: unknown[] })?.Results)
    ? (result.data as { Results: unknown[] }).Results[0]
    : null;

  if (!candidate || typeof candidate !== 'object') {
    return { ok: false as const };
  }

  const householdId = pickNumber(candidate as Record<string, unknown>, ['HouseholdId', 'householdId']);
  const constituentId = pickNumber(candidate as Record<string, unknown>, [
    'id',
    'Id',
    'constituentId',
    'ConstituentId',
    'accountId',
    'AccountId',
  ]);

  return {
    ok: true as const,
    constituent: candidate as Record<string, unknown>,
    constituentId,
    householdId,
    isInHousehold: normalizeBoolean((candidate as Record<string, unknown>).IsInHousehold),
  };
}

function buildHouseholdSnapshot(constituent: Record<string, unknown>, householdId: number | null) {
  const primaryName = pickString(constituent, ['HouseholdName', 'householdName', 'Name', 'FullName', 'name']);
  return {
    householdId,
    displayName: primaryName || 'Household',
    source: 'bloomerang-search',
  };
}

function buildMemberSnapshot(constituent: Record<string, unknown>, householdKey: string) {
  const displayName = pickString(constituent, ['FullName', 'Name', 'name']) || 'Constituent';
  const email = pickString(constituent, ['Email', 'PrimaryEmail', 'email']);
  const phone = pickString(constituent, ['Phone', 'PrimaryPhone', 'phone']);

  return {
    displayName,
    email,
    phone,
    householdKey,
    source: 'bloomerang-search',
  };
}
