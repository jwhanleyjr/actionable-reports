'use client';

import { FormEvent, useState } from 'react';

import styles from './styles.module.css';

type SearchResult = {
  ok: boolean;
  url?: string;
  status?: number;
  contentType?: string | null;
  data?: unknown;
  bodyPreview?: string;
  error?: string;
  message?: string;
};

type HouseholdMember = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
};

export default function SearchPage() {
  const [accountNumber, setAccountNumber] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [householdResult, setHouseholdResult] = useState<SearchResult | null>(null);
  const [householdError, setHouseholdError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setHouseholdResult(null);
    setHouseholdError(null);
    setMemberError(null);
    setMembers([]);

    const trimmed = accountNumber.trim();
    if (!trimmed) {
      setError('Please enter an account number to search.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/bloomerang/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountNumber: trimmed }),
      });

      const payload = (await response.json()) as SearchResult;

      if (!response.ok || !payload.ok) {
        setError(payload.bodyPreview || payload.error || 'Search failed.');
        return;
      }

      setResult(payload);

      const householdId = extractHouseholdId(payload.data);

      if (!householdId) {
        setHouseholdError('No HouseholdId on this constituent.');
        return;
      }

      const householdResponse = await fetch('/api/bloomerang/household', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ householdId }),
      });

      const householdPayload = (await householdResponse.json()) as SearchResult;

      setHouseholdResult(householdPayload);

      if (!householdResponse.ok || !householdPayload.ok) {
        setHouseholdError(householdPayload.bodyPreview || householdPayload.error || 'Household lookup failed.');
        return;
      }

      const memberIds = extractMemberIds(householdPayload.data);

      if (!memberIds.length) {
        setMembers([]);
        return;
      }

      const { members: fetchedMembers, failedIds } = await fetchMembersById(memberIds);

      setMembers(fetchedMembers);

      if (failedIds.length === memberIds.length) {
        setMemberError('Failed to load household members.');
      } else if (failedIds.length > 0) {
        setMemberError(`Some household members failed to load: ${failedIds.join(', ')}.`);
      } else {
        setMemberError(null);
      }
    } catch (err) {
      console.error('Search request failed', err);
      setError('Unable to complete the search request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.navbar}>
          <span className={styles.brand}>Bloomerang Calls</span>
          <button type="button" className={styles.navButton}>
            New Call Campaign
          </button>
        </div>

        <div className={styles.card}>
          <header className={styles.header}>
            <p className={styles.kicker}>Campaign Workspace</p>
            <h1 className={styles.title}>Bloomerang Search Tester</h1>
            <p className={styles.subtitle}>
              Enter an account number to query Bloomerang and review the raw search response.
            </p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="accountNumber">
                Account Number
              </label>
              <input
                id="accountNumber"
                name="accountNumber"
                type="text"
                autoComplete="off"
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value)}
                placeholder="2872456"
                className={styles.input}
              />
            </div>

            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.outputStack}>
            <div className={styles.output}>
              <p className={styles.outputLabel}>Constituent Search</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : result ? (
                <pre className={styles.pre}>{JSON.stringify(result, null, 2)}</pre>
              ) : (
                <p className={styles.muted}>Submit a search to see results here.</p>
              )}
            </div>

            <div className={styles.output}>
              <p className={styles.outputLabel}>Household</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : householdError ? (
                <p className={styles.muted}>{householdError}</p>
              ) : householdResult ? (
                <pre className={styles.pre}>{JSON.stringify(householdResult, null, 2)}</pre>
              ) : (
                <p className={styles.muted}>Search for a constituent to load household info.</p>
              )}
            </div>

            <div className={styles.output}>
              <p className={styles.outputLabel}>Household Members</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : householdError ? (
                <p className={styles.muted}>{householdError}</p>
              ) : members.length ? (
                <ul className={styles.memberList}>
                  {members.map((member) => (
                    <li key={member.id} className={styles.memberItem}>
                      <div className={styles.memberName}>{member.name}</div>
                      <div className={styles.memberMeta}>
                        <span className={styles.metaPill}>ID: {member.id}</span>
                        {member.phone && <span className={styles.metaPill}>Phone: {member.phone}</span>}
                        {member.email && <span className={styles.metaPill}>Email: {member.email}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : memberError ? (
                <p className={styles.muted}>{memberError}</p>
              ) : householdResult ? (
                <p className={styles.muted}>No household members returned.</p>
              ) : (
                <p className={styles.muted}>Search for a constituent to see their household members.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function extractHouseholdId(data: unknown): number | null {
  const firstResult = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results[0]
    : null;

  const value = (firstResult as { HouseholdId?: unknown; householdId?: unknown } | null)?.HouseholdId
    ?? (firstResult as { householdId?: unknown } | null)?.householdId;

  const id = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(id) ? id : null;
}

async function fetchMembersById(memberIds: number[]): Promise<{ members: HouseholdMember[]; failedIds: number[] }> {
  const lookups = await Promise.all(memberIds.map(async (memberId) => {
    try {
      const response = await fetch(`/api/bloomerang/constituent/${memberId}`);
      const payload = (await response.json()) as SearchResult;

      if (!response.ok || !payload.ok) {
        return { memberId, member: null as HouseholdMember | null };
      }

      const member = buildMemberFromConstituent(payload.data, memberId);

      return { memberId, member };
    } catch (error) {
      console.error('Member lookup failed', error);
      return { memberId, member: null as HouseholdMember | null };
    }
  }));

  const members = lookups.reduce<HouseholdMember[]>((acc, lookup) => {
    if (lookup.member) {
      acc.push(lookup.member);
    }

    return acc;
  }, []);

  const failedIds = lookups
    .filter((lookup) => !lookup.member)
    .map((lookup) => lookup.memberId);

  return { members, failedIds };
}

function extractMembers(data: unknown): HouseholdMember[] {
  const members = getMemberArray(data);

  return members.reduce<HouseholdMember[]>((acc, member) => {
    const id = pickNumber(member, ['accountId', 'AccountId', 'constituentId', 'ConstituentId']);

    if (!Number.isFinite(id)) {
      return acc;
    }

    const name = buildMemberName(member, id as number);
    const phone = pickString(member, [
      'PrimaryPhone.Number',
      'primaryPhone.number',
      'primaryPhone.Number',
      'PrimaryPhone.number',
    ]);
    const email = pickString(member, [
      'PrimaryEmail.Value',
      'primaryEmail.value',
      'primaryEmail.Value',
      'PrimaryEmail.value',
    ]);

    acc.push({ id: id as number, name, phone, email });

    return acc;
  }, []);
}

function extractMemberIds(data: unknown): number[] {
  const ids = new Set<number>();
  const candidate = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const firstResult = Array.isArray((candidate as { Results?: unknown[] } | null)?.Results)
    ? (candidate as { Results: unknown[] }).Results[0]
    : null;

  const sources = [candidate, firstResult].filter((value): value is Record<string, unknown> => !!value);

  for (const source of sources) {
    const rawIds = readValue(source, 'MemberIds') ?? readValue(source, 'memberIds');

    if (Array.isArray(rawIds)) {
      rawIds.forEach((id) => {
        const numeric = typeof id === 'number' ? id : Number(id);
        if (Number.isFinite(numeric)) {
          ids.add(numeric);
        }
      });
    }
  }

  if (!ids.size) {
    return extractMembers(data).map((member) => member.id);
  }

  return Array.from(ids.values());
}

function getMemberArray(data: unknown): Array<Record<string, unknown>> {
  const candidate = (data as { members?: unknown; Members?: unknown }) ?? {};
  const collection = Array.isArray(candidate.members)
    ? candidate.members
    : Array.isArray(candidate.Members)
      ? candidate.Members
      : [];

  return collection.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = readValue(source, key);
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readValue(source, key);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function buildMemberName(member: Record<string, unknown>, fallbackId: number) {
  const fullName = pickString(member, ['fullName', 'FullName']);

  if (fullName) {
    return fullName;
  }

  const first = pickString(member, ['firstName', 'FirstName']) ?? '';
  const last = pickString(member, ['lastName', 'LastName']) ?? '';
  const joined = `${first} ${last}`.trim();

  return joined || `Constituent ${fallbackId}`;
}

function buildMemberFromConstituent(data: unknown, fallbackId: number): HouseholdMember | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  const id = pickNumber(record, ['accountId', 'AccountId', 'constituentId', 'ConstituentId', 'id', 'Id']);
  const resolvedId = Number.isFinite(id) ? id : fallbackId;

  if (!Number.isFinite(resolvedId)) {
    return null;
  }

  const name = buildMemberName(record, resolvedId as number);
  const phone = pickString(record, [
    'primaryPhone.number',
    'primaryPhone.Number',
    'PrimaryPhone.number',
    'PrimaryPhone.Number',
  ]);
  const email = pickString(record, [
    'primaryEmail.value',
    'primaryEmail.Value',
    'PrimaryEmail.value',
    'PrimaryEmail.Value',
  ]);

  return {
    id: resolvedId as number,
    name,
    phone,
    email,
  };
}

function readValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}
