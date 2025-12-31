'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useMemo, useState } from 'react';

import styles from '../page.module.css';

type ImportResponse = {
  campaignId: number;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  error?: string;
};

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

type Campaign = {
  id: number;
  name: string;
  createdAt?: string;
};

type Props = {
  initialCampaigns: Campaign[];
  initialError: string | null;
};

export default function CampaignDashboard({ initialCampaigns, initialError }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [campaignsLoading, setCampaignsLoading] = useState<boolean>(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(initialError);
  const [showUpload, setShowUpload] = useState<boolean>(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const fileLabel = useMemo(() => {
    if (file?.name) return file.name;
    return 'Choose an .xlsx file to import';
  }, [file?.name]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setError(null);
    setResult(null);
  };

  const refreshCampaigns = async () => {
    setCampaignsLoading(true);
    setCampaignsError(null);

    try {
      const response = await fetch('/api/campaigns', { cache: 'no-store' });
      const payload: { campaigns?: Campaign[]; error?: string } = await response.json();

      if (!response.ok) {
        setCampaignsError(payload.error || 'Unable to load campaigns.');
        return;
      }

      setCampaigns(payload.campaigns || []);
    } catch (loadError) {
      console.error('Failed to load campaigns', loadError);
      setCampaignsError('Unable to load campaigns.');
    } finally {
      setCampaignsLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file) {
      setError('Please select an .xlsx file before uploading.');
      setStatus('error');
      return;
    }

    setStatus('uploading');
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/campaigns/import', {
        method: 'POST',
        body: formData,
      });

      const payload: ImportResponse = await response.json();

      if (!response.ok) {
        setStatus('error');
        setError(payload.error || 'Unable to import the selected file.');
        return;
      }

      setStatus('success');
      setResult(payload);
      setCampaigns((existing) => [
        { id: payload.campaignId, name: `Imported campaign #${payload.campaignId}` },
        ...existing,
      ]);
    } catch (uploadError) {
      console.error('Upload failed', uploadError);
      setStatus('error');
      setError('Something went wrong while uploading. Please try again.');
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.kicker}>Campaigns</p>
          <h1 className={styles.heading}>Review and import Bloomerang campaigns</h1>
          <p className={styles.summary}>
            Browse recent campaigns and start a new one by importing an Excel export of constituents.
          </p>
        </header>

        <section className={styles.campaignSection}>
          <div className={styles.listHeader}>
            <div>
              <p className={styles.label}>Recent campaigns</p>
              <h2 className={styles.panelTitle}>Campaign dashboard</h2>
              <p className={styles.panelHint}>Open results or add a new campaign from here.</p>
            </div>
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={refreshCampaigns} disabled={campaignsLoading}>
                {campaignsLoading ? 'Refreshing…' : 'Refresh list'}
              </button>
              <button className={styles.primary} onClick={() => setShowUpload(true)}>
                + New campaign
              </button>
            </div>
          </div>

          <div className={styles.grid}>
            <button className={styles.card} onClick={() => setShowUpload(true)}>
              <div className={styles.cardBadge}>Upload</div>
              <h3 className={styles.cardTitle}>Import Excel file</h3>
              <p className={styles.cardBody}>Create a campaign by uploading a Bloomerang export.</p>
            </button>

            {campaignsLoading && (
              <div className={`${styles.card} ${styles.cardMuted}`}>
                <div className={styles.cardTitle}>Loading campaigns…</div>
                <p className={styles.cardBody}>Fetching your latest campaign activity.</p>
              </div>
            )}

            {campaignsError && !campaignsLoading && (
              <div className={`${styles.card} ${styles.cardError}`}>
                <div className={styles.cardTitle}>Unable to load campaigns</div>
                <p className={styles.cardBody}>{campaignsError}</p>
              </div>
            )}

            {!campaignsLoading && !campaignsError && campaigns.length === 0 && (
              <div className={`${styles.card} ${styles.cardMuted}`}>
                <div className={styles.cardTitle}>No campaigns yet</div>
                <p className={styles.cardBody}>Start by uploading an Excel file.</p>
              </div>
            )}

            {campaigns.map((campaign) => (
              <Link key={campaign.id} className={styles.card} href={`/campaigns/${campaign.id}`}>
                <div className={styles.cardBadge}>Campaign #{campaign.id}</div>
                <h3 className={styles.cardTitle}>{campaign.name}</h3>
                <p className={styles.cardBody}>
                  {campaign.createdAt
                    ? new Intl.DateTimeFormat('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(campaign.createdAt))
                    : 'Created recently'}
                </p>
              </Link>
            ))}
          </div>
        </section>

        {showUpload && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.label}>Excel workbook</p>
                <h2 className={styles.panelTitle}>Upload .xlsx to begin</h2>
                <p className={styles.panelHint}>
                  The file must include an <code>account_id</code> column. Each valid row is added to a
                  new campaign import.
                </p>
              </div>
              <button className={styles.secondary} onClick={() => setShowUpload(false)}>
                Cancel
              </button>
            </div>

            <form className={styles.form} onSubmit={handleSubmit}>
              <label className={styles.filePicker}>
                <input
                  type="file"
                  name="file"
                  accept=".xlsx"
                  onChange={handleFileChange}
                  aria-label="Upload Excel file"
                />
                <div className={styles.fileContent}>
                  <div className={styles.fileLabel}>{fileLabel}</div>
                  <p className={styles.fileHint}>Drag and drop or click to browse</p>
                </div>
              </label>

              <button className={styles.submit} type="submit" disabled={status === 'uploading'}>
                {status === 'uploading' ? 'Uploading…' : 'Upload workbook'}
              </button>
            </form>

            {error && <div className={styles.error}>{error}</div>}

            {result && (
              <div className={styles.result}>
                <div className={styles.statGroup}>
                  <div>
                    <p className={styles.statLabel}>Campaign</p>
                    <p className={styles.statValue}>#{result.campaignId}</p>
                  </div>
                  <div>
                    <p className={styles.statLabel}>Rows processed</p>
                    <p className={styles.statValue}>{result.totalRows}</p>
                  </div>
                  <div>
                    <p className={styles.statLabel}>Valid rows</p>
                    <p className={styles.statValue}>{result.validRows}</p>
                  </div>
                  <div>
                    <p className={styles.statLabel}>Skipped rows</p>
                    <p className={styles.statValue}>{result.skippedRows}</p>
                  </div>
                </div>

                <div className={styles.actions}>
                  <Link className={styles.link} href={`/campaigns/${result.campaignId}`}>
                    View campaign results
                  </Link>
                </div>
              </div>
            )}

            <div className={styles.tips}>
              <h3>Need a refresher?</h3>
              <ul>
                <li>Only Excel workbooks (.xlsx) are accepted for imports.</li>
                <li>Ensure the sheet includes a column named <code>account_id</code>.</li>
                <li>
                  After upload, we will enhance the records and you can review them on the campaign results
                  page.
                </li>
              </ul>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
