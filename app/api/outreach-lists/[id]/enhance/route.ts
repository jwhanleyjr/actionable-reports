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
  const debug: {
    steps: string[];
    counts: {
      importRows?: number;
      mapped?: number;
      searched?: number;
      householdsPrepared?: number;
      membersPrepared?: number;
      searchHouseholdType?: number;
      realHouseholds?: number;
      soloHouseholds?: number;
      householdFetchSuccess?: number;
      avgMembersPerHousehold?: number;
      membersInserted?: number;
    };
    sample: {
      firstAccountNumber?: string;
      firstConstituentId?: number;
      firstHouseholdId?: number;
      firstKey?: string;
    };
  } = { steps: [], counts: {}, sample: {} };

  debug.steps.push('start');

  const { id } = params;

  try {
    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseAdmin();
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : 'Supabase configuration is missing.', debug },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({} as { concurrency?: number }));
    const concurrency = Math.max(1, Math.min(10, Number(body?.concurrency) || 4));

    let apiKey: string;

    try {
      apiKey = getApiKey();
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : 'Missing API key.', debug },
        { status: 500 }
      );
    }

    debug.steps.push('load-import-rows');

    const { data: importRows, error: importError } = await supabase
      .from('outreach_list_import_rows')
      .select('account_number')
      .eq('outreach_list_id', id)
      .order('row_number');

    if (importError) {
      return NextResponse.json({ ok: false, error: importError.message, debug }, { status: 500 });
    }

    debug.counts.importRows = importRows?.length ?? 0;
    debug.sample.firstAccountNumber = importRows?.[0]?.account_number;

    if (!importRows || importRows.length === 0) {
      debug.steps.push('done');
      return NextResponse.json({ ok: true, debug, enhancedHouseholds: 0, enhancedMembers: 0, notFound: [], errors: [] });
    }

    debug.steps.push('map-account-numbers');

    const result: EnhanceResult = { enhancedHouseholds: 0, enhancedMembers: 0, notFound: [], errors: [] };

    const accountNumberMap = new Map<
      string,
      { constituentId: number; raw: Record<string, unknown> | null }
    >();

    const { data: mappedAccounts, error: mappedError } = await supabase
      .from('account_number_map')
      .select('account_number, constituent_id, raw')
      .in(
        'account_number',
        importRows.map((row) => row.account_number)
      );

    if (mappedError) {
      return NextResponse.json({ ok: false, error: mappedError.message, debug }, { status: 500 });
    }

    (mappedAccounts ?? []).forEach((row) => {
      if (row.constituent_id) {
        accountNumberMap.set(row.account_number, {
          constituentId: row.constituent_id,
          raw: (row.raw as Record<string, unknown> | null) ?? null,
        });
      }
    });

    // Clear previous enhanced rows to keep the operation idempotent and avoid constraint collisions.
    const { error: deleteMembersError } = await supabase
      .from('outreach_list_members')
      .delete()
      .eq('outreach_list_id', id);

    if (deleteMembersError) {
      return NextResponse.json({ ok: false, error: deleteMembersError.message, debug }, { status: 500 });
    }

    const { error: deleteHouseholdsError } = await supabase
      .from('outreach_list_households')
      .delete()
      .eq('outreach_list_id', id);

    if (deleteHouseholdsError) {
      return NextResponse.json({ ok: false, error: deleteHouseholdsError.message, debug }, { status: 500 });
    }

    const queue = [...importRows];
    debug.counts.mapped = queue.length;

    const executing: Promise<void>[] = [];
    const households = new Map<
      string,
      {
        householdId: number | null;
        soloConstituentId: number | null;
        snapshot: Record<string, unknown>;
        members: Map<number, Record<string, unknown>>;
        memberIds: Set<number>;
        householdType?: string;
      }
    >();
    const memberAccountNumbers = new Map<number, string>();

    debug.steps.push('bloomerang-search');

    const processNext = async () => {
      const next = queue.shift();
      if (!next) return;

      try {
        const cached = accountNumberMap.get(next.account_number);
        const parsedCached = cached?.raw ? parseCandidate(cached.raw) : null;

        const search = parsedCached?.ok ? parsedCached : await searchConstituent(next.account_number, apiKey);

        if (!parsedCached?.ok) {
          debug.counts.searched = (debug.counts.searched ?? 0) + 1;
        }

        if (!search.ok) {
          console.log('enhance:search-miss', { outreach_list_id: id, account_number: next.account_number });
          result.notFound.push(next.account_number);
          return;
        }

        if (search.resultType === 'Household') {
          debug.counts.searchHouseholdType = (debug.counts.searchHouseholdType ?? 0) + 1;
        }

        if (!search.constituentId && search.resultType !== 'Household') {
          console.log('enhance:search-miss', { outreach_list_id: id, account_number: next.account_number });
          result.notFound.push(next.account_number);
          return;
        }

        const resolvedHouseholdId = search.resultType === 'Household'
          ? search.householdId
          : Number.isFinite(search.householdId) && (search.householdId as number) > 0
            ? (search.householdId as number)
            : null;

        if (search.resultType === 'Household' && resolvedHouseholdId == null) {
          console.log('enhance:search-miss-household', { outreach_list_id: id, account_number: next.account_number });
          result.notFound.push(next.account_number);
          return;
        }

        const constituentId = search.constituentId ?? null;
        const householdKey = resolvedHouseholdId != null ? `h:${resolvedHouseholdId}` : `c:${constituentId}`;
        const householdSnapshot = buildHouseholdSnapshot(search.constituent, resolvedHouseholdId);
        const memberSnapshot = constituentId ? buildMemberSnapshot(search.constituent, householdKey) : null;

        if (constituentId) {
          memberAccountNumbers.set(constituentId, next.account_number);
        }

        if (!debug.sample.firstConstituentId) {
          debug.sample.firstConstituentId = constituentId ?? undefined;
          debug.sample.firstHouseholdId = resolvedHouseholdId ?? undefined;
          debug.sample.firstKey = householdKey;
        }

        console.log('enhance:search-success', {
          outreach_list_id: id,
          account_number: next.account_number,
          constituent_id: constituentId,
          household_id: resolvedHouseholdId,
          household_key: householdKey,
          result_type: search.resultType,
        });

        if (constituentId) {
          const { error: mapError } = await supabase.from('account_number_map').upsert({
            account_number: next.account_number,
            constituent_id: constituentId,
            raw: search.constituent,
            match_confidence: 'exact',
          });

          if (mapError) {
            result.errors.push(mapError.message);
            return;
          }
        }

        const existing = households.get(householdKey);
        if (existing) {
          if (constituentId && memberSnapshot) {
            existing.members.set(constituentId, memberSnapshot);
            existing.memberIds.add(constituentId);
          }
        } else {
          households.set(householdKey, {
            householdId: resolvedHouseholdId,
            soloConstituentId: resolvedHouseholdId ? null : constituentId,
            snapshot: householdSnapshot,
            members: constituentId && memberSnapshot ? new Map([[constituentId, memberSnapshot]]) : new Map(),
            memberIds: constituentId ? new Set([constituentId]) : new Set(),
            householdType: search.resultType,
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

    const realHouseholdEntries = Array.from(households.entries()).filter(([, value]) => value.householdId !== null);
    debug.counts.realHouseholds = realHouseholdEntries.length;
    debug.counts.soloHouseholds = households.size - realHouseholdEntries.length;

    if (realHouseholdEntries.length) {
      debug.steps.push('fetch-households');

      let fetchSuccess = 0;

      await Promise.all(
        realHouseholdEntries.map(async ([householdKey, value]) => {
          const fetched = await fetchHouseholdDetails(value.householdId as number, apiKey);
          if (!fetched.ok) {
            return;
          }

          fetchSuccess += 1;

          const memberIds = fetched.memberIds.length ? fetched.memberIds : Array.from(value.memberIds);
          const updatedSnapshot = buildHouseholdSnapshotFromHousehold(fetched.household, value.householdId);

          value.memberIds = new Set(memberIds);
          value.snapshot = { ...value.snapshot, ...updatedSnapshot };

          fetched.members.forEach((member) => {
            if (member.constituentId) {
              value.members.set(
                member.constituentId,
                buildMemberSnapshot(member.raw, householdKey)
              );
              value.memberIds.add(member.constituentId);
            }
          });
        })
      );

      debug.counts.householdFetchSuccess = fetchSuccess;
    }

    debug.steps.push('build-households');
    debug.counts.householdsPrepared = households.size;

    if (!households.size) {
      debug.steps.push('done');
      return NextResponse.json({ ok: true, ...result, debug });
    }

    const householdRows = Array.from(households.entries()).map(([_, data]) => {
      const household_key = data.householdId != null ? `h:${data.householdId}` : `c:${data.soloConstituentId}`;

      return {
        outreach_list_id: id,
        household_key,
        household_id: data.householdId ?? null,
        solo_constituent_id: data.soloConstituentId ?? null,
        origin: 'import',
        household_snapshot: data.snapshot,
      };
    });

    debug.steps.push('upsert-households');

    const householdIdMap = new Map<string, string>();

    const { data: upserts, error } = await supabase
      .from('outreach_list_households')
      .upsert(householdRows, { onConflict: 'outreach_list_id,household_key' })
      .select('id, household_key, household_id, solo_constituent_id');

    if (error) {
      result.errors.push(error.message);
      return NextResponse.json({ ok: false, ...result, debug }, { status: 500 });
    }

    (upserts ?? []).forEach((row) => {
      householdIdMap.set(row.household_key, row.id);
      console.log('enhance:household-upsert', {
        outreach_list_id: id,
        household_key: row.household_key,
        household_id: row.household_id,
        solo_constituent_id: row.solo_constituent_id,
        list_household_id: row.id,
        upsert_path: 'households-batch',
      });
    });

    debug.steps.push('upsert-members');

    const memberRows = Array.from(households.entries()).flatMap(([householdKey, data]) => {
      const outreachListHouseholdId = householdIdMap.get(householdKey);

      if (!outreachListHouseholdId) {
        result.errors.push(`Missing household mapping for key ${householdKey}`);
        return [] as {
          outreach_list_household_id: string;
          outreach_list_id: string;
          household_id: number | null;
          constituent_id: number;
          origin: string;
          member_snapshot: Record<string, unknown>;
        }[];
      }

      const memberIds = data.householdId !== null
        ? (data.memberIds.size ? Array.from(data.memberIds) : Array.from(data.members.keys()))
        : data.soloConstituentId
          ? [data.soloConstituentId]
          : [];

      return memberIds.map((constituentId) => {
        const memberSnapshot = data.members.get(constituentId) ?? buildMemberSnapshotFromId(constituentId, householdKey);
        const accountNumber = memberAccountNumbers.get(constituentId) ?? null;
        console.log('enhance:member-upsert', {
          outreach_list_id: id,
          outreach_list_household_id: outreachListHouseholdId,
          constituent_id: constituentId,
          household_id: data.householdId,
          account_number: accountNumber,
          upsert_path: 'members',
        });

        return {
          outreach_list_household_id: outreachListHouseholdId,
          outreach_list_id: id,
          household_id: data.householdId,
          constituent_id: constituentId,
          origin: 'import',
          member_snapshot: memberSnapshot,
        };
      });
    });

    debug.counts.membersPrepared = memberRows.length;
    debug.counts.avgMembersPerHousehold = households.size ? Number((memberRows.length / households.size).toFixed(2)) : 0;

    const { error: memberUpsertError } = await supabase
      .from('outreach_list_members')
      .upsert(memberRows, { onConflict: 'outreach_list_id,constituent_id' });

    if (memberUpsertError) {
      result.errors.push(memberUpsertError.message);
    }

    debug.counts.membersInserted = memberRows.length;

    result.enhancedHouseholds = households.size;
    result.enhancedMembers = memberRows.length;
    debug.steps.push('done');

    return NextResponse.json({ ok: true, ...result, debug });
  } catch (err) {
    console.error('Enhance failed', {
      outreachListId: id,
      debug,
      err: { message: (err as Error).message, stack: (err as Error).stack, name: (err as Error).name },
    });
    return Response.json(
      { ok: false, error: (err as Error).message, debug },
      { status: 500 }
    );
  }
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

  return parseCandidate(candidate as Record<string, unknown>);
}

function parseCandidate(candidate: Record<string, unknown>) {
  const resultType = pickString(candidate as Record<string, unknown>, ['Type', 'type']);
  const idValue = pickNumber(candidate as Record<string, unknown>, [
    'id',
    'Id',
    'constituentId',
    'ConstituentId',
    'accountId',
    'AccountId',
  ]);
  const householdId = resultType === 'Household'
    ? idValue
    : pickNumber(candidate as Record<string, unknown>, ['HouseholdId', 'householdId']);
  const constituentId = resultType === 'Household' ? null : idValue;

  if (!idValue && resultType !== 'Household') {
    return { ok: false as const };
  }

  return {
    ok: true as const,
    constituent: candidate,
    constituentId,
    householdId,
    resultType,
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

async function fetchHouseholdDetails(householdId: number, apiKey: string) {
  const url = new URL(`https://api.bloomerang.co/v2/households/${householdId}`);
  const result = await fetchJsonWithModes(url, apiKey);

  if (!result.ok) {
    return { ok: false as const };
  }

  const household = (result.data ?? {}) as Record<string, unknown>;
  const memberIds: number[] = [];
  const members: { constituentId: number | null; raw: Record<string, unknown> }[] = [];

  if (Array.isArray((household as { MemberIds?: unknown[] }).MemberIds)) {
    (household as { MemberIds: unknown[] }).MemberIds.forEach((id) => {
      if (Number.isFinite(id)) {
        memberIds.push(Number(id));
      }
    });
  }

  if (Array.isArray((household as { Members?: unknown[] }).Members)) {
    (household as { Members: unknown[] }).Members.forEach((member) => {
      if (member && typeof member === 'object') {
        const constituentId = pickNumber(member as Record<string, unknown>, [
          'Id',
          'id',
          'ConstituentId',
          'constituentId',
        ]);

        if (constituentId) {
          memberIds.push(constituentId);
        }

        members.push({ constituentId: constituentId ?? null, raw: member as Record<string, unknown> });
      }
    });
  }

  return { ok: true as const, household, memberIds, members };
}

function buildHouseholdSnapshotFromHousehold(household: Record<string, unknown>, householdId: number | null) {
  const primaryName = pickString(household, ['Name', 'name', 'HouseholdName', 'householdName']);
  return {
    householdId,
    displayName: primaryName || 'Household',
    source: 'bloomerang-household',
  };
}

function buildMemberSnapshotFromId(constituentId: number, householdKey: string) {
  return {
    displayName: `Constituent ${constituentId}`,
    householdKey,
    source: 'inferred-household-member',
  };
}
