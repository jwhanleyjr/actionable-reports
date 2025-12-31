'use client';

import { FormEvent, useState } from 'react';

import styles from './styles.module.css';

type SearchResult = {
  ok: boolean;
  url?: string;
  status?: number;
  contentType?: string | null;
  data?: unknown;
  bodyPreview?: string;
  error?: string;
};

export default function SearchPage() {
  const [accountNumber, setAccountNumber] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    const trimmed = accountNumber.trim();
    if (!trimmed) {
      setError('Please enter an account number to search.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/bloomerang/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountNumber: trimmed }),
      });

      const payload = (await response.json()) as SearchResult;

      if (!response.ok || !payload.ok) {
        setError(payload.bodyPreview || payload.error || 'Search failed.');
      }

      setResult(payload);
    } catch (err) {
      console.error('Search request failed', err);
      setError('Unable to complete the search request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.navbar}>
          <span className={styles.brand}>Bloomerang Calls</span>
          <button type="button" className={styles.navButton}>
            New Call Campaign
          </button>
        </div>

        <div className={styles.card}>
          <header className={styles.header}>
            <p className={styles.kicker}>Campaign Workspace</p>
            <h1 className={styles.title}>Bloomerang Search Tester</h1>
            <p className={styles.subtitle}>
              Enter an account number to query Bloomerang and review the raw search response.
            </p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="accountNumber">
                Account Number
              </label>
              <input
                id="accountNumber"
                name="accountNumber"
                type="text"
                autoComplete="off"
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value)}
                placeholder="2872456"
                className={styles.input}
              />
            </div>

            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.output}>
            <p className={styles.outputLabel}>Response</p>
            {loading ? (
              <p className={styles.muted}>Loading…</p>
            ) : result ? (
              <pre className={styles.pre}>{JSON.stringify(result, null, 2)}</pre>
            ) : (
              <p className={styles.muted}>Submit a search to see results here.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
