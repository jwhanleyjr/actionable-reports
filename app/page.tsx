import Link from 'next/link';

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import styles from './home.module.css';

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

type OutreachListRow = {
  id: string;
  name: string;
  goal: string | null;
  stage: string | null;
};

type OutreachListRowWithArchive = OutreachListRow & {
  archived_at?: string | null;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const actionCards = [
  {
    title: 'Upload Bloomerang Report',
    description: 'Import Bloomerang excel report to build and outreach list from existing donor data.',
    cta: 'Upload report',
    href: '/outreach-lists/new/import',
    comingSoon: false,
  },
  {
    title: 'Manual List',
    description: 'Create a custom list one contact at a time and assign callers.',
    cta: 'Build list',
    href: '#',
    comingSoon: true,
  },
  {
    title: 'Individual Search',
    description: 'Look up one constituent to review giving history and log activity.',
    cta: 'Open search',
    href: '/search',
    comingSoon: false,
  },
];

async function fetchLatestOutreachLists(): Promise<OutreachListCard[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data: lists, error } = await supabase
    .from('outreach_lists')
    .select('id, name, goal, stage, updated_at, archived_at')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(6);

  let listRows: OutreachListRow[] | OutreachListRowWithArchive[] | null = lists;
  if (error) {
    const { data: fallbackLists } = await supabase
      .from('outreach_lists')
      .select('id, name, goal, stage, updated_at')
      .order('updated_at', { ascending: false })
      .limit(6);
    listRows = fallbackLists;
  }

  if (!listRows?.length) {
    return [];
  }

  const results: OutreachListCard[] = [];

  for (const list of listRows) {
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
      households: count ?? 0,
      completed: progress.completed,
      inProgress: progress.inProgress,
      notStarted: progress.notStarted,
    });
  }

  return results;
}

export default async function Home() {
  const outreachLists = await fetchLatestOutreachLists();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.kicker}>DONOR OUTREACH AND ENGAGEMENT</p>
          <h1 className={styles.title}>Turn donor data into meaningful action</h1>
          <p className={styles.subtitle}>
            Organize contacts into outreach lists, add people manually, or look up an individual to
            review history and plan next steps that move your mission forward.
          </p>
        </header>

        <section className={styles.actionsSection}>
          <div className={styles.actionsGrid}>
            {actionCards.map((action) => (
              <div key={action.title} className={styles.actionCard}>
                <div>
                  <div className={styles.cardHeaderRow}>
                    <h3 className={styles.cardTitle}>{action.title}</h3>
                    {action.comingSoon ? <span className={styles.badge}>Coming soon</span> : null}
                  </div>
                  <p className={styles.cardDescription}>{action.description}</p>
                </div>
                {action.comingSoon ? (
                  <button type="button" className={styles.disabledButton} disabled>
                    {action.cta}
                  </button>
                ) : (
                  <Link className={styles.primaryButton} href={action.href}>
                    {action.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className={styles.campaignsSection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.kicker}>Outreach Lists</p>
              <h2 className={styles.sectionTitle}>Stay aligned with active outreach efforts</h2>
            </div>
            <Link className={styles.ghostButton} href="/outreach-lists/new/import">
              New Outreach List
            </Link>
            <Link className={styles.ghostButton} href="/outreach-lists/archived">
              View archived
            </Link>
          </div>

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
                      <span className={styles.statusBadge}>{list.stage ?? 'Not Started'}</span>
                    </div>
                    <p className={styles.cardDescription}>{list.goal ?? 'Goal not set'}</p>
                    <p className={styles.metaText}>{list.households} households queued</p>
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
            <div className={styles.emptyState}>No outreach lists yet. Start by uploading an Excel file.</div>
          )}
        </section>
      </div>
    </main>
  );
}
