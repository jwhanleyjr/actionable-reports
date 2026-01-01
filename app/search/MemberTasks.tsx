'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

import { BloomerangTask } from '../../types/bloomerang';
import { MemberActionKey } from '../../lib/memberActions';
import styles from './styles.module.css';

const CHANNEL_OPTIONS = ['Phone', 'Email', 'Text', 'In Person', 'Mail', 'Other'];
const PURPOSE_OPTIONS = ['FollowUp', 'Acknowledgement', 'Meeting', 'Cultivation', 'Other'];

type MemberTasksProps = {
  memberId: number;
  memberName: string;
  memberFirstName: string;
  initialTasks?: BloomerangTask[];
  tasksError?: string;
  onToast: (message: string) => void;
  onActionLogged: (memberId: number, action: MemberActionKey) => void;
  actionRequest: { memberId: number; action: 'create'; ts?: number } | null;
  onActionRequestHandled: () => void;
};

type TaskFormState = {
  dueDate: string;
  subject: string;
  note: string;
  channel: string;
  purpose: string;
};

export function MemberTasks({
  memberId,
  memberName,
  memberFirstName,
  initialTasks = [],
  tasksError,
  onToast,
  onActionLogged,
  actionRequest,
  onActionRequestHandled,
}: MemberTasksProps) {
  const [expanded, setExpanded] = useState(initialTasks.length > 0);
  const [tasks, setTasks] = useState<BloomerangTask[]>(initialTasks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(tasksError ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<BloomerangTask | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formState, setFormState] = useState<TaskFormState>(() => defaultFormState());

  useEffect(() => {
    setTasks(initialTasks);
    if (initialTasks.length && !expanded) {
      setExpanded(true);
    }
  }, [initialTasks, expanded]);

  useEffect(() => {
    if (tasksError) {
      setError(tasksError);
    }
  }, [tasksError]);

  useEffect(() => {
    if (actionRequest && actionRequest.memberId === memberId) {
      openCreateModal();
      onActionRequestHandled();
    }
  }, [actionRequest, memberId, onActionRequestHandled]);

  const toggleExpanded = () => setExpanded((prev) => !prev);

  const openCreateModal = () => {
    setEditingTask(null);
    setFormState(defaultFormState());
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (task: BloomerangTask) => {
    setEditingTask(task);
    setFormState({
      dueDate: normalizeDateInput(task.dueDate) ?? '',
      subject: task.subject ?? '',
      note: task.note ?? '',
      channel: task.channel ?? CHANNEL_OPTIONS[0],
      purpose: task.purpose ?? PURPOSE_OPTIONS[0],
    });
    setFormError(null);
    setModalOpen(true);
    if (!expanded) {
      setExpanded(true);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTask(null);
    setFormError(null);
  };

  const refreshTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/bloomerang/tasks?constituentId=${memberId}`);
      const payload = await response.json() as { ok?: boolean; tasks?: BloomerangTask[]; error?: string; bodyPreview?: string };

      if (!response.ok || !payload.ok) {
        setError(payload.error || payload.bodyPreview || 'Unable to load tasks.');
        return;
      }

      setTasks(payload.tasks ?? []);
    } catch (err) {
      console.error('Task refresh failed', err);
      setError('Unable to load tasks.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const trimmedSubject = formState.subject.trim();
    if (!trimmedSubject) {
      setFormError('Please enter a subject.');
      setSubmitting(false);
      return;
    }

    const dueDate = formState.dueDate.trim();
    if (!dueDate) {
      setFormError('Please select a due date.');
      setSubmitting(false);
      return;
    }

    const payload = {
      dueDate,
      subject: trimmedSubject,
      note: formState.note,
      channel: formState.channel,
      purpose: formState.purpose,
    };

    try {
      const url = editingTask
        ? `/api/bloomerang/task/${editingTask.id}`
        : '/api/bloomerang/task';

      const method = editingTask ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTask ? payload : { ...payload, constituentId: memberId }),
      });

      const result = await response.json() as { ok?: boolean; error?: string; task?: BloomerangTask; bodyPreview?: string };

      if (!response.ok || !result.ok) {
        setFormError(result.error || result.bodyPreview || 'Unable to save task.');
        return;
      }

      closeModal();
      onToast(`Task ${editingTask ? 'updated' : 'created'} for ${memberFirstName}`);
      onActionLogged(memberId, 'task');
      setExpanded(true);
      await refreshTasks();
    } catch (err) {
      console.error('Task save failed', err);
      setFormError('Unable to save task.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (task: BloomerangTask) => {
    const existingTasks = tasks;
    setTasks((prev) => prev.filter((entry) => entry.id !== task.id));

    try {
      const response = await fetch(`/api/bloomerang/task/${task.id}/complete`, { method: 'PUT' });
      const payload = await response.json() as { ok?: boolean; error?: string; bodyPreview?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || payload.bodyPreview || 'Unable to complete task.');
      }

      onToast('Task completed');
      onActionLogged(memberId, 'task');
      await refreshTasks();
    } catch (err) {
      console.error('Complete task failed', err);
      setError(err instanceof Error ? err.message : 'Unable to complete task.');
      setTasks(existingTasks);
    }
  };

  const taskList = useMemo(() => [...tasks].sort((a, b) => sortByDate(a.dueDate, b.dueDate)), [tasks]);

  return (
    <div className={styles.tasksSection}>
      <div className={styles.tasksHeader}>
        <div>
          <p className={styles.tasksTitle}>Tasks</p>
          {error ? <p className={styles.errorText}>{error}</p> : null}
          {!error && tasksError ? <p className={styles.muted}>{tasksError}</p> : null}
        </div>
        <div className={styles.tasksHeaderActions}>
          <button type="button" className={styles.ghostButton} onClick={toggleExpanded}>
            {expanded ? 'Hide Tasks' : 'Show Tasks'} ({tasks.length})
          </button>
          <button type="button" className={styles.primaryButton} onClick={openCreateModal}>
            Create Task
          </button>
        </div>
      </div>

      {expanded ? (
        <div className={styles.tasksBody}>
          {loading ? <p className={styles.muted}>Loading tasks…</p> : null}
          {!loading && !taskList.length ? (
            <p className={styles.muted}>No active tasks.</p>
          ) : null}

          {!loading && taskList.length ? (
            <ul className={styles.taskList}>
              {taskList.map((task) => (
                <li key={task.id} className={styles.taskItem}>
                  <div className={styles.taskMain}>
                    <div className={styles.taskMeta}>
                      <span className={styles.taskDue}>Due {formatDisplayDate(task.dueDate)}</span>
                      <span className={styles.taskSubject}>{task.subject || 'Untitled task'}</span>
                      {task.note ? (
                        <p className={styles.taskNote}>{task.note}</p>
                      ) : null}
                      <div className={styles.taskPills}>
                        {task.channel ? <TaskPill label={task.channel} /> : null}
                        {task.purpose ? <TaskPill label={task.purpose} /> : null}
                      </div>
                    </div>
                    <div className={styles.taskActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => openEditModal(task)}>
                        Edit
                      </button>
                      <button type="button" className={styles.completeButton} onClick={() => handleComplete(task)}>
                        Complete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {modalOpen ? (
        <div className={styles.modalOverlay} role="presentation">
          <div className={styles.modal} role="dialog" aria-modal="true">
            <div className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle}>{editingTask ? 'Edit Task' : 'Create Task'}</h2>
                <p className={styles.modalSubtitle}>
                  {editingTask ? 'Update task for' : 'Add a task for'} {memberName}
                </p>
              </div>
              <button type="button" onClick={closeModal} className={styles.modalCloseButton} aria-label="Close dialog">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <form className={styles.modalForm} onSubmit={handleSubmit}>
                <div className={styles.inlineRow}>
                  <div>
                    <label className={styles.fieldLabel} htmlFor={`task-due-${memberId}`}>
                      Due date
                    </label>
                    <input
                      id={`task-due-${memberId}`}
                      type="date"
                      className={styles.input}
                      value={formState.dueDate}
                      onChange={(event) => setFormState((prev) => ({ ...prev, dueDate: event.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <label className={styles.fieldLabel} htmlFor={`task-subject-${memberId}`}>
                      Subject
                    </label>
                    <input
                      id={`task-subject-${memberId}`}
                      type="text"
                      className={styles.input}
                      value={formState.subject}
                      onChange={(event) => setFormState((prev) => ({ ...prev, subject: event.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className={styles.inlineRow}>
                  <div>
                    <label className={styles.fieldLabel} htmlFor={`task-channel-${memberId}`}>
                      Channel
                    </label>
                    <select
                      id={`task-channel-${memberId}`}
                      className={styles.select}
                      value={formState.channel}
                      onChange={(event) => setFormState((prev) => ({ ...prev, channel: event.target.value }))}
                    >
                      {CHANNEL_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={styles.fieldLabel} htmlFor={`task-purpose-${memberId}`}>
                      Purpose
                    </label>
                    <select
                      id={`task-purpose-${memberId}`}
                      className={styles.select}
                      value={formState.purpose}
                      onChange={(event) => setFormState((prev) => ({ ...prev, purpose: event.target.value }))}
                    >
                      {PURPOSE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={styles.fieldLabel} htmlFor={`task-note-${memberId}`}>
                    Note
                  </label>
                  <textarea
                    id={`task-note-${memberId}`}
                    className={styles.textarea}
                    value={formState.note}
                    onChange={(event) => setFormState((prev) => ({ ...prev, note: event.target.value }))}
                  />
                </div>

                {formError ? <p className={styles.errorText}>{formError}</p> : null}

                <div className={styles.modalActions}>
                  <button type="button" className={styles.secondaryButton} onClick={closeModal} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className={styles.primaryButton} disabled={submitting}>
                    {submitting ? 'Saving…' : editingTask ? 'Update Task' : 'Create Task'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function defaultFormState(): TaskFormState {
  return {
    dueDate: new Date().toISOString().split('T')[0],
    subject: '',
    note: '',
    channel: CHANNEL_OPTIONS[0],
    purpose: PURPOSE_OPTIONS[0],
  };
}

function normalizeDateInput(date: string | null | undefined) {
  if (!date) {
    return null;
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().split('T')[0];
}

function formatDisplayDate(date: string | null | undefined) {
  if (!date) {
    return 'No due date';
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString();
}

function sortByDate(a: string | null | undefined, b: string | null | undefined) {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }

  const first = new Date(a).getTime();
  const second = new Date(b).getTime();
  return second - first;
}

function TaskPill({ label }: { label: string }) {
  return <span className={styles.taskPill}>{label}</span>;
}
