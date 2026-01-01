import Link from 'next/link';
import styles from './home.module.css';

const actionCards = [
  {
    title: 'Upload Excel',
    description: 'Import a spreadsheet to build a call queue from existing donor data.',
    cta: 'Upload file',
    href: '#',
    comingSoon: true,
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

const campaigns = [
  {
    name: 'Fall Stewardship Calls',
    status: 'Active',
    progress: '65% complete',
    leads: 42,
  },
  {
    name: 'Lapsed Donor Outreach',
    status: 'Paused',
    progress: 'Reopening soon',
    leads: 18,
  },
  {
    name: 'Major Gift Prospects',
    status: 'Draft',
    progress: 'Planning engagement',
    leads: 12,
  },
];

export default function Home() {
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
              <p className={styles.kicker}>Current Campaigns</p>
              <h2 className={styles.sectionTitle}>Stay aligned with active calling efforts</h2>
            </div>
            <button type="button" className={styles.ghostButton}>
              New Campaign
            </button>
          </div>

          <div className={styles.campaignGrid}>
            {campaigns.map((campaign) => (
              <div key={campaign.name} className={styles.campaignCard}>
                <div className={styles.cardHeaderRow}>
                  <h3 className={styles.cardTitle}>{campaign.name}</h3>
                  <span className={styles.statusBadge}>{campaign.status}</span>
                </div>
                <p className={styles.cardDescription}>{campaign.progress}</p>
                <p className={styles.metaText}>{campaign.leads} people queued</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
