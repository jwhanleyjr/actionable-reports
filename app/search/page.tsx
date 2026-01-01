'use client';

import { FormEvent, useEffect, useState } from 'react';

import { getMemberActions, type MemberActionKey } from '../../lib/memberActions';
import { MemberActionIconButton } from './MemberActionIconButton';
import { MemberActionModalShell } from './MemberActionModalShell';
import styles from './styles.module.css';

type GivingStats = {
  lifetimeTotal: number;
  lastYearTotal: number;
  ytdTotal: number;
  lastGiftAmount: number | null;
  lastGiftDate: string | null;
};

type HouseholdTotals = GivingStats;

type MemberWithStats = {
  constituent: Record<string, unknown> | null;
  constituentId: number;
  stats?: GivingStats;
  statsDebug?: { transactionCount: number; includedCount: number; requestUrls: string[] };
  requestUrls?: string[];
  profileUrl?: string;
  statsError?: string;
  constituentError?: string;
};

type HouseholdStatus = {
  lifecycle: 'Current' | 'Retain' | 'Regain' | 'Potential';
  isRecurring: boolean;
};

type ActivitySummary = {
  ok: boolean;
  summary?: {
    keyPoints: string[];
    recentTimeline: string[];
    lastMeaningfulInteraction: { date: string | null; channel: string | null; summary: string | null };
    suggestedNextSteps: string[];
    givingInterests: string[];
    recommendedOpeningLine: string;
  };
  notesMeta?: {
    totalFetched: number;
    usedCount: number;
    newestCreatedDate: string | null;
    oldestCreatedDate: string | null;
  };
  interactionsMeta?: {
    totalFetched: number;
    usedCount: number;
    newestCreatedDate: string | null;
    oldestCreatedDate: string | null;
  };
  error?: string;
  status?: number;
};

type SearchResult = {
  ok: boolean;
  url?: string;
  status?: number;
  contentType?: string | null;
  data?: unknown;
  bodyPreview?: string;
  error?: string;
  message?: string;
};

type CombinedSearchResult = {
  ok: boolean;
  constituent?: unknown;
  household?: unknown | null;
  householdError?: string;
  members?: MemberWithStats[];
  householdTotals?: HouseholdTotals;
  householdStatus?: HouseholdStatus;
  searchUrl?: string;
  householdUrl?: string;
  bodyPreview?: string;
  error?: string;
  message?: string;
};

export default function SearchPage() {
  const [accountNumber, setAccountNumber] = useState('');
  const [result, setResult] = useState<CombinedSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [interactionModalMember, setInteractionModalMember] = useState<MemberWithStats | null>(null);
  const [noteModalMember, setNoteModalMember] = useState<MemberWithStats | null>(null);
  const [interactionChannel, setInteractionChannel] = useState('Phone');
  const [interactionPurpose, setInteractionPurpose] = useState('Acknowledgement');
  const [interactionCustomPurpose, setInteractionCustomPurpose] = useState('');
  const [interactionSubject, setInteractionSubject] = useState('Interaction');
  const [interactionDate, setInteractionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [interactionInbound, setInteractionInbound] = useState(false);
  const [interactionNote, setInteractionNote] = useState('');
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [interactionSubmitting, setInteractionSubmitting] = useState(false);
  const [noteDate, setNoteDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [recentlyLogged, setRecentlyLogged] = useState<{ memberId: number; action: MemberActionKey; ts: number } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setActivitySummary(null);

    const trimmed = accountNumber.trim();
    if (!trimmed) {
      setError('Please enter an account number to search.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/bloomerang/search-with-household-and-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountNumber: trimmed }),
      });

      const payload = (await response.json()) as CombinedSearchResult;

      if (!response.ok || !payload.ok) {
        setError(payload.bodyPreview || payload.error || 'Search failed.');
        setResult(payload);
        return;
      }

      setResult(payload);
    } catch (err) {
      console.error('Search request failed', err);
      setError('Unable to complete the search request.');
    } finally {
      setLoading(false);
    }
  };

  const memberIds = (result?.members ?? [])
    .map((member) => member.constituentId)
    .filter((id) => Number.isFinite(id));

  const loadActivitySummary = async (forceRefresh = false) => {
    if (!memberIds.length) {
      setActivitySummary(null);
      return;
    }

    if (activityLoading && !forceRefresh) {
      return;
    }

    setActivityLoading(true);

    try {
      const response = await fetch('/api/bloomerang/household-activity-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ memberIds }),
      });

      const payload = (await response.json()) as ActivitySummary;

      setActivitySummary(payload);
    } catch (err) {
      console.error('Activity summary request failed', err);
      setActivitySummary({ ok: false, error: 'Unable to load activity summary.' });
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    if (!memberIds.length || loading) {
      return;
    }

    void loadActivitySummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds.join('|'), loading]);

  const members = result?.members ?? [];
  const householdTotals = result?.householdTotals ?? null;
  const householdStatus = result?.householdStatus ?? null;
  const memberActions = getMemberActions({ enableNote: true });
  const visibleActions = memberActions.filter((action) => action.enabled && (action.key === 'note' || action.key === 'interaction'));

  const resetInteractionForm = () => {
    setInteractionChannel('Phone');
    setInteractionPurpose('Acknowledgement');
    setInteractionCustomPurpose('');
    setInteractionSubject('Interaction');
    setInteractionDate(new Date().toISOString().split('T')[0]);
    setInteractionInbound(false);
    setInteractionNote('');
    setInteractionError(null);
    setInteractionSubmitting(false);
  };

  const openInteractionModal = (member: MemberWithStats) => {
    resetInteractionForm();
    setInteractionModalMember(member);
  };

  const closeInteractionModal = () => {
    setInteractionModalMember(null);
  };

  const resetNoteForm = () => {
    setNoteDate(new Date().toISOString().split('T')[0]);
    setNoteText('');
    setNoteError(null);
    setNoteSubmitting(false);
  };

  const openNoteModal = (member: MemberWithStats) => {
    resetNoteForm();
    setNoteModalMember(member);
  };

  const closeNoteModal = () => {
    setNoteModalMember(null);
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleInteractionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!interactionModalMember) {
      return;
    }

    setInteractionError(null);
    setInteractionSubmitting(true);

    const purposeValue = interactionPurpose === 'Other'
      ? (interactionCustomPurpose.trim() || 'Other')
      : interactionPurpose;

    try {
      const response = await fetch('/api/bloomerang/interaction/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: interactionModalMember.constituentId,
          channel: interactionChannel,
          purpose: purposeValue,
          subject: interactionSubject?.trim() || null,
          date: interactionDate,
          isInbound: interactionInbound,
          note: interactionNote,
        }),
      });

      const result = await response.json() as { ok?: boolean; bodyPreview?: string; error?: string };

      if (!response.ok || !result.ok) {
        setInteractionError(result.bodyPreview || result.error || 'Unable to log interaction.');
        return;
      }

      const firstName = getMemberFirstName(
        interactionModalMember.constituent ?? {},
        interactionModalMember.constituentId,
      );

      showToast(`Interaction logged for ${firstName}`);
      closeInteractionModal();
      setRecentlyLogged({ memberId: interactionModalMember.constituentId, action: 'interaction', ts: Date.now() });
      setTimeout(() => setRecentlyLogged(null), 1000);
    } catch (error) {
      console.error('Interaction creation failed', error);
      setInteractionError('Unable to log interaction.');
    } finally {
      setInteractionSubmitting(false);
    }
  };

  const handleNoteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!noteModalMember) {
      return;
    }

    setNoteError(null);
    setNoteSubmitting(true);

    const trimmedNote = noteText.trim();

    if (!trimmedNote) {
      setNoteError('Please enter a note.');
      setNoteSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/bloomerang/note/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: noteModalMember.constituentId,
          date: noteDate,
          note: trimmedNote,
        }),
      });

      const result = await response.json() as { ok?: boolean; bodyPreview?: string; error?: string; status?: number };

      const status = result.status ?? response.status;
      const preview = result.bodyPreview || result.error || 'Unable to save note.';

      if (!response.ok || !result.ok) {
        setNoteError(status ? `Status ${status}: ${preview}` : preview);
        return;
      }

      const firstName = getMemberFirstName(noteModalMember.constituent ?? {}, noteModalMember.constituentId);

      showToast(`Note saved for ${firstName}`);
      closeNoteModal();
      setRecentlyLogged({ memberId: noteModalMember.constituentId, action: 'note', ts: Date.now() });
      setTimeout(() => setRecentlyLogged(null), 1000);
      void loadActivitySummary(true);
    } catch (error) {
      console.error('Note creation failed', error);
      setNoteError('Unable to save note.');
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleActionClick = (actionKey: MemberActionKey, member: MemberWithStats) => {
    if (actionKey === 'interaction') {
      openInteractionModal(member);
      return;
    }

    if (actionKey === 'note') {
      openNoteModal(member);
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
              Enter an account number to query Bloomerang and review the household profile with giving stats.
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

          <div className={styles.outputStack}>
            <div className={styles.output}>
              <p className={styles.outputLabel}>Household</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : result ? (
                result.household ? (
                  <HouseholdHeader
                    name={extractHouseholdName(result.household) ?? 'No household name found.'}
                    status={householdStatus}
                  />
                ) : result.householdError ? (
                  <p className={styles.muted}>{result.householdError}</p>
                ) : members.length === 1 ? (
                  (() => {
                    const onlyMember = members[0];
                    const name =
                      onlyMember.constituent && typeof onlyMember.constituent === 'object'
                        ? buildMemberName(onlyMember.constituent, onlyMember.constituentId)
                        : `Constituent ${onlyMember.constituentId}`;

                    return <HouseholdHeader name={name} status={householdStatus} />;
                  })()
                ) : (
                  <p className={styles.muted}>No household data found.</p>
                )
              ) : (
                <p className={styles.muted}>Search for a constituent to load household info.</p>
              )}
            </div>

            <div className={styles.output}>
              <div className={styles.outputHeadingRow}>
                <p className={styles.outputLabel}>Household Activity Summary</p>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => loadActivitySummary(true)}
                  disabled={activityLoading || loading || !memberIds.length}
                >
                  {activityLoading ? 'Refreshing…' : 'Refresh Summary'}
                </button>
              </div>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : activityLoading && !activitySummary ? (
                <p className={styles.muted}>Generating summary…</p>
              ) : activitySummary?.ok && activitySummary.summary ? (
                <div className={styles.notesSummary}>
                  {activitySummary.summary.recommendedOpeningLine && (
                    <div className={styles.openingLine}>
                      <p className={styles.notesSummaryLabel}>Recommended Opening Line</p>
                      <p className={styles.openingLineText}>
                        {activitySummary.summary.recommendedOpeningLine}
                      </p>
                    </div>
                  )}

                  {activitySummary.summary.givingInterests?.length ? (
                    <div>
                      <p className={styles.notesSummaryLabel}>Giving Interests</p>
                      <ul className={styles.bulletList}>
                        {activitySummary.summary.givingInterests.map((interest, index) => (
                          <li key={index}>{interest}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div>
                    <p className={styles.notesSummaryLabel}>Key Points</p>
                    {activitySummary.summary.keyPoints.length ? (
                      <ul className={styles.bulletList}>
                        {activitySummary.summary.keyPoints.map((point, index) => (
                          <li key={index}>{point}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.muted}>No key points returned.</p>
                    )}
                  </div>

                  <div>
                    <p className={styles.notesSummaryLabel}>Recent Timeline</p>
                    {activitySummary.summary.recentTimeline.length ? (
                      <ul className={styles.bulletList}>
                        {activitySummary.summary.recentTimeline.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.muted}>No recent timeline available.</p>
                    )}
                  </div>

                  <div>
                    <p className={styles.notesSummaryLabel}>Suggested Next Steps</p>
                    {activitySummary.summary.suggestedNextSteps.length ? (
                      <ul className={styles.bulletList}>
                        {activitySummary.summary.suggestedNextSteps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.muted}>No suggestions returned.</p>
                    )}
                  </div>

                  {activitySummary.summary.lastMeaningfulInteraction && (
                    <div className={styles.lastInteraction}>
                      <p className={styles.notesSummaryLabel}>Last Meaningful Interaction</p>
                      <p className={styles.muted}>
                        {renderLastInteraction(activitySummary.summary.lastMeaningfulInteraction)}
                      </p>
                    </div>
                  )}

                  {(activitySummary.interactionsMeta || activitySummary.notesMeta) && (
                    <p className={styles.notesMeta}>
                      {activitySummary.interactionsMeta
                        ? `Interactions used: ${activitySummary.interactionsMeta.usedCount} of ${activitySummary.interactionsMeta.totalFetched}${renderDateRange(activitySummary.interactionsMeta)}`
                        : 'Interactions unavailable.'}
                      {' '}
                      {activitySummary.notesMeta
                        ? `Notes used: ${activitySummary.notesMeta.usedCount} of ${activitySummary.notesMeta.totalFetched}${renderDateRange(activitySummary.notesMeta)}`
                        : 'Notes unavailable.'}
                    </p>
                  )}
                </div>
              ) : activitySummary ? (
                <p className={styles.error}>
                  {activitySummary.error || 'Unable to generate activity summary.'}
                </p>
              ) : (
                <p className={styles.muted}>Search for a constituent to load activity.</p>
              )}
            </div>

            <div className={styles.output}>
              <p className={styles.outputLabel}>Household Giving Summary</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : householdTotals ? (
                <div className={styles.summaryGrid}>
                  <SummaryStat label="Lifetime Total" value={formatCurrency(householdTotals.lifetimeTotal)} />
                  <SummaryStat label="Last Year Total" value={formatCurrency(householdTotals.lastYearTotal)} />
                  <SummaryStat label="YTD Total" value={formatCurrency(householdTotals.ytdTotal)} />
                  <SummaryStat
                    label="Last Gift"
                    value={householdTotals.lastGiftDate
                      ? `${formatCurrency(householdTotals.lastGiftAmount ?? 0)} on ${formatDate(householdTotals.lastGiftDate)}`
                      : 'No gifts found'}
                  />
                </div>
              ) : result ? (
                <p className={styles.muted}>No giving data available.</p>
              ) : (
                <p className={styles.muted}>Search for a constituent to see totals.</p>
              )}
            </div>

            <div className={styles.output}>
              <p className={styles.outputLabel}>Household Members</p>
              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : members.length ? (
                <ul className={styles.memberList}>
                  {members.map((member) => {
                    const name = member.constituent
                      ? buildMemberName(member.constituent, member.constituentId)
                      : `Constituent ${member.constituentId}`;
                    const phone = member.constituent ? pickString(member.constituent, [
                      'PrimaryPhone.Number',
                      'primaryPhone.number',
                      'primaryPhone.Number',
                      'PrimaryPhone.number',
                    ]) : undefined;
                    const email = member.constituent ? pickString(member.constituent, [
                      'PrimaryEmail.Value',
                      'primaryEmail.value',
                      'primaryEmail.Value',
                      'PrimaryEmail.value',
                    ]) : undefined;

                    return (
                      <li key={member.constituentId} className={styles.memberItem}>
                        <div className={styles.memberHeader}>
                          <div className={styles.memberName}>{name}</div>
                          <div className={styles.memberActions}>
                            {visibleActions.map((action) => (
                              <MemberActionIconButton
                                key={action.key}
                                action={action}
                                ariaLabel={`${action.label} for ${name}`}
                                highlighted={recentlyLogged?.memberId === member.constituentId && recentlyLogged?.action === action.key}
                                onClick={() => handleActionClick(action.key, member)}
                              />
                            ))}
                          </div>
                        </div>
                        <div className={styles.memberMeta}>
                          <span className={styles.metaPill}>ID: {member.constituentId}</span>
                          {phone && <span className={styles.metaPill}>Phone: {phone}</span>}
                          {email && <span className={styles.metaPill}>Email: {email}</span>}
                        </div>
                        {member.stats ? (
                          <div className={styles.statsTable}>
                            <StatsRow label="Lifetime" value={formatCurrency(member.stats.lifetimeTotal)} />
                            <StatsRow label="Last Year" value={formatCurrency(member.stats.lastYearTotal)} />
                            <StatsRow label="YTD" value={formatCurrency(member.stats.ytdTotal)} />
                            <StatsRow
                              label="Last Gift Amount"
                              value={member.stats.lastGiftAmount !== null
                                ? formatCurrency(member.stats.lastGiftAmount)
                                : '—'}
                            />
                            <StatsRow
                              label="Last Gift Date"
                              value={member.stats.lastGiftDate ? formatDate(member.stats.lastGiftDate) : '—'}
                            />
                          </div>
                        ) : (
                          <p className={styles.muted}>
                            Stats unavailable{member.statsError ? `: ${member.statsError}` : ''}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : result ? (
                <p className={styles.muted}>No household members returned.</p>
              ) : (
                <p className={styles.muted}>Search for a constituent to see their household members.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {noteModalMember ? (
        <MemberActionModalShell
          title={`Add note for: ${buildMemberName(
            noteModalMember.constituent ?? {},
            noteModalMember.constituentId,
          )}`}
          onClose={closeNoteModal}
        >
          <form className={styles.modalForm} onSubmit={handleNoteSubmit}>
            <div className={styles.inlineRow}>
              <div>
                <label className={styles.fieldLabel} htmlFor="note-date">Date</label>
                <input
                  id="note-date"
                  type="date"
                  className={styles.input}
                  value={noteDate}
                  onChange={(event) => setNoteDate(event.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="note-text">Note</label>
              <textarea
                id="note-text"
                className={styles.textarea}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                required
              />
            </div>

            {noteError ? <p className={styles.errorText}>{noteError}</p> : null}

            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={closeNoteModal} disabled={noteSubmitting}>
                Cancel
              </button>
              <button type="submit" className={styles.primaryButton} disabled={noteSubmitting}>
                {noteSubmitting ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          </form>
        </MemberActionModalShell>
      ) : null}

      {interactionModalMember ? (
        <MemberActionModalShell
          title="Log Interaction"
          subtitle={`Record an interaction for ${buildMemberName(
            interactionModalMember.constituent ?? {},
            interactionModalMember.constituentId,
          )}.`}
          onClose={closeInteractionModal}
        >
          <form className={styles.modalForm} onSubmit={handleInteractionSubmit}>
            <div className={styles.inlineRow}>
              <div>
                <label className={styles.fieldLabel} htmlFor="interaction-channel">Channel</label>
                <select
                  id="interaction-channel"
                  className={styles.select}
                  value={interactionChannel}
                  onChange={(event) => setInteractionChannel(event.target.value)}
                >
                  <option value="Phone">Phone</option>
                  <option value="Email">Email</option>
                  <option value="Text">Text</option>
                  <option value="In Person">In Person</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="interaction-purpose">Purpose</label>
                <select
                  id="interaction-purpose"
                  className={styles.select}
                  value={interactionPurpose}
                  onChange={(event) => setInteractionPurpose(event.target.value)}
                >
                  <option value="Acknowledgement">Acknowledgement</option>
                  <option value="ImpactCultivation">ImpactCultivation</option>
                  <option value="Other">Other</option>
                </select>
                {interactionPurpose === 'Other' ? (
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="Custom purpose"
                    value={interactionCustomPurpose}
                    onChange={(event) => setInteractionCustomPurpose(event.target.value)}
                  />
                ) : null}
              </div>
            </div>

            <div className={styles.inlineRow}>
              <div>
                <label className={styles.fieldLabel} htmlFor="interaction-subject">Subject (optional)</label>
                <input
                  id="interaction-subject"
                  type="text"
                  className={styles.input}
                  value={interactionSubject}
                  onChange={(event) => setInteractionSubject(event.target.value)}
                />
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="interaction-date">Date</label>
                <input
                  id="interaction-date"
                  type="date"
                  className={styles.input}
                  value={interactionDate}
                  onChange={(event) => setInteractionDate(event.target.value)}
                />
              </div>
            </div>

            <div className={styles.checkboxRow}>
              <input
                id="interaction-inbound"
                type="checkbox"
                checked={interactionInbound}
                onChange={(event) => setInteractionInbound(event.target.checked)}
              />
              <label htmlFor="interaction-inbound">Inbound interaction</label>
            </div>

            <div>
              <label className={styles.fieldLabel} htmlFor="interaction-note">Note</label>
              <textarea
                id="interaction-note"
                className={styles.textarea}
                value={interactionNote}
                onChange={(event) => setInteractionNote(event.target.value)}
              />
            </div>

            {interactionError ? <p className={styles.errorText}>{interactionError}</p> : null}

            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={closeInteractionModal} disabled={interactionSubmitting}>
                Cancel
              </button>
              <button type="submit" className={styles.primaryButton} disabled={interactionSubmitting}>
                {interactionSubmitting ? 'Saving…' : 'Log Interaction'}
              </button>
            </div>
          </form>
        </MemberActionModalShell>
      ) : null}

      {toastMessage ? <div className={styles.toast}>{toastMessage}</div> : null}
    </main>
  );
}

const LIFECYCLE_TOOLTIPS: Record<HouseholdStatus['lifecycle'], string> = {
  Current: 'They’ve already given this year—an active supporter right now.',
  Retain: 'They gave last year but haven’t given yet this year. A warm update and invitation can help retain them.',
  Regain: 'They’ve given in the past, but not last year or this year. A reconnecting call can reopen the relationship.',
  Potential: 'No recorded gifts yet. Focus on learning their interests and sharing ways to get involved.',
};

const RECURRING_TOOLTIP = 'They support through recurring gifts. Keep the call focused on gratitude and impact.';

function HouseholdHeader({ name, status }: { name: string; status: HouseholdStatus | null }) {
  const lifecycle = status?.lifecycle;

  return (
    <div className={styles.householdHeader}>
      <p className={styles.muted}>{name}</p>
      {lifecycle ? (
        <div className={styles.pillRow}>
          <LifecyclePill lifecycle={lifecycle} />
          {status?.isRecurring ? <RecurringPill /> : null}
        </div>
      ) : null}
    </div>
  );
}

function LifecyclePill({ lifecycle }: { lifecycle: HouseholdStatus['lifecycle'] }) {
  const className = styles[`pill${lifecycle}`];

  return (
    <Pill
      label={lifecycle}
      tooltip={LIFECYCLE_TOOLTIPS[lifecycle]}
      className={className ? `${styles.pill} ${className}` : styles.pill}
    />
  );
}

function RecurringPill() {
  return (
    <Pill
      label="Recurring"
      tooltip={RECURRING_TOOLTIP}
      className={`${styles.pill} ${styles.pillRecurring}`}
    />
  );
}

function Pill({ label, tooltip, className }: { label: string; tooltip: string; className: string }) {
  return (
    <span className={className} title={tooltip}>
      {label}
    </span>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryCard}>
      <p className={styles.summaryLabel}>{label}</p>
      <p className={styles.summaryValue}>{value}</p>
    </div>
  );
}

function StatsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function renderDateRange(meta: { newestCreatedDate: string | null; oldestCreatedDate: string | null }) {
  if (!meta.newestCreatedDate || !meta.oldestCreatedDate) {
    return '';
  }

  const newest = formatDate(meta.newestCreatedDate);
  const oldest = formatDate(meta.oldestCreatedDate);

  return ` (date range ${oldest} – ${newest})`;
}

function renderLastInteraction(lastMeaningful: { date: string | null; channel: string | null; summary: string | null }) {
  if (!lastMeaningful.date && !lastMeaningful.channel && !lastMeaningful.summary) {
    return 'No meaningful interactions found.';
  }

  const date = lastMeaningful.date ? formatDate(lastMeaningful.date) : 'Date unknown';
  const channel = lastMeaningful.channel ?? 'Channel unknown';
  const summary = lastMeaningful.summary ?? '';

  return `${date} • ${channel}${summary ? ` — ${summary}` : ''}`;
}

function extractHouseholdName(data: unknown): string | null {
  const householdName = pickString((data as Record<string, unknown>) ?? {}, [
    'RecognitionName',
    'recognitionName',
    'FullName',
    'name',
    'Name',
    'householdName',
    'HouseholdName',
  ]);

  if (householdName) {
    return householdName;
  }

  const firstResult = Array.isArray((data as { Results?: unknown[] })?.Results)
    ? (data as { Results: unknown[] }).Results[0]
    : null;

  if (firstResult && typeof firstResult === 'object') {
    const nestedName = pickString(firstResult as Record<string, unknown>, [
      'RecognitionName',
      'recognitionName',
      'FullName',
      'name',
      'Name',
      'householdName',
      'HouseholdName',
    ]);

    if (nestedName) {
      return nestedName;
    }
  }

  return null;
}

function buildMemberName(member: Record<string, unknown>, fallbackId: number) {
  const fullName = pickString(member, ['fullName', 'FullName']);

  if (fullName) {
    return fullName;
  }

  const first = pickString(member, ['firstName', 'FirstName']) ?? '';
  const last = pickString(member, ['lastName', 'LastName']) ?? '';
  const joined = `${first} ${last}`.trim();

  return joined || `Constituent ${fallbackId}`;
}

function getMemberFirstName(member: Record<string, unknown>, fallbackId: number) {
  const first = pickString(member, ['firstName', 'FirstName']);

  if (first) {
    return first;
  }

  const fullName = buildMemberName(member, fallbackId);
  const [firstPiece] = fullName.split(' ');

  return firstPiece || `Constituent ${fallbackId}`;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readValue(source, key);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}
