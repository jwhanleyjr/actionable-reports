import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OutreachListHouseholdRow, OutreachListMember } from '../../../components/OutreachListHouseholdRow';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import styles from './styles.module.css';

type OutreachListRecord = {
  id: string;
  name: string;
  goal: string | null;
  stage: string | null;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type OutreachListHousehold = {
  id: string;
  household_key?: string;
  household_id: number | null;
  solo_constituent_id?: number | null;
  household_snapshot: { displayName?: string };
  completed_count?: number | null;
  in_progress_count?: number | null;
  not_started_count?: number | null;
  outreach_status?: string | null;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OutreachListDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { enhanced?: string; enhanceError?: string };
}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <div>
              <p className={styles.kicker}>OUTREACH LIST</p>
              <h1 className={styles.title}>Missing Supabase configuration</h1>
            </div>
          </header>
          <p>Please configure Supabase environment variables to view outreach lists.</p>
        </div>
      </main>
    );
  }

  const supabase = getSupabaseAdmin();
  const [{ data: list }, { data: households }, { data: members }] = await Promise.all([
    supabase.from('outreach_lists').select('*').eq('id', params.id).single<OutreachListRecord>(),
    supabase
      .from('outreach_list_households')
      .select('*')
      .eq('outreach_list_id', params.id)
      .order('created_at')
      .returns<OutreachListHousehold[]>(),
    supabase
      .from('outreach_list_members')
      .select('*')
      .eq('outreach_list_id', params.id)
      .returns<OutreachListMember[]>(),
  ]);

  if (!list) {
    notFound();
  }

  const householdIdByKey = new Map<string, string>();
  const householdIdByHouseholdId = new Map<number, string>();
  (households ?? []).forEach((household) => {
    if (household.household_key) {
      householdIdByKey.set(household.household_key, household.id);
    }
    if (household.household_id) {
      householdIdByHouseholdId.set(household.household_id, household.id);
    }
    if (household.household_snapshot?.householdId) {
      householdIdByHouseholdId.set(household.household_snapshot.householdId, household.id);
    }
  });

  const resolveHouseholdId = (member: OutreachListMember) => {
    if (member.outreach_list_household_id) {
      return member.outreach_list_household_id;
    }
    const snapshotKey = member.member_snapshot?.householdKey;
    if (snapshotKey && householdIdByKey.has(snapshotKey)) {
      return householdIdByKey.get(snapshotKey) ?? member.id;
    }
    if (member.household_id && householdIdByHouseholdId.has(member.household_id)) {
      return householdIdByHouseholdId.get(member.household_id) ?? member.id;
    }
    return member.id;
  };

  const groupedMembers = new Map<string, OutreachListMember[]>();
  (members ?? []).forEach((member) => {
    const key = resolveHouseholdId(member);
    const existing = groupedMembers.get(key) ?? [];
    existing.push(member);
    groupedMembers.set(key, existing);
  });
  const needsPhoneByHouseholdId = new Map<string, boolean>();
  groupedMembers.forEach((groupMembers, householdId) => {
    const hasPhone = groupMembers.some((member) => Boolean(member.member_snapshot?.phone));
    const needsPhone = !hasPhone;
    needsPhoneByHouseholdId.set(householdId, needsPhone);
  });
  const sortedHouseholds = [...(households ?? [])].sort((left, right) => {
    const leftComplete = left.outreach_status === 'complete';
    const rightComplete = right.outreach_status === 'complete';
    const leftNeedsPhone = needsPhoneByHouseholdId.get(left.id) ?? false;
    const rightNeedsPhone = needsPhoneByHouseholdId.get(right.id) ?? false;

    if (leftNeedsPhone !== rightNeedsPhone) {
      return leftNeedsPhone ? 1 : -1;
    }

    if (leftComplete === rightComplete) {
      return 0;
    }

    return leftComplete ? 1 : -1;
  });
  const enhanceError = searchParams?.enhanceError === '1';
  const enhanced = searchParams?.enhanced === '1' && !enhanceError;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>OUTREACH LIST</p>
            <h1 className={styles.title}>{list.name}</h1>
            <div className={styles.pills}>
              {list.goal ? <span className={styles.pill}>{list.goal}</span> : null}
              {list.stage ? <span className={styles.pillMuted}>{list.stage}</span> : null}
              {list.archived_at ? <span className={styles.pillMuted}>Archived</span> : null}
            </div>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.secondaryButton} href="/">
              Back to Dashboard
            </Link>
            <form action={`/api/outreach-lists/${list.id}/enhance`} method="post">
              <button className={styles.primaryButton} type="submit">Enhance list</button>
            </form>
            <form action={`/api/outreach-lists/${list.id}/archive`} method="post">
              <button
                className={styles.archiveButton}
                type="submit"
                disabled={Boolean(list.archived_at)}
              >
                {list.archived_at ? 'Archived' : 'Archive list'}
              </button>
            </form>
          </div>
        </header>
        {enhanceError ? (
          <div className={`${styles.notice} ${styles.noticeError}`}>
            We could not enhance this list. Check the server logs for details and try again.
          </div>
        ) : null}
        {enhanced ? (
          <div className={`${styles.notice} ${styles.noticeSuccess}`}>List enhancement complete.</div>
        ) : null}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Households</h2>
            <div className={styles.counts}>
              {(households ?? []).length} households · {(members ?? []).length} members
            </div>
          </div>

          <div className={styles.list}>
            {sortedHouseholds.map((household) => (
              <OutreachListHouseholdRow
                key={household.id}
                listId={list.id}
                household={household}
                members={groupedMembers.get(household.id) ?? []}
                needsPhone={needsPhoneByHouseholdId.get(household.id) ?? false}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
