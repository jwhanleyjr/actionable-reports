'use client';

import { useEffect, useMemo, useState } from 'react';

import styles from './page.module.css';

type HouseholdMember = {
  accountId: number;
  constituent: Record<string, unknown> | null;
};

type Household = {
  householdId: number;
  household: Record<string, unknown> | null;
  members: HouseholdMember[];
};

type HouseholdsResponse = {
  campaignId: string;
  households: Household[];
  counts?: {
    households: number;
    members: number;
  };
  error?: string;
};

function isUuid(value: string | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function CampaignPage({ params }: { params: { id: string } }) {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const campaignId = useMemo(() => params.id, [params.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadHouseholds() {
      setLoading(true);
      setError(null);

      if (!isUuid(campaignId)) {
        setError('The campaign id is invalid. Please return to the dashboard and try again.');
        setHouseholds([]);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/campaigns/${campaignId}/households`, {
          cache: 'no-store',
        });

        const payload: HouseholdsResponse = await response.json();

        if (!response.ok) {
          if (response.status === 404) {
            setError('We could not find that campaign. Please return to the dashboard and try again.');
          } else {
            setError(payload.error || 'Failed to load households');
          }
          setHouseholds([]);
          return;
        }

        if (!cancelled) {
          setHouseholds(payload.households || []);
        }
      } catch (fetchError) {
        console.error(fetchError);
        if (!cancelled) {
          setError('Unable to load campaign results');
          setHouseholds([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHouseholds();

    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const content = useMemo(() => {
    if (loading) {
      return <div className={styles.notice}>Loading households…</div>;
    }

    if (error) {
      return <div className={styles.error}>{error}</div>;
    }

    if (!households.length) {
      return <div className={styles.notice}>No households found for this campaign yet.</div>;
    }

    return (
      <div className={styles.list}>
        {households.map((household) => (
          <details key={household.householdId} className={styles.item}>
            <summary className={styles.summary}>
              <div>
                <div className={styles.itemTitle}>{extractName(household.household, 'Household')}</div>
                <div className={styles.meta}>
                  {formatPhones(household.household) || 'No household phone on record'}
                </div>
              </div>
              <div className={styles.badge}>{household.members.length} member(s)</div>
            </summary>

            <div className={styles.body}>
              <div className={styles.sectionHeading}>Members</div>
              <div className={styles.members}>
                {household.members.map((member) => (
                  <div key={member.accountId} className={styles.memberRow}>
                    <div>
                      <div className={styles.memberName}>
                        {extractName(member.constituent, 'Member')} <span className={styles.subtle}>#{member.accountId}</span>
                      </div>
                      <div className={styles.meta}>
                        {formatPhones(member.constituent) || 'No phone recorded'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ))}
      </div>
    );
  }, [error, households, loading]);

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div>
          <p className={styles.brow}>Campaign</p>
          <h1 className={styles.title}>Results for Campaign {campaignId}</h1>
          <p className={styles.lede}>
            View enhanced households and members pulled from Bloomerang and cached in Supabase.
          </p>
        </div>
      </div>
      {content}
    </main>
  );
}

function extractName(record: Record<string, unknown> | null, fallback: string): string {
  if (!record) return fallback;

  const candidate =
    (record.fullName as string | undefined) ||
    (record.name as string | undefined) ||
    (record.householdName as string | undefined) ||
    (record.displayName as string | undefined);

  return candidate && typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : fallback;
}

function formatPhones(record: Record<string, unknown> | null): string {
  if (!record) return '';

  const rawPhones =
    (Array.isArray(record.phoneNumbers) && record.phoneNumbers) ||
    (Array.isArray(record.phones) && record.phones) ||
    ([] as Array<unknown>);

  const formatted = rawPhones
    .map((phone) => {
      if (typeof phone === 'string') return phone;
      if (phone && typeof phone === 'object') {
        const value =
          (phone as { number?: unknown; phone?: unknown; value?: unknown }).number ||
          (phone as { number?: unknown; phone?: unknown; value?: unknown }).phone ||
          (phone as { number?: unknown; phone?: unknown; value?: unknown }).value;
        const type = (phone as { type?: unknown }).type;
        const number = typeof value === 'string' ? value : null;
        const descriptor = typeof type === 'string' ? ` (${type})` : '';
        return number ? `${number}${descriptor}` : null;
      }
      return null;
    })
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (formatted.length) {
    return formatted.join(', ');
  }

  const fallback = record.phone || record.primaryPhone;
  if (typeof fallback === 'string') return fallback;

  return '';
}
