import Link from 'next/link';

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import styles from '../../home.module.css';

type OutreachListCard = {
  id: string;
  name: string;
  goal: string | null;
  stage: string | null;
  archived_at?: string | null;
  households: number;
  completed: number;
  inProgress: number;
  notStarted: number;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function fetchArchivedOutreachLists(): Promise<OutreachListCard[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data: lists } = await supabase
    .from('outreach_lists')
    .select('id, name, goal, stage, updated_at, archived_at')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .limit(24);

  if (!lists?.length) {
    return [];
  }

  const results: OutreachListCard[] = [];

  for (const list of lists) {
    const { count } = await supabase
      .from('outreach_list_households')
      .select('id', { count: 'exact', head: true })
      .eq('outreach_list_id', list.id);

    const { data: households } = await supabase
      .from('outreach_list_households')
      .select('outreach_status')
      .eq('outreach_list_id', list.id)
      .returns<{ outreach_status?: string | null }[]>();

    const progress = (households ?? []).reduce((acc, row) => {
      const status = row.outreach_status ?? 'not_started';
      if (status === 'complete') {
        acc.completed += 1;
      } else if (status === 'in_progress') {
        acc.inProgress += 1;
      } else {
        acc.notStarted += 1;
      }
      return acc;
    }, { completed: 0, inProgress: 0, notStarted: 0 });

    results.push({
      id: list.id,
      name: list.name,
      goal: list.goal,
      stage: list.stage,
      archived_at: list.archived_at,
      households: count ?? 0,
      completed: progress.completed,
      inProgress: progress.inProgress,
      notStarted: progress.notStarted,
    });
  }

  return results;
}

export default async function ArchivedOutreachListsPage() {
  const outreachLists = await fetchArchivedOutreachLists();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.kicker}>ARCHIVED OUTREACH LISTS</p>
          <h1 className={styles.title}>Reference past outreach efforts</h1>
          <p className={styles.subtitle}>
            Archived lists are read-only snapshots of completed outreach work.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.ghostButton} href="/">
              Back to Dashboard
            </Link>
          </div>
        </header>

        <section className={styles.campaignsSection}>
          {outreachLists.length ? (
            <div className={styles.campaignGrid}>
              {outreachLists.map((list) => {
                const totalProgress = list.households || (list.completed + list.inProgress + list.notStarted);
                const completePercent = totalProgress ? (list.completed / totalProgress) * 100 : 0;
                const inProgressPercent = totalProgress ? (list.inProgress / totalProgress) * 100 : 0;

                return (
                  <div key={list.id} className={styles.campaignCard}>
                    <div className={styles.cardHeaderRow}>
                      <h3 className={styles.cardTitle}>{list.name}</h3>
                      <span className={styles.statusBadge}>{list.stage ?? 'Archived'}</span>
                    </div>
                    <p className={styles.cardDescription}>{list.goal ?? 'Goal not set'}</p>
                    <p className={styles.metaText}>{list.households} households archived</p>
                    <div
                      className={styles.progressBar}
                      role="img"
                      aria-label={`Outreach progress: ${list.completed} complete, ${list.inProgress} in progress, ${list.notStarted} not started`}
                    >
                      <div className={styles.progressComplete} style={{ width: `${completePercent}%` }} />
                      <div className={styles.progressInProgress} style={{ width: `${inProgressPercent}%` }} />
                    </div>
                    <Link className={styles.primaryButton} href={`/outreach-lists/${list.id}`}>
                      View list
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>No archived outreach lists yet.</div>
          )}
        </section>
      </div>
    </main>
  );
}
