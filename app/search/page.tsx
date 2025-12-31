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
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [singlePersonHousehold, setSinglePersonHousehold] = useState(false);
  const [constituentName, setConstituentName] = useState<string | null>(null);
  const [searchedAccountNumber, setSearchedAccountNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setHouseholdResult(null);
    setHouseholdError(null);
    setMembers([]);
    setSinglePersonHousehold(false);
    setConstituentName(null);
    setSearchedAccountNumber('');

    const trimmed = accountNumber.trim();
    if (!trimmed) {
      setError('Please enter an account number to search.');
      return;
    }

    setSearchedAccountNumber(trimmed);

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

      setConstituentName(extractConstituentName(payload.data));

      const isInHousehold = extractIsInHousehold(payload.data);

      if (isInHousehold === false) {
        setSinglePersonHousehold(true);
        return;
      }

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

      const memberDetailsFromHousehold = extractMembers(householdPayload.data);

      if (memberDetailsFromHousehold.length) {
        setMembers(memberDetailsFromHousehold);
        return;
      }

      const memberIds = extractMemberIds(householdPayload.data);

      if (!memberIds.length) {
        setMembers([]);
        return;
      }

      const fetchedMembers = await fetchMembersByIds(memberIds);
      setMembers(fetchedMembers);
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
                <ul className={styles.memberList}>
                  <li className={styles.memberItem}>
                    <div className={styles.memberName}>Account Number</div>
                    <div className={styles.memberMeta}>
                      <span className={styles.metaPill}>{searchedAccountNumber}</span>
                    </div>
                  </li>
                  <li className={styles.memberItem}>
                    <div className={styles.memberName}>Constituent ID</div>
                    <div className={styles.memberMeta}>
                      <span className={styles.metaPill}>{extractConstituentId(result.data) ?? 'Not found'}</span>
                    </div>
                  </li>
                </ul>
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
              ) : singlePersonHousehold ? (
                constituentName ? (
                  <p className={styles.muted}>{constituentName}</p>
                ) : (
                  <p className={styles.muted}>Single-person household; skipping household lookup.</p>
                )
              ) : householdResult ? (
                <p className={styles.muted}>
                  {extractHouseholdName(householdResult.data) ?? 'No household name found.'}
                </p>
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
              ) : singlePersonHousehold ? (
                constituentName ? (
                  <ul className={styles.memberList}>
                    <li className={styles.memberItem} key="single-person-household">
                      <div className={styles.memberName}>{constituentName}</div>
                      <div className={styles.memberMeta}>
                        <span className={styles.metaPill}>Single-member household</span>
                      </div>
                    </li>
                  </ul>
                ) : (
                  <p className={styles.muted}>Single-person household; no additional members.</p>
                )
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

async function fetchMembersByIds(memberIds: number[]): Promise<HouseholdMember[]> {
  const responses = await Promise.all(memberIds.map(async (id) => {
    try {
      const response = await fetch('/api/bloomerang/constituent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ constituentId: id }),
      });

      const payload = (await response.json()) as SearchResult;

      if (!response.ok || !payload.ok) {
        return null;
      }

      return buildMemberFromConstituentPayload(payload.data);
    } catch (error) {
      console.error('Failed to fetch member', { id, error });
      return null;
    }
  }));

  return responses.filter((member): member is HouseholdMember => !!member);
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

function extractHouseholdName(data: unknown): string | null {
  const householdName = pickString((data as Record<string, unknown>) ?? {}, [
    'RecognitionName',
    'recognitionName',
    'FullName',
    'name',
    'Name',
    'householdName',
    'HouseholdName',
  ]);

  if (householdName) {
    return householdName;
  }

  const firstResult = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results[0]
    : null;

  if (firstResult && typeof firstResult === 'object') {
    const nestedName = pickString(firstResult as Record<string, unknown>, [
      'RecognitionName',
      'recognitionName',
      'FullName',
      'name',
      'Name',
      'householdName',
      'HouseholdName',
    ]);

    if (nestedName) {
      return nestedName;
    }
  }

  return null;
}

function extractIsInHousehold(data: unknown): boolean | null {
  const firstResult = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results[0]
    : null;

  const value = (firstResult as { IsInHousehold?: unknown; isInHousehold?: unknown } | null)?.IsInHousehold
    ?? (firstResult as { isInHousehold?: unknown } | null)?.isInHousehold;

  return normalizeBoolean(value);
}

function extractConstituentName(data: unknown): string | null {
  const firstResult = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results[0]
    : null;

  if (!firstResult || typeof firstResult !== 'object') {
    return null;
  }

  const fromFullName = pickString(firstResult as Record<string, unknown>, ['fullName', 'FullName']);
  if (fromFullName) {
    return fromFullName;
  }

  const first = pickString(firstResult as Record<string, unknown>, ['firstName', 'FirstName']);
  const last = pickString(firstResult as Record<string, unknown>, ['lastName', 'LastName']);
  const combined = `${first ?? ''} ${last ?? ''}`.trim();

  if (combined) {
    return combined;
  }

  const fallbackId = pickNumber(firstResult as Record<string, unknown>, [
    'accountNumber',
    'AccountNumber',
    'constituentId',
    'ConstituentId',
    'id',
    'Id',
  ]);

  return fallbackId !== null ? `Constituent ${fallbackId}` : null;
}

function extractConstituentId(data: unknown): number | null {
  const firstResult = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results[0]
    : null;

  if (!firstResult || typeof firstResult !== 'object') {
    return null;
  }

  return pickNumber(firstResult as Record<string, unknown>, [
    'id',
    'Id',
    'constituentId',
    'ConstituentId',
    'accountNumber',
    'AccountNumber',
  ]);
}

function extractMemberIds(data: unknown): number[] {
  const root = (data as { MemberIds?: unknown; memberIds?: unknown; Results?: unknown[] }) ?? {};

  const gatherIds = (value: unknown): number[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
      .filter((id): id is number => Number.isFinite(id));
  };

  const rootIds = gatherIds(root.MemberIds ?? root.memberIds);

  if (rootIds.length) {
    return rootIds;
  }

  const firstResult = Array.isArray(root.Results)
    ? root.Results[0]
    : null;

  if (firstResult && typeof firstResult === 'object') {
    return gatherIds((firstResult as { MemberIds?: unknown; memberIds?: unknown }).MemberIds
      ?? (firstResult as { memberIds?: unknown }).memberIds);
  }

  return [];
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

function buildMemberFromConstituentPayload(data: unknown): HouseholdMember | null {
  const record = normalizeRecord(data);

  if (!record) {
    return null;
  }

  const id = pickNumber(record, ['id', 'Id', 'accountNumber', 'AccountNumber', 'constituentId', 'ConstituentId']);

  if (!Number.isFinite(id)) {
    return null;
  }

  const name = buildMemberName(record, id as number);
  const phone = pickString(record, [
    'PrimaryPhone.Number',
    'primaryPhone.number',
    'primaryPhone.Number',
    'PrimaryPhone.number',
  ]);
  const email = pickString(record, [
    'PrimaryEmail.Value',
    'primaryEmail.value',
    'primaryEmail.Value',
    'PrimaryEmail.value',
  ]);

  return { id: id as number, name, phone, email };
}

function getMemberArray(data: unknown): Array<Record<string, unknown>> {
  const candidate = (data as { members?: unknown; Members?: unknown; Results?: unknown[] }) ?? {};
  const fromRoot = Array.isArray(candidate.members)
    ? candidate.members
    : Array.isArray(candidate.Members)
      ? candidate.Members
      : null;

  if (fromRoot) {
    return fromRoot.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
  }

  const firstResult = Array.isArray(candidate.Results)
    ? candidate.Results[0]
    : null;

  if (firstResult && typeof firstResult === 'object') {
    const nested = Array.isArray((firstResult as { members?: unknown; Members?: unknown }).members)
      ? (firstResult as { members: unknown[] }).members
      : Array.isArray((firstResult as { Members?: unknown }).Members)
        ? (firstResult as { Members: unknown[] }).Members
        : [];

    return nested.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
  }

  return [];
}

function normalizeRecord(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object') {
    const fromResults = Array.isArray((data as { Results?: unknown[] }).Results)
      ? (data as { Results: unknown[] }).Results[0]
      : null;

    if (fromResults && typeof fromResults === 'object') {
      return fromResults as Record<string, unknown>;
    }

    return data as Record<string, unknown>;
  }

  return null;
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

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  return null;
}

function readValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}
