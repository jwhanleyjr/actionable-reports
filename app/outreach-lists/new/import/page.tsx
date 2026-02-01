'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

import styles from './styles.module.css';

const GOALS = ['Thank', 'Ask', 'Report'];
const STAGES = ['Not Started', 'In Process', 'Complete'];

export default function OutreachListImportPage() {
  const router = useRouter();
  const [name, setName] = useState('New Outreach List');
  const [goal, setGoal] = useState('Thank');
  const [stage, setStage] = useState('Not Started');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError('Please upload an .xlsx file with account numbers.');
      return;
    }

    const form = new FormData();
    form.append('name', name);
    form.append('goal', goal);
    form.append('stage', stage);
    form.append('file', file);

    setLoading(true);

    try {
      const response = await fetch('/api/outreach-lists/import', {
        method: 'POST',
        body: form,
      });

      const payload = (await response.json()) as { ok: boolean; outreachListId?: string; error?: string };

      if (!response.ok || !payload.ok || !payload.outreachListId) {
        setError(payload.error || 'Unable to import outreach list.');
        return;
      }

      router.push(`/outreach-lists/${payload.outreachListId}`);
    } catch (err) {
      console.error(err);
      setError('Something went wrong while uploading.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <h1 className={styles.title}>Create Outreach List from Excel</h1>
        <p className={styles.subtitle}>
          Upload a spreadsheet with account numbers to build an outreach list you can enhance and manage.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Outreach List Name
            <input
              className={styles.input}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>

          <label className={styles.label}>
            Goal
            <div className={styles.helper}>Keeping one goal per list helps your outreach stay clear.</div>
            <select className={styles.select} value={goal} onChange={(event) => setGoal(event.target.value)}>
              {GOALS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            Stage
            <select className={styles.select} value={stage} onChange={(event) => setStage(event.target.value)}>
              {STAGES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            Upload Excel (.xlsx)
            <input
              className={styles.fileInput}
              type="file"
              accept=".xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.actions}>
            <button className={styles.primaryButton} type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create list & import'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
