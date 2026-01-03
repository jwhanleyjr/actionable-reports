'use client';

import { useState } from 'react';

import { MemberActionIconButton } from '@/app/search/MemberActionIconButton';
import { getMemberActions } from '@/lib/memberActions';
import { buildMemberName, pickString, readValue } from '@/lib/memberDisplay';

import styles from './OutreachListHouseholdRow.module.css';

type HouseholdSnapshot = Record<string, unknown>;

type MemberSnapshot = Record<string, unknown>;

export type ConstituentDetails = {
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  restrictions?: unknown;
};

export type OutreachListMember = {
  id: string;
  outreach_list_household_id: string;
  household_id: number | null;
  constituent_id: number;
  member_snapshot: MemberSnapshot;
};

export type OutreachListHousehold = {
  id: string;
  household_key?: string;
  household_id: number | null;
  solo_constituent_id?: number | null;
  household_snapshot: HouseholdSnapshot;
};

type Props = {
  household: OutreachListHousehold;
  members: OutreachListMember[];
  constituentDetails?: Map<number, ConstituentDetails>;
};

export function OutreachListHouseholdRow({ household, members, constituentDetails }: Props) {
  const [expanded, setExpanded] = useState(false);

  const householdSnapshot = (household.household_snapshot ?? {}) as Record<string, unknown>;
  const title =
    pickString(householdSnapshot, ['displayName', 'DisplayName', 'Name', 'HouseholdName']) ||
    members[0]?.member_snapshot?.displayName ||
    (household.household_id ? `Household ${household.household_id}` : 'Household');

  const pillSummary = household.household_id
    ? `Household ID: ${household.household_id}`
    : household.solo_constituent_id
      ? `Solo: ${household.solo_constituent_id}`
      : 'Imported household';

  return (
    <div className={styles.card}>
      <button className={styles.rowButton} type="button" onClick={() => setExpanded((prev) => !prev)}>
        <div className={styles.householdHeader}>
          <div>
            <p className={styles.householdLabel}>Household</p>
            <div className={styles.householdName}>{title}</div>
            <div className={styles.pillRow}>
              <span className={styles.pill}>{pillSummary}</span>
              <span className={styles.pillMuted}>
                {members.length} member{members.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.chevron}>{expanded ? '−' : '+'}</div>
      </button>

      {expanded ? (
        <div className={styles.members}>
          <div className={styles.memberListLabel}>Household Members</div>
          {members.map((member) => {
            const snapshot = (member.member_snapshot ?? {}) as Record<string, unknown>;
            const fallback = constituentDetails?.get(member.constituent_id);
            const displayName =
              pickString(snapshot, ['displayName', 'DisplayName', 'fullName', 'FullName']) ||
              fallback?.displayName ||
              buildMemberName(snapshot, member.constituent_id);
            const email =
              pickString(snapshot, ['email', 'Email', 'PrimaryEmail', 'PrimaryEmail.Value']) || fallback?.email || undefined;
            const phone =
              pickString(snapshot, ['phone', 'Phone', 'PrimaryPhone', 'PrimaryPhone.Number']) || fallback?.phone || undefined;
            const restrictions = readValue(snapshot, 'restrictions') ?? fallback?.restrictions;

            const emailLink = email ? `mailto:${encodeURIComponent(email)}` : undefined;

            const memberActions = getMemberActions({ enableNote: true, enableTask: true });

            return (
              <div key={member.id} className={styles.memberCard}>
                <div className={styles.memberHeader}>
                  <div>
                    <div className={styles.memberName}>{displayName}</div>
                    <div className={styles.memberMeta}>
                      <span className={styles.metaPill}>ID: {member.constituent_id}</span>
                      {phone ? (
                        <span className={styles.metaPill}>Phone: {phone}</span>
                      ) : (
                        <span className={`${styles.metaPill} ${styles.metaPillMuted}`}>No phone</span>
                      )}
                      {email ? (
                        <span className={styles.metaPill}>
                          Email:{' '}
                          {emailLink ? (
                            <a href={emailLink} className={styles.metaLink}>
                              {email}
                            </a>
                          ) : (
                            email
                          )}
                        </span>
                      ) : (
                        <span className={`${styles.metaPill} ${styles.metaPillMuted}`}>No email</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.memberActions}>
                    {memberActions.map((action) => (
                      <MemberActionIconButton
                        key={action.key}
                        action={action}
                        ariaLabel={`${action.label} for ${displayName}`}
                        onClick={() => {
                          console.log(`action:${action.key}`, {
                            constituentId: member.constituent_id,
                            householdId: member.household_id,
                            displayName,
                          });
                          alert(`${action.label} coming soon for ${displayName ?? member.constituent_id}`);
                        }}
                      />
                    ))}
                  </div>
                </div>

                {restrictions ? (
                  <div className={styles.restrictions}>Restrictions: {String(restrictions)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
