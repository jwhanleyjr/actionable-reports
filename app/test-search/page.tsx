'use client';

import { FormEvent, useState } from 'react';

export default function TestSearchPage() {
  const [accountNumber, setAccountNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    const trimmed = accountNumber.trim();
    if (!trimmed) {
      setError('Please enter an account number.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/test/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountNumber: trimmed }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error || 'Request failed');
        return;
      }

      setResult(payload);
    } catch (requestError) {
      console.error('Test search failed', requestError);
      setError('Unable to complete the search request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 16px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>Bloomerang Search Tester</h1>
      <p style={{ marginBottom: '24px', color: '#4b5563' }}>
        Enter an account number to call <code>/v2/constituents/search</code> and view the raw results.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="accountNumber" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
            Account Number
          </label>
          <input
            id="accountNumber"
            name="accountNumber"
            type="text"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
            placeholder="14269741"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              fontSize: '16px',
            }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            backgroundColor: '#111827',
            color: 'white',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            marginTop: 26,
            minWidth: 120,
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecdd3',
          color: '#991b1b',
          padding: '12px',
          borderRadius: 8,
          marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      {result && (
        <pre
          style={{
            backgroundColor: '#0b1224',
            color: '#e5e7eb',
            padding: '16px',
            borderRadius: 8,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
