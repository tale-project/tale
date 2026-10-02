'use client';

import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { Workflow } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import {
  type ContractAutomationEntry,
  type ResolvedTaskSubjectContract,
  type TaskOwnershipFields,
  useTaskContractAutomations,
  useTaskSubjectContractAmong,
} from '../hooks/use-task-subject-contract';
import { deriveSubjectState } from '../lib/subject-state';
import { useBoardActorDirectory } from './task-board-context';

interface TaskAutomationBadgeProps {
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
}

/**
 * The ownership marker for an automation-owned task — the one always-visible
 * signal that this card does NOT behave like a plain task (its status verbs
 * run the owning workflow). Icon + automation name in the modal; on the dense
 * board card the icon carries a SHORT state chip when the subject has a next
 * step to tell ("Ready to start" / "Waiting for files"), so the board itself
 * says what the task is waiting for instead of leaving the choreography
 * implicit. Both render the explanatory tooltip. Renders nothing for unowned
 * tasks.
 *
 * On a project's board the owner is resolved among the board's own listing
 * of the project's automations; anywhere else (the task dialog, the
 * all-projects board) the badge lists them itself.
 */
export function TaskAutomationBadge(props: TaskAutomationBadgeProps) {
  const board = useBoardActorDirectory(props.task.projectId);
  return board !== undefined ? (
    <TaskAutomationBadgeAmong
      {...props}
      automations={board.contractAutomations}
    />
  ) : (
    <TaskAutomationBadgeWithOwnListing {...props} />
  );
}

function TaskAutomationBadgeWithOwnListing(props: TaskAutomationBadgeProps) {
  const automations = useTaskContractAutomations(
    props.organizationId,
    props.task.projectId,
  );
  return <TaskAutomationBadgeAmong {...props} automations={automations} />;
}

function TaskAutomationBadgeAmong({
  automations,
  ...props
}: TaskAutomationBadgeProps & { automations: ContractAutomationEntry[] }) {
  const resolved = useTaskSubjectContractAmong(props.task, automations);
  // Most tasks have no automation owner: they mount no chip at all.
  if (!resolved) return null;
  return <TaskAutomationChip {...props} resolved={resolved} />;
}

function TaskAutomationChip({
  task,
  showName = false,
  runActive = false,
  className,
  resolved,
}: TaskAutomationBadgeProps & { resolved: ResolvedTaskSubjectContract }) {
  const { t } = useT('tasks');

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
