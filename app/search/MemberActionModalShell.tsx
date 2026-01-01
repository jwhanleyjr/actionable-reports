'use client';

import { ReactNode } from 'react';

import styles from './styles.module.css';

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

export function MemberActionModalShell({ title, subtitle, onClose, children }: Props) {
  return (
    <div className={styles.modalOverlay} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="member-action-title">
        <div className={styles.modalHeader}>
          <div>
            <h2 id="member-action-title" className={styles.modalTitle}>{title}</h2>
            {subtitle ? <p className={styles.modalSubtitle}>{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className={styles.modalCloseButton} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}
