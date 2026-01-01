import type { ReactNode } from 'react';

export type MemberActionKey = 'interaction' | 'note' | 'task';

export interface MemberAction {
  key: MemberActionKey;
  label: string;
  icon: ReactNode;
  enabled: boolean;
  tooltip: string;
}

type GetMemberActionsOptions = {
  enableNote?: boolean;
  enableTask?: boolean;
};

const chatBubbleIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
  >
    <path
      d="M5 16.5V18a1 1 0 0 0 1 1h9.5L20 22v-3.5a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v7z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8 11h8M8 14h5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const noteIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
  >
    <path
      d="M7 5h10v12l-4-3-4 3V5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const taskIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
  >
    <path
      d="M6 12l3 3 9-9"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect
      x="3.5"
      y="4.5"
      width="17"
      height="15"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.6"
    />
  </svg>
);

export function getMemberActions(options: GetMemberActionsOptions = {}): MemberAction[] {
  const { enableNote = false, enableTask = false } = options;

  return [
    {
      key: 'note',
      label: 'Add Note',
      icon: noteIcon,
      enabled: enableNote,
      tooltip: 'Add a note',
    },
    {
      key: 'interaction',
      label: 'Log Interaction',
      icon: chatBubbleIcon,
      enabled: true,
      tooltip: 'Log a new interaction',
    },
    {
      key: 'task',
      label: 'Create Task',
      icon: taskIcon,
      enabled: enableTask,
      tooltip: 'Create a task (coming soon)',
    },
  ];
}
