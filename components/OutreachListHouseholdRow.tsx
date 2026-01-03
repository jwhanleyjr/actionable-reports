'use client';

import { useRouter } from 'next/navigation';

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
  listId: string;
  household: OutreachListHousehold;
  members: OutreachListMember[];
};

export function OutreachListHouseholdRow({ listId, household, members }: Props) {
  const router = useRouter();

  const title =
    household.household_snapshot?.displayName ||
    members[0]?.member_snapshot?.displayName ||
    (household.household_id ? `Household ${household.household_id}` : 'Household');

  const householdKey = household.household_key
    || (household.household_id ? `h:${household.household_id}`
      : household.solo_constituent_id ? `c:${household.solo_constituent_id}`
        : members[0]?.constituent_id ? `c:${members[0].constituent_id}`
          : household.household_snapshot?.householdId ? `h:${household.household_snapshot.householdId}` : null);

  const handleNavigate = () => {
    if (!householdKey) return;

    router.push(`/outreach-lists/${listId}/households/${encodeURIComponent(householdKey)}`);
  };

  return (
    <div className={styles.card}>
      <button className={styles.rowButton} type="button" onClick={handleNavigate}>
        <div>
          <div className={styles.householdName}>{title}</div>
          <div className={styles.meta}>{members.length} member{members.length === 1 ? '' : 's'}</div>
        </div>
        <div className={styles.chevron}>→</div>
      </button>
    </div>
  );
}
