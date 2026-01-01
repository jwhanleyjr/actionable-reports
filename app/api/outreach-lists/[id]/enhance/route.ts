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
  const supabase = getSupabaseAdmin();

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

  const queue = [...(importRows ?? [])];
  const executing: Promise<void>[] = [];

  const processNext = async () => {
    const next = queue.shift();
    if (!next) return;

    try {
      const search = await searchConstituent(next.account_number, apiKey);

      if (!search.ok || !search.constituentId) {
        result.notFound.push(next.account_number);
        return;
      }

      const householdId = search.householdId ?? -search.constituentId;
      const householdSnapshot = buildHouseholdSnapshot(search.constituent, search.householdId);
      const memberSnapshot = buildMemberSnapshot(search.constituent);

      await supabase.from('outreach_list_households').upsert({
        outreach_list_id: id,
        household_id: householdId,
        origin: 'import',
        household_snapshot: householdSnapshot,
      });

      await supabase.from('outreach_list_members').upsert({
        outreach_list_id: id,
        household_id: householdId,
        constituent_id: search.constituentId,
        origin: 'import',
        member_snapshot: memberSnapshot,
      });

      result.enhancedHouseholds += 1;
      result.enhancedMembers += 1;
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

function buildMemberSnapshot(constituent: Record<string, unknown>) {
  const displayName = pickString(constituent, ['FullName', 'Name', 'name']) || 'Constituent';
  const email = pickString(constituent, ['Email', 'PrimaryEmail', 'email']);
  const phone = pickString(constituent, ['Phone', 'PrimaryPhone', 'phone']);

  return {
    displayName,
    email,
    phone,
    source: 'bloomerang-search',
  };
}
