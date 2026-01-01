import { notFound } from 'next/navigation';

import { OutreachListHouseholdRow, OutreachListMember } from '../../../components/OutreachListHouseholdRow';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import styles from './styles.module.css';

type OutreachListRecord = {
  id: string;
  name: string;
  goal: string | null;
  stage: string | null;
  created_at?: string;
  updated_at?: string;
};

type OutreachListHousehold = {
  id: string;
  household_id: number;
  household_snapshot: { displayName?: string };
};

export default async function OutreachListDetailPage({ params }: { params: { id: string } }) {
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

  const groupedMembers = new Map<number, OutreachListMember[]>();
  (members ?? []).forEach((member) => {
    const existing = groupedMembers.get(member.household_id) ?? [];
    existing.push(member);
    groupedMembers.set(member.household_id, existing);
  });

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
            </div>
          </div>
          <form action={`/api/outreach-lists/${list.id}/enhance`} method="post">
            <button className={styles.primaryButton} type="submit">Enhance list</button>
          </form>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Households</h2>
            <div className={styles.counts}>
              {(households ?? []).length} households · {(members ?? []).length} members
            </div>
          </div>

          <div className={styles.list}>
            {(households ?? []).map((household) => (
              <OutreachListHouseholdRow
                key={household.id}
                household={household}
                members={groupedMembers.get(household.household_id) ?? []}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
