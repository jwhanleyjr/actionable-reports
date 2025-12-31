'use client';

import { useEffect, useMemo, useState } from 'react';

import styles from './page.module.css';

type HouseholdMember = {
  constituent_id: number;
  member_snapshot: Record<string, unknown> | null;
};

type Household = {
  household_id: number;
  household_snapshot: Record<string, unknown> | null;
  members: HouseholdMember[];
};

type HouseholdsResponse = {
  campaign_id: string;
  campaign_name?: string;
  households: Household[];
  message?: string;
  error?: string;
};

function isUuid(value: string | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function CampaignPage({ params }: { params: { id: string } }) {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [enhancing, setEnhancing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState<string | null>(null);

  const campaignId = useMemo(() => params.id, [params.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadHouseholds() {
      setLoading(true);
      setEnhancing(true);
      setError(null);
      setMessage(null);

      if (!isUuid(campaignId)) {
        setError('The campaign id is invalid. Please return to the dashboard and try again.');
        setHouseholds([]);
        setLoading(false);
        setEnhancing(false);
        return;
      }

      try {
        const enhanceResponse = await fetch(`/api/campaigns/${campaignId}/enhance`, { method: 'POST' });

        if (!enhanceResponse.ok) {
          const enhancePayload: { error?: string } = await enhanceResponse.json();
          setError(enhancePayload.error || 'Failed to enhance campaign results.');
          setHouseholds([]);
          return;
        }

        setEnhancing(false);

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
          setCampaignName(payload.campaign_name ?? null);
          setMessage(payload.message ?? null);
        }
      } catch (fetchError) {
        console.error(fetchError);
        if (!cancelled) {
          setError('Unable to load campaign results');
          setHouseholds([]);
          setCampaignName(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setEnhancing(false);
        }
      }
    }

    loadHouseholds();

    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const content = useMemo(() => {
    if (enhancing) {
      return <div className={styles.notice}>Enhancing campaign records…</div>;
    }

    if (loading) {
      return <div className={styles.notice}>Loading households…</div>;
    }

    if (error) {
      return <div className={styles.error}>{error}</div>;
    }

    if (!households.length) {
      return <div className={styles.notice}>{message || 'No households found for this campaign yet.'}</div>;
    }

    return (
      <div className={styles.list}>
        {households.map((household) => (
          <details key={household.household_id} className={styles.item}>
            <summary className={styles.summary}>
              <div>
                <div className={styles.itemTitle}>
                  {extractName(household.household_snapshot, 'Household')}
                </div>
                <div className={styles.meta}>
                  {formatPhones(household.household_snapshot) || 'No household phone on record'}
                </div>
              </div>
              <div className={styles.badge}>{household.members.length} member(s)</div>
            </summary>

            <div className={styles.body}>
              <div className={styles.sectionHeading}>Members</div>
              <div className={styles.members}>
                {household.members.map((member) => (
                  <div key={member.constituent_id} className={styles.memberRow}>
                    <div>
                      <div className={styles.memberName}>
                        {extractName(member.member_snapshot, 'Member')}{' '}
                        <span className={styles.subtle}>#{member.constituent_id}</span>
                      </div>
                      <div className={styles.meta}>
                        {formatPhones(member.member_snapshot) || 'No phone recorded'}
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
  }, [enhancing, error, households, loading, message]);

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div>
          <p className={styles.brow}>Campaign</p>
          <h1 className={styles.title}>{campaignName || `Campaign ${campaignId}`}</h1>
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
