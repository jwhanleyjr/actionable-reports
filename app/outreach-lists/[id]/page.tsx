import { notFound } from 'next/navigation';

import { ConstituentDetails, OutreachListHouseholdRow, OutreachListMember } from '../../../components/OutreachListHouseholdRow';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import styles from './styles.module.css';

type OutreachListRecord = {
  id: string;
  name: string;
  goal: string | null;
  stage: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
};

type OutreachListHousehold = {
  id: string;
  household_key?: string;
  household_id: number | null;
  solo_constituent_id?: number | null;
  household_snapshot: { displayName?: string };
};

type ConstituentRow = {
  account_id: number;
  display_name?: string | null;
  payload?: Record<string, unknown> | null;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OutreachListDetailPage({ params }: { params: { id: string } }) {
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

  const groupedMembers = new Map<string, OutreachListMember[]>();
  (members ?? []).forEach((member) => {
    const key = member.outreach_list_household_id || member.member_snapshot?.householdKey || member.id;
    const existing = groupedMembers.get(key) ?? [];
    existing.push(member);
    groupedMembers.set(key, existing);
  });

  const memberIds = Array.from(new Set((members ?? []).map((member) => member.constituent_id).filter(Boolean)));
  let constituentDetails: Map<number, ConstituentDetails> | undefined;

  if (memberIds.length) {
    const { data: constituentRows } = await supabase
      .from('constituents')
      .select('account_id, display_name, payload')
      .in('account_id', memberIds)
      .returns<ConstituentRow[]>();

    if (constituentRows?.length) {
      const detailMap = new Map<number, ConstituentDetails>();

      constituentRows.forEach((row) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;

        const getString = (paths: string[]) => {
          for (const path of paths) {
            const value = path.split('.').reduce<unknown>((acc, key) => {
              if (acc && typeof acc === 'object') {
                return (acc as Record<string, unknown>)[key];
              }
              return undefined;
            }, payload);

            if (typeof value === 'string' && value.trim().length) {
              return value;
            }
          }

          return undefined;
        };

        const displayName = row.display_name || getString(['FullName', 'Name', 'InformalName', 'FormalName']);
        const email = getString(['PrimaryEmail.Value', 'PrimaryEmail', 'Email', 'Email.Value']);
        const phone = getString(['PrimaryPhone.Number', 'PrimaryPhone', 'Phone', 'Phone.Number']);
        const restrictions = (payload as { CommunicationRestrictions?: unknown }).CommunicationRestrictions;

        detailMap.set(row.account_id, { displayName, email, phone, restrictions });
      });

      constituentDetails = detailMap;
    }
  }

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
            {list.description ? <p className={styles.description}>{list.description}</p> : null}
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
                members={groupedMembers.get(household.id) ?? []}
                constituentDetails={constituentDetails}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
