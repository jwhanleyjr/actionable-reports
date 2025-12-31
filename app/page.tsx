'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';

import styles from './page.module.css';

type ImportResponse = {
  campaignId: number;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  error?: string;
};

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const fileLabel = useMemo(() => {
    if (file?.name) return file.name;
    return 'Choose an .xlsx file to import';
  }, [file?.name]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setError(null);
    setResult(null);
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
          <p className={styles.kicker}>Campaign imports</p>
          <h1 className={styles.heading}>Upload a Bloomerang export</h1>
          <p className={styles.summary}>
            Start a new campaign by uploading an Excel export of constituents. We will
            create the campaign, queue the accounts for enhancement, and link you to the
            results once ready.
          </p>
        </header>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.label}>Excel workbook</p>
              <h2 className={styles.panelTitle}>Upload .xlsx to begin</h2>
              <p className={styles.panelHint}>
                The file must include an <code>account_id</code> column. Each valid row is
                added to a new campaign import.
              </p>
            </div>
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
                After upload, we will enhance the records and you can review them on the
                campaign results page.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
