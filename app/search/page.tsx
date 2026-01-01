'use client';

import { FormEvent, useEffect, useState } from 'react';

import styles from './styles.module.css';

type GivingStats = {
  lifetimeTotal: number;
  lastYearTotal: number;
  ytdTotal: number;
  lastGiftAmount: number | null;
  lastGiftDate: string | null;
};

type HouseholdTotals = GivingStats;

type MemberWithStats = {
  constituent: Record<string, unknown> | null;
  constituentId: number;
  stats?: GivingStats;
  statsDebug?: { transactionCount: number; includedCount: number; requestUrls: string[] };
  requestUrls?: string[];
  profileUrl?: string;
  statsError?: string;
  constituentError?: string;
};

type NotesSummary = {
  ok: boolean;
  summary?: {
    keyPoints: string[];
    recentTimeline: string[];
    suggestedNextSteps: string[];
  };
  notesMeta?: {
    totalFetched: number;
    usedCount: number;
    newestCreatedDate: string | null;
    oldestCreatedDate: string | null;
  };
  error?: string;
  status?: number;
};

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

type CombinedSearchResult = {
  ok: boolean;
  constituent?: unknown;
  household?: unknown | null;
  householdError?: string;
  members?: MemberWithStats[];
  householdTotals?: HouseholdTotals;
  searchUrl?: string;
  householdUrl?: string;
  bodyPreview?: string;
  error?: string;
  message?: string;
};

export default function SearchPage() {
  const [accountNumber, setAccountNumber] = useState('');
  const [result, setResult] = useState<CombinedSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesSummary, setNotesSummary] = useState<NotesSummary | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setNotesSummary(null);

    const trimmed = accountNumber.trim();
    if (!trimmed) {
      setError('Please enter an account number to search.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/bloomerang/search-with-household-and-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountNumber: trimmed }),
      });

      const payload = (await response.json()) as CombinedSearchResult;

      if (!response.ok || !payload.ok) {
        setError(payload.bodyPreview || payload.error || 'Search failed.');
        setResult(payload);
        return;
      }

      setResult(payload);
    } catch (err) {
      console.error('Search request failed', err);
      setError('Unable to complete the search request.');
    } finally {
      setLoading(false);
    }
  };

  const memberIds = (result?.members ?? [])
    .map((member) => member.constituentId)
    .filter((id) => Number.isFinite(id));

  const loadNotesSummary = async (forceRefresh = false) => {
    if (!memberIds.length) {
      setNotesSummary(null);
      return;
    }

    if (notesLoading && !forceRefresh) {
      return;
    }

    setNotesLoading(true);

    try {
      const response = await fetch('/api/bloomerang/household-notes-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ memberIds }),
      });

      const payload = (await response.json()) as NotesSummary;

      setNotesSummary(payload);
    } catch (err) {
      console.error('Notes summary request failed', err);
      setNotesSummary({ ok: false, error: 'Unable to load notes summary.' });
    } finally {
      setNotesLoading(false);
    }
  };

  useEffect(() => {
    if (!memberIds.length || loading) {
      return;
    }

    void loadNotesSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds.join('|'), loading]);

  const members = result?.members ?? [];
  const householdTotals = result?.householdTotals ?? null;

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
              Enter an account number to query Bloomerang and review the household profile with giving stats.
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
              <p className={styles.outputLabel}>Household</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : result ? (
                result.household ? (
                  <p className={styles.muted}>
                    {extractHouseholdName(result.household) ?? 'No household name found.'}
                  </p>
                ) : result.householdError ? (
                  <p className={styles.muted}>{result.householdError}</p>
                ) : members.length === 1 ? (
                  <p className={styles.muted}>Single-person household; using constituent directly.</p>
                ) : (
                  <p className={styles.muted}>No household data found.</p>
                )
              ) : (
                <p className={styles.muted}>Search for a constituent to load household info.</p>
              )}
            </div>

            <div className={styles.output}>
              <div className={styles.outputHeadingRow}>
                <p className={styles.outputLabel}>Household Notes Summary</p>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => loadNotesSummary(true)}
                  disabled={notesLoading || loading || !memberIds.length}
                >
                  {notesLoading ? 'Refreshing…' : 'Refresh Summary'}
                </button>
              </div>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : notesLoading && !notesSummary ? (
                <p className={styles.muted}>Generating summary…</p>
              ) : notesSummary?.ok && notesSummary.summary ? (
                <div className={styles.notesSummary}>
                  <div className={styles.notesSummaryGrid}>
                    <div>
                      <p className={styles.notesSummaryLabel}>Key Points</p>
                      {notesSummary.summary.keyPoints.length ? (
                        <ul className={styles.bulletList}>
                          {notesSummary.summary.keyPoints.map((point, index) => (
                            <li key={index}>{point}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.muted}>No key points returned.</p>
                      )}
                    </div>

                    <div>
                      <p className={styles.notesSummaryLabel}>Suggested Next Steps</p>
                      {notesSummary.summary.suggestedNextSteps.length ? (
                        <ul className={styles.bulletList}>
                          {notesSummary.summary.suggestedNextSteps.map((step, index) => (
                            <li key={index}>{step}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.muted}>No suggestions returned.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className={styles.notesSummaryLabel}>Recent Timeline</p>
                    {notesSummary.summary.recentTimeline.length ? (
                      <ul className={styles.bulletList}>
                        {notesSummary.summary.recentTimeline.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.muted}>No recent timeline available.</p>
                    )}
                  </div>

                  {notesSummary.notesMeta && (
                    <p className={styles.notesMeta}>
                      Notes included: {notesSummary.notesMeta.usedCount} of {notesSummary.notesMeta.totalFetched}
                      {renderDateRange(notesSummary.notesMeta)}
                    </p>
                  )}
                </div>
              ) : notesSummary ? (
                <p className={styles.error}>
                  {notesSummary.error || 'Unable to generate notes summary.'}
                </p>
              ) : (
                <p className={styles.muted}>Search for a constituent to load notes.</p>
              )}
            </div>

            <div className={styles.output}>
              <p className={styles.outputLabel}>Household Giving Summary</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : householdTotals ? (
                <div className={styles.summaryGrid}>
                  <SummaryStat label="Lifetime Total" value={formatCurrency(householdTotals.lifetimeTotal)} />
                  <SummaryStat label="Last Year Total" value={formatCurrency(householdTotals.lastYearTotal)} />
                  <SummaryStat label="YTD Total" value={formatCurrency(householdTotals.ytdTotal)} />
                  <SummaryStat
                    label="Last Gift"
                    value={householdTotals.lastGiftDate
                      ? `${formatCurrency(householdTotals.lastGiftAmount ?? 0)} on ${formatDate(householdTotals.lastGiftDate)}`
                      : 'No gifts found'}
                  />
                </div>
              ) : result ? (
                <p className={styles.muted}>No giving data available.</p>
              ) : (
                <p className={styles.muted}>Search for a constituent to see totals.</p>
              )}
            </div>

            <div className={styles.output}>
              <p className={styles.outputLabel}>Household Members</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : members.length ? (
                <ul className={styles.memberList}>
                  {members.map((member) => {
                    const name = member.constituent
                      ? buildMemberName(member.constituent, member.constituentId)
                      : `Constituent ${member.constituentId}`;
                    const phone = member.constituent ? pickString(member.constituent, [
                      'PrimaryPhone.Number',
                      'primaryPhone.number',
                      'primaryPhone.Number',
                      'PrimaryPhone.number',
                    ]) : undefined;
                    const email = member.constituent ? pickString(member.constituent, [
                      'PrimaryEmail.Value',
                      'primaryEmail.value',
                      'primaryEmail.Value',
                      'PrimaryEmail.value',
                    ]) : undefined;

                    return (
                      <li key={member.constituentId} className={styles.memberItem}>
                        <div className={styles.memberName}>{name}</div>
                        <div className={styles.memberMeta}>
                          <span className={styles.metaPill}>ID: {member.constituentId}</span>
                          {phone && <span className={styles.metaPill}>Phone: {phone}</span>}
                          {email && <span className={styles.metaPill}>Email: {email}</span>}
                        </div>
                        {member.stats ? (
                          <div className={styles.statsTable}>
                            <StatsRow label="Lifetime" value={formatCurrency(member.stats.lifetimeTotal)} />
                            <StatsRow label="Last Year" value={formatCurrency(member.stats.lastYearTotal)} />
                            <StatsRow label="YTD" value={formatCurrency(member.stats.ytdTotal)} />
                            <StatsRow
                              label="Last Gift Amount"
                              value={member.stats.lastGiftAmount !== null
                                ? formatCurrency(member.stats.lastGiftAmount)
                                : '—'}
                            />
                            <StatsRow
                              label="Last Gift Date"
                              value={member.stats.lastGiftDate ? formatDate(member.stats.lastGiftDate) : '—'}
                            />
                          </div>
                        ) : (
                          <p className={styles.muted}>
                            Stats unavailable{member.statsError ? `: ${member.statsError}` : ''}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : result ? (
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

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryCard}>
      <p className={styles.summaryLabel}>{label}</p>
      <p className={styles.summaryValue}>{value}</p>
    </div>
  );
}

function StatsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function renderDateRange(meta: { newestCreatedDate: string | null; oldestCreatedDate: string | null }) {
  if (!meta.newestCreatedDate || !meta.oldestCreatedDate) {
    return '';
  }

  const newest = formatDate(meta.newestCreatedDate);
  const oldest = formatDate(meta.oldestCreatedDate);

  return ` (date range ${oldest} – ${newest})`;
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

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readValue(source, key);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}
