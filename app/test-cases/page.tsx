export default function TestCasesPage() {
  const lifecycleDescriptions: Record<string, string> = {
    Current: 'They’ve already given this calendar year—an active supporter right now.',
    Retain: 'They gave last year but have not yet given this year. Invite them to stay engaged.',
    Regain: 'They gave before last year but not in the last two calendar years. Reconnect to restart the relationship.',
    Potential: 'No included gifts yet. Focus on discovery and inviting first support.',
  };

  return (
    <main style={{ padding: '32px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: '28px', marginBottom: '12px' }}>Test Case Notes</h1>
      <p style={{ marginBottom: '16px', color: '#475569' }}>
        Lifecycle and recurring status pills now reflect gifts in the current calendar year.
      </p>

      <section style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '10px' }}>Lifecycle status reference</h2>
        <ul style={{ paddingLeft: '20px', display: 'grid', gap: '8px' }}>
          {Object.entries(lifecycleDescriptions).map(([label, description]) => (
            <li key={label}>
              <strong>{label}:</strong> {description}
            </li>
          ))}
        </ul>
        <p style={{ marginTop: '10px', color: '#475569' }}>
          <strong>Recurring:</strong> Shown alongside the lifecycle pill when any recurring donation payment is present.
        </p>
      </section>
    </main>
  );
}
