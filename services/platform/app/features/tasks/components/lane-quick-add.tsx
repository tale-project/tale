'use client';

/**
 * The fastest way onto the board: an "Add task" row at the foot of a lane
 * that turns into a title field. Enter creates the task in that lane — Medium
 * priority, starting today, and whatever priority or assignee the board is
 * filtered to — and keeps the field open and focused for the next one; Escape
 * or leaving it empty closes it. The card appears in the lane as the board
 * refreshes, and a screen reader hears which task was added.
 *
 * Everything beyond a title is the create dialog's: the lane's own "+" opens
 * it with the lane's status.
 */

import { toast } from '@tale/ui/use-toast';
import { Plus } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useCreateTask } from '../hooks/mutations';
import {
  DEFAULT_NEW_TASK_PRIORITY,
  defaultNewTaskStartDate,
} from '../lib/create-defaults';
import type { TaskActorType, TaskPriority, TaskStatus } from '../lib/display';

/** What a lane's quick add creates into, beyond its status. */
export interface LaneQuickAddConfig {
  organizationId: string;
  projectId: string;
  /** The board's priority filter, when it names one priority. */
  priority?: TaskPriority;
  /** The board's assignee filter, when it names one person or agent. */
  assignee?: { type: TaskActorType; id: string };
}

/** The longest title the server takes (`TASK_TITLE_MAX`). */
const TITLE_MAX = 200;

export function LaneQuickAdd({
  status,
  config,
}: {
  status: TaskStatus;
  config: LaneQuickAddConfig;
}) {
  const { t } = useT('tasks');
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  return (
    <div className="shrink-0">
      {open ? (
        // Mounted only while open: a closed lane holds no create observer.
        <LaneQuickAddForm
          status={status}
          config={config}
          onClose={() => setOpen(false)}
          onAdded={(title) => setAnnouncement(t('board.quickAdded', { title }))}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-sm transition-colors focus-visible:ring-1 focus-visible:outline-none motion-reduce:transition-none"
        >
          <Plus aria-hidden className="size-4 shrink-0" />
          {t('board.addTask')}
        </button>
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function LaneQuickAddForm({
  status,
  config,
  onClose,
  onAdded,
}: {
  status: TaskStatus;
  config: LaneQuickAddConfig;
  onClose: () => void;
  onAdded: (title: string) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const createTask = useCreateTask();
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await createTask.mutateAsync({
        organizationId: config.organizationId,
        projectId: config.projectId,
        title: trimmed,
        status,
        priority: config.priority ?? DEFAULT_NEW_TASK_PRIORITY,
        startDate: defaultNewTaskStartDate(),
        ...(config.assignee !== undefined
          ? {
              assigneeType: config.assignee.type,
              assigneeId: config.assignee.id,
            }
          : {}),
      });
      setTitle('');
      onAdded(trimmed);
    } catch (error) {
      console.error('[tasks] quick add failed', error);
      toast({
        title: tCommon('errors.generic'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    } finally {
      setPending(false);
      // The next task's title goes straight in.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <input
      ref={inputRef}
      autoFocus
      value={title}
      maxLength={TITLE_MAX}
      disabled={pending}
      aria-label={t('board.quickAddLabel')}
      placeholder={t('board.quickAddLabel')}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (title.trim() === '' && !pending) onClose();
      }}
      className="border-border bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-lg border px-3 text-sm shadow-xs outline-none focus-visible:ring-1 disabled:opacity-60"
    />
  );
}
