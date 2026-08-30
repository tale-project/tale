'use client';

import { Workflow } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useTaskSubjectContract,
  type TaskOwnershipFields,
} from '../hooks/use-task-subject-contract';
import { deriveSubjectState } from '../lib/subject-state';

/**
 * The ownership marker for an automation-owned task — the one always-visible
 * signal that this card does NOT behave like a plain task (its status verbs
 * run the owning workflow). Icon + automation name in the modal; on the dense
 * board card the icon carries a SHORT state chip when the subject has a next
 * step to tell ("Ready to start" / "Waiting for files"), so the board itself
 * says what the task is waiting for instead of leaving the choreography
 * implicit. Both render the explanatory tooltip. Renders nothing for unowned
 * tasks.
 */
export function TaskAutomationBadge({
  organizationId,
  task,
  showName = false,
  runActive = false,
  className,
}: {
  organizationId: string;
  task: TaskOwnershipFields & {
    projectId: string;
    status?: string;
    /** The bound folder id for folder-input subjects (absent = unbound). */
    externalId?: string;
    /** Folder-input fact stamped by the list queries; undefined = unknown. */
    hasFiles?: boolean;
  };
  /** Icon + automation name (the modal); default icon-only (board card). */
  showName?: boolean;
  /** True while a run is live on the task — the working pulse next door
   * already tells that story, so the chip stays quiet. */
  runActive?: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  const resolved = useTaskSubjectContract(organizationId, task);
  if (!resolved) return null;

  const name = resolved.displayName;
  const hint = t('automation.hint', { name });

  // The chip only speaks when its facts are known: a folder-input contract
  // needs a bound folder AND the stamped `hasFiles`; a status-only contract
  // needs the status. An unbound folder subject has no upload surface, so a
  // "waiting for files" chip would point nowhere.
  const factsKnown =
    task.status !== undefined &&
    (resolved.contract.input?.kind !== 'folder' ||
      (task.externalId !== undefined &&
        task.externalId !== '' &&
        task.hasFiles !== undefined));
  const state =
    !showName && !runActive && factsKnown && task.status !== undefined
      ? deriveSubjectState(resolved.contract, {
          status: task.status,
          runActive,
          hasFiles: task.hasFiles ?? false,
        })
      : null;
  const chip =
    state?.kind === 'ready'
      ? t('automation.chipReady')
      : state?.kind === 'waiting_input'
        ? t('automation.chipWaiting')
        : null;

  return (
    <Tooltip content={hint}>
      <span
        className={cn(
          'text-muted-foreground inline-flex min-w-0 items-center gap-1 text-xs',
          className,
        )}
        aria-label={hint}
      >
        <Workflow className="size-3.5 shrink-0" aria-hidden />
        {showName && <span className="truncate">{name}</span>}
        {chip !== null && <span className="truncate">{chip}</span>}
      </span>
    </Tooltip>
  );
}
