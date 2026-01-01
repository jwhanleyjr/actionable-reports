'use client';

import type { MouseEventHandler } from 'react';

import type { MemberAction } from '../../lib/memberActions';
import styles from './styles.module.css';

type Props = {
  action: MemberAction;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  ariaLabel?: string;
  highlighted?: boolean;
};

export function MemberActionIconButton({ action, onClick, ariaLabel, highlighted }: Props) {
  const disabled = !action.enabled;

  return (
    <button
      type="button"
      className={`${styles.actionButton}${disabled ? ` ${styles.actionButtonDisabled}` : ''}${highlighted ? ` ${styles.actionButtonHighlight}` : ''}`}
      onClick={disabled ? undefined : onClick}
      aria-label={ariaLabel ?? action.label}
      title={action.tooltip}
      disabled={disabled}
    >
      {action.icon}
    </button>
  );
}
