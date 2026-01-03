import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { fetchJsonWithModes, getApiKey, normalizeBoolean, pickNumber, pickString, readValue } from '../../../bloomerang/utils';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

type EnhanceResult = {
  enhancedHouseholds: number;
  enhancedMembers: number;
  notFound: string[];
  errors: string[];
};

type MemberSnapshot = {
  displayName: string;
  householdKey: string;
  source: string;
  email?: string;
  phone?: string;
  householdId?: number | null;
  restrictions?: unknown;
  headOfHousehold?: boolean;
  constituentId?: number;
};

type HouseholdGroup = {
  householdId: number | null;
  soloConstituentId: number | null;
  snapshot: Record<string, unknown>;
  members: Map<number, MemberSnapshot>;
  memberIds: Set<number>;
  householdType?: string;
  hasSearchMemberIds?: boolean;
  headId?: number | null;
  householdPayload?: Record<string, unknown>;
};

type HydratedConstituent = {
  id: number;
  payload: Record<string, unknown>;
  householdId: number | null;
  displayName: string;
  email?: string;
  phone?: string;
  restrictions?: unknown;
};

type ConstituentBatchResult = {
  ok: boolean;
  payloads: HydratedConstituent[];
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
      householdFetchAttempted?: number;
      householdFetchFailed?: number;
      constituentHydrationAttempted?: number;
      constituentHydrationSuccess?: number;
      constituentHydrationFailed?: number;
      membersHydrated?: number;
      membersWithContact?: number;
      avgMembersPerHousehold?: number;
      membersInserted?: number;
    };
    sample: {
      firstAccountNumber?: string;
      firstConstituentId?: number;
      firstHouseholdId?: number;
      firstKey?: string;
      fetchedHouseholdIds?: number[];
      firstMemberEmail?: string;
      firstMemberPhone?: string;
    };
    householdFetch?: {
      statusCounts: Record<string, number>;
      sampleFailures: { householdId: number; url: string; status?: number; bodySnippet?: string }[];
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

    const queue = [...importRows];
    debug.counts.mapped = queue.length;

    const executing: Promise<void>[] = [];
    const households = new Map<string, HouseholdGroup>();
    const memberAccountNumbers = new Map<number, string>();
    const constituentIdsToHydrate = new Set<number>();

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

        const memberIdsFromSearch: number[] =
          search.resultType === 'Household' && Array.isArray((search.constituent as { MemberIds?: unknown[] }).MemberIds)
            ? (search.constituent as { MemberIds: unknown[] }).MemberIds.filter((id) => Number.isFinite(id)).map((id) => Number(id))
            : [];

        if (constituentId) {
          memberAccountNumbers.set(constituentId, next.account_number);
          constituentIdsToHydrate.add(constituentId);
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
          if (memberIdsFromSearch.length) {
            memberIdsFromSearch.forEach((memberId) => existing.memberIds.add(memberId));
            existing.hasSearchMemberIds = true;
          }
        } else {
          households.set(householdKey, {
            householdId: resolvedHouseholdId,
            soloConstituentId: resolvedHouseholdId ? null : constituentId,
            snapshot: householdSnapshot,
            members: constituentId && memberSnapshot ? new Map([[constituentId, memberSnapshot]]) : new Map(),
            memberIds: memberIdsFromSearch.length
              ? new Set(memberIdsFromSearch)
              : constituentId
                ? new Set([constituentId])
                : new Set(),
            householdType: search.resultType,
            hasSearchMemberIds: memberIdsFromSearch.length > 0,
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
      debug.householdFetch = { statusCounts: {}, sampleFailures: [] };

      const householdFetchQueue = [...realHouseholdEntries];
      let fetchSuccess = 0;
      let fetchAttempted = 0;
      let fetchFailed = 0;
      const firstIds: number[] = [];

      const processFetchQueue = async () => {
        const next = householdFetchQueue.shift();
        if (!next) return;

        const [householdKey, value] = next;
        const householdId = value.householdId as number;

        if (firstIds.length < 3) {
          firstIds.push(householdId);
        }

        fetchAttempted += 1;

        const fetched = await fetchHouseholdDetailsWithRetry(householdId, apiKey, debug.householdFetch!);

        if (!fetched.ok) {
          fetchFailed += 1;
          const fallbackMemberId = value.memberIds.size ? Array.from(value.memberIds)[0] : null;

          if (fallbackMemberId && !value.members.has(fallbackMemberId)) {
            value.members.set(fallbackMemberId, {
              displayName: `Constituent ${fallbackMemberId}`,
              householdKey,
              source: 'fallback-no-household-fetch',
            });
          }

          return;
        }

        fetchSuccess += 1;

        const memberIds = fetched.memberIds.length ? fetched.memberIds : Array.from(value.memberIds);
        const updatedSnapshot = buildHouseholdSnapshotFromHousehold(fetched.household, value.householdId);

        value.memberIds = new Set(memberIds);
        value.snapshot = { ...value.snapshot, ...updatedSnapshot };
        value.headId = pickNumber(fetched.household, ['HeadId', 'headId']);
        value.householdPayload = fetched.household;

        fetched.members.forEach((member) => {
          if (member.constituentId) {
            value.members.set(
              member.constituentId,
              buildMemberSnapshot(member.raw, householdKey)
            );
            value.memberIds.add(member.constituentId);
            constituentIdsToHydrate.add(member.constituentId);
          }
        });
      };

      const fetchConcurrency = Math.min(5, households.size || 1);
      const fetchExecutors: Promise<void>[] = [];
      for (let i = 0; i < fetchConcurrency; i += 1) {
        fetchExecutors.push((async () => {
          while (householdFetchQueue.length) {
            await processFetchQueue();
          }
        })());
      }

      await Promise.all(fetchExecutors);

      debug.counts.householdFetchSuccess = fetchSuccess;
      debug.counts.householdFetchAttempted = fetchAttempted;
      debug.counts.householdFetchFailed = fetchFailed;
      if (firstIds.length) {
        debug.sample.fetchedHouseholdIds = firstIds;
      }

      const householdCacheRows = realHouseholdEntries
        .map(([, value]) => value)
        .filter((value) => value.householdPayload)
        .map((value) => ({
          household_id: value.householdId as number,
          payload: value.householdPayload,
          display_name: pickString(value.householdPayload ?? {}, ['Name', 'FullName', 'HouseholdName']) ?? 'Household',
          last_refreshed_at: new Date().toISOString(),
        }));

      if (householdCacheRows.length) {
        await supabase
          .from('households')
          .upsert(householdCacheRows, { onConflict: 'household_id' });
      }
    }

    debug.steps.push('build-households');
    debug.counts.householdsPrepared = households.size;

    if (!households.size) {
      debug.steps.push('done');
      return NextResponse.json({ ok: true, ...result, debug });
    }

    // Determine all member constituent ids to hydrate
    const allMemberIds = new Set<number>();
    households.forEach((group) => {
      if (group.householdId !== null) {
        group.memberIds.forEach((memberId) => allMemberIds.add(memberId));
      } else if (group.soloConstituentId) {
        allMemberIds.add(group.soloConstituentId);
      }
    });

    debug.counts.membersHydrated = allMemberIds.size;

    const hydratedMembers = await hydrateConstituents(Array.from(allMemberIds), apiKey, debug);
    const hydratedMap = new Map<number, HydratedConstituent>();
    hydratedMembers.payloads.forEach((payload) => {
      hydratedMap.set(payload.id, payload);
    });

    if (hydratedMembers.ok) {
      debug.counts.constituentHydrationSuccess = hydratedMembers.payloads.length;
    } else {
      debug.counts.constituentHydrationFailed = (debug.counts.constituentHydrationAttempted ?? 0) - (debug.counts.constituentHydrationSuccess ?? 0);
    }

    // Cache hydrated constituents
    if (hydratedMembers.payloads.length) {
      const constituentRows = hydratedMembers.payloads.map((item) => ({
        account_id: item.id,
        household_id: item.householdId,
        payload: item.payload,
        display_name: item.displayName,
        last_refreshed_at: new Date().toISOString(),
      }));

      await supabase.from('constituents').upsert(constituentRows, { onConflict: 'account_id' });
    }

    // Update member snapshots with hydrated data
    households.forEach((group, householdKey) => {
      const memberIds = group.householdId !== null
        ? (group.memberIds.size ? Array.from(group.memberIds) : Array.from(group.members.keys()))
        : group.soloConstituentId
          ? [group.soloConstituentId]
          : [];

      memberIds.forEach((memberId) => {
        const hydrated = hydratedMap.get(memberId);
        if (hydrated) {
          const snapshot = buildMemberSnapshotFromPayload(hydrated, householdKey, group.headId ?? null);
          group.members.set(memberId, snapshot);
        } else if (!group.members.has(memberId)) {
          group.members.set(memberId, buildMemberSnapshotFromId(memberId, householdKey));
        }
      });
    });

    const nowIso = new Date().toISOString();

    const householdRows = Array.from(households.entries()).map(([_, data]) => {
      const household_key = data.householdId != null ? `h:${data.householdId}` : `c:${data.soloConstituentId}`;
      const memberCount = data.memberIds.size || data.members.size;
      const displayName = data.snapshot?.displayName || (data.householdPayload ? pickString(data.householdPayload, ['Name', 'FullName', 'HouseholdName']) : undefined);

      return {
        outreach_list_id: id,
        household_key,
        household_id: data.householdId ?? null,
        solo_constituent_id: data.soloConstituentId ?? null,
        origin: 'import',
        household_snapshot: {
          ...data.snapshot,
          headId: data.headId ?? undefined,
          memberCount,
          displayName: displayName || data.snapshot?.displayName || 'Household',
          lastRefreshedAt: nowIso,
        },
      };
    });

    debug.steps.push('upsert-households');

    const householdIdMap = new Map<string, string>();

    const realRows = householdRows.filter((row) => row.household_id !== null);
    const soloRows = householdRows.filter((row) => row.household_id === null);

    if (realRows.length) {
      const { data: upserts, error } = await supabase
        .from('outreach_list_households')
        .upsert(realRows, { onConflict: 'outreach_list_id,household_id' })
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
          upsert_path: 'households-real',
        });
      });
    }

    if (soloRows.length) {
      const { data: upserts, error } = await supabase
        .from('outreach_list_households')
        .upsert(soloRows, { onConflict: 'outreach_list_id,household_key' })
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
          upsert_path: 'households-solo',
        });
      });
    }

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
        const email = typeof memberSnapshot.email === 'string' ? memberSnapshot.email : undefined;
        const phone = typeof memberSnapshot.phone === 'string' ? memberSnapshot.phone : undefined;

        if (!debug.sample.firstMemberEmail && email) {
          debug.sample.firstMemberEmail = email;
        }

        if (!debug.sample.firstMemberPhone && phone) {
          debug.sample.firstMemberPhone = phone;
        }

        if (email || phone) {
          debug.counts.membersWithContact = (debug.counts.membersWithContact ?? 0) + 1;
        }

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

function buildMemberSnapshot(constituent: Record<string, unknown>, householdKey: string): MemberSnapshot {
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
    return { ok: false as const, status: result.status, bodySnippet: result.bodyPreview, url: result.url };
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

  return { ok: true as const, household, memberIds, members, status: result.status, url: result.url };
}

async function fetchHouseholdDetailsWithRetry(
  householdId: number,
  apiKey: string,
  debugFetch: { statusCounts: Record<string, number>; sampleFailures: { householdId: number; url: string; status?: number; bodySnippet?: string }[] }
) {
  const maxAttempts = 3;
  let delayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchHouseholdDetails(householdId, apiKey);

    const statusKey = response.status ? String(response.status) : 'unknown';
    debugFetch.statusCounts[statusKey] = (debugFetch.statusCounts[statusKey] ?? 0) + 1;

    if (response.ok) {
      return response;
    }

    if (debugFetch.sampleFailures.length < 3) {
      debugFetch.sampleFailures.push({
        householdId,
        url: response.url ?? '',
        status: response.status,
        bodySnippet: response.bodySnippet,
      });
    }

    if (response.status === 429 && attempt < maxAttempts) {
      await sleep(delayMs);
      delayMs *= 2;
      continue;
    }

    if ((response.status === 401 || response.status === 403) && attempt < maxAttempts) {
      await sleep(delayMs);
      delayMs *= 2;
      continue;
    }

    return response;
  }

  return { ok: false as const, status: undefined, url: `https://api.bloomerang.co/v2/households/${householdId}` };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHouseholdSnapshotFromHousehold(household: Record<string, unknown>, householdId: number | null) {
  const primaryName = pickString(household, ['Name', 'name', 'HouseholdName', 'householdName']);
  const memberIds = Array.isArray((household as { MemberIds?: unknown[] }).MemberIds)
    ? (household as { MemberIds: unknown[] }).MemberIds.filter((id) => Number.isFinite(id)).map((id) => Number(id))
    : [];
  return {
    householdId,
    displayName: primaryName || 'Household',
    source: 'bloomerang-household',
    memberCount: memberIds.length || undefined,
  };
}

function buildMemberSnapshotFromId(constituentId: number, householdKey: string): MemberSnapshot {
  return {
    displayName: `Constituent ${constituentId}`,
    householdKey,
    source: 'inferred-household-member',
  };
}

function buildMemberSnapshotFromPayload(
  constituent: HydratedConstituent,
  householdKey: string,
  headId: number | null
): MemberSnapshot {
  return {
    constituentId: constituent.id,
    displayName: constituent.displayName,
    email: constituent.email,
    phone: constituent.phone,
    householdId: constituent.householdId,
    restrictions: constituent.restrictions,
    householdKey,
    headOfHousehold: headId != null && headId === constituent.id,
    source: 'constituent-cache',
  };
}

async function hydrateConstituents(ids: number[], apiKey: string, debug: { counts: Record<string, number> }): Promise<ConstituentBatchResult> {
  const chunks = chunk(ids, 25);
  const payloads: HydratedConstituent[] = [];
  let ok = true;

  for (const chunkIds of chunks) {
    debug.counts.constituentHydrationAttempted = (debug.counts.constituentHydrationAttempted ?? 0) + chunkIds.length;
    const url = new URL('https://api.bloomerang.co/v2/constituents');
    url.searchParams.set('id', chunkIds.join('|'));

    const response = await fetchJsonWithModes(url, apiKey);

    if (!response.ok) {
      ok = false;
      continue;
    }

    const data = Array.isArray(response.data)
      ? response.data
      : Array.isArray((response.data as { Results?: unknown[] })?.Results)
        ? (response.data as { Results: unknown[] }).Results
        : [];

    data.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const constituentId = pickNumber(raw as Record<string, unknown>, ['Id', 'id', 'AccountId', 'accountId', 'ConstituentId']);
      if (!constituentId) return;

      const displayName = pickString(raw as Record<string, unknown>, ['FullName', 'Name', 'InformalName', 'Informal']) || `Constituent ${constituentId}`;
      const email = pickString(raw as Record<string, unknown>, ['PrimaryEmail.Value', 'PrimaryEmail', 'Email', 'Email.Value']);
      const phone = pickString(raw as Record<string, unknown>, ['PrimaryPhone.Number', 'PrimaryPhone', 'Phone', 'Phone.Number']);
      const householdId = pickNumber(raw as Record<string, unknown>, ['HouseholdId', 'householdId']);
      const restrictions = (raw as Record<string, unknown>).CommunicationRestrictions ?? readValue(raw as Record<string, unknown>, 'CommunicationRestrictions');

      payloads.push({
        id: constituentId,
        payload: raw as Record<string, unknown>,
        householdId: householdId ?? null,
        displayName,
        email: email ?? undefined,
        phone: phone ?? undefined,
        restrictions: restrictions ?? undefined,
      });
    });
  }

  return { ok, payloads };
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
