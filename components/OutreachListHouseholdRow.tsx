'use client';

import { useState } from 'react';

import styles from './OutreachListHouseholdRow.module.css';

type HouseholdSnapshot = {
  displayName?: string;
  householdId?: number;
};

type MemberSnapshot = {
  displayName?: string;
  email?: string;
  phone?: string;
};

export type OutreachListMember = {
  id: string;
  household_id: number;
  constituent_id: number;
  member_snapshot: MemberSnapshot;
};

export type OutreachListHousehold = {
  id: string;
  household_id: number;
  household_snapshot: HouseholdSnapshot;
};

type Props = {
  household: OutreachListHousehold;
  members: OutreachListMember[];
};

export function OutreachListHouseholdRow({ household, members }: Props) {
  const [expanded, setExpanded] = useState(false);

  const title = household.household_snapshot?.displayName || `Household ${household.household_id}`;

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
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
