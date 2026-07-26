'use client';

import { Workflow } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useTaskSubjectContract,
  type TaskOwnershipFields,
} from '../hooks/use-task-subject-contract';

/**
 * The ownership marker for an automation-owned task — the one visible signal
 * that this card does NOT behave like a plain task (its status verbs run the
 * owning workflow). Icon-only on the dense board card, icon + automation
 * name in the modal; both carry the explanatory tooltip. Renders nothing for
 * unowned tasks.
 */
export function TaskAutomationBadge({
  organizationId,
  task,
  showName = false,
  className,
}: {
  organizationId: string;
  task: TaskOwnershipFields & { projectId: Id<'projects'> };
  /** Icon + automation name (the modal); default icon-only (board card). */
  showName?: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  const resolved = useTaskSubjectContract(organizationId, task);
  if (!resolved) return null;

  const name = resolved.automationSlug;
  const hint = t('automation.hint', { name });
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
      </span>
    </Tooltip>
  );
}
