'use client';

import { useState } from 'react';

import { getMemberActions } from '@/lib/memberActions';

import styles from './OutreachListHouseholdRow.module.css';

type HouseholdSnapshot = {
  displayName?: string;
  householdId?: number;
};

type MemberSnapshot = {
  displayName?: string;
  email?: string;
  phone?: string;
  householdKey?: string;
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
};

export function OutreachListHouseholdRow({ household, members }: Props) {
  const [expanded, setExpanded] = useState(false);

  const title =
    household.household_snapshot?.displayName ||
    members[0]?.member_snapshot?.displayName ||
    (household.household_id ? `Household ${household.household_id}` : 'Household');

  return (
    <div className={styles.card}>
      <button className={styles.rowButton} type="button" onClick={() => setExpanded((prev) => !prev)}>
        <div>
          <div className={styles.householdName}>{title}</div>
          <div className={styles.meta}>{members.length} member{members.length === 1 ? '' : 's'}</div>
        </div>
        <div className={styles.chevron}>{expanded ? '−' : '+'}</div>
      </button>

      {expanded ? (
        <div className={styles.members}>
          {members.map((member) => (
            <div key={member.id} className={styles.memberCard}>
              <div className={styles.memberName}>{member.member_snapshot?.displayName || `Constituent ${member.constituent_id}`}</div>
              <div className={styles.memberMeta}>
                {member.member_snapshot?.email ? (
                  <a href={`mailto:${member.member_snapshot.email}`}>{member.member_snapshot.email}</a>
                ) : (
                  <span>No email</span>
                )}
                <span>•</span>
                <span>{member.member_snapshot?.phone || 'No phone'}</span>
              </div>
              {member.member_snapshot?.restrictions ? (
                <div className={styles.restrictions}>Restrictions: {String(member.member_snapshot.restrictions)}</div>
              ) : null}
              <div className={styles.actions}>
                {getMemberActions({ enableNote: true, enableTask: true }).map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className={styles.actionButton}
                    title={action.label}
                    onClick={() => {
                      // Placeholder actions until full modals are wired up
                      console.log(`action:${action.key}`, {
                        constituentId: member.constituent_id,
                        householdId: member.household_id,
                        displayName: member.member_snapshot?.displayName,
                      });
                      alert(`${action.label} coming soon for ${member.member_snapshot?.displayName ?? member.constituent_id}`);
                    }}
                    disabled={!action.enabled}
                  >
                    <span className={styles.actionIcon}>{action.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
