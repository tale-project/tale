'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { Plus, X } from 'lucide-react';
import { useMemo } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import { cn } from '@/lib/utils/cn';

import {
  useAddTaskDependency,
  useRemoveTaskDependency,
} from '../hooks/mutations';
import { useTaskDependencies, useTasksByProject } from '../hooks/queries';
import type { TaskDoc } from '../lib/display';
import { TaskStatusBadge } from './task-status-badge';

type TaskRow = TaskDoc;

/**
 * "Blocked by" / "Blocks" editor for a task. Both directions write the same
 * directed edge (blocker → blocked) via {@link useAddTaskDependency}; the link
 * is advisory — it surfaces a blocked indicator on the board but never gates a
 * status change. The picker only offers same-project tasks not already linked,
 * and the backend rejects any edge that would close a cycle (surfaced here as a
 * friendly toast).
 */
export function TaskDependencies({
  task,
  canEdit,
  projectKey,
  onOpenTask,
}: {
  task: TaskRow;
  canEdit: boolean;
  projectKey?: string | null;
  onOpenTask?: (taskId: Id<'tasks'>) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { blockedBy, blocks } = useTaskDependencies(task._id);
  const { tasks: projectTasks } = useTasksByProject(task.projectId);
  const addDependency = useAddTaskDependency();
  const removeDependency = useRemoveTaskDependency();

  const onMutationError = (error: unknown) => {
    if (
      error instanceof ConvexError &&
      error.data?.code === 'TASK_DEPENDENCY_CYCLE'
    ) {
      toast({ title: t('detail.dependencyCycle'), variant: 'destructive' });
      return;
    }
    console.error('[tasks] dependency action failed', error);
    toast({ title: tCommon('errors.generic'), variant: 'destructive' });
  };

  // Exclude self and anything already linked in either direction — the inverse
  // link would just be a two-node cycle the backend rejects anyway.
  const candidates = useMemo(() => {
    const excluded = new Set<string>([
      task._id,
      ...blockedBy.map((b) => b._id),
      ...blocks.map((b) => b._id),
    ]);
    return projectTasks.filter((p) => !excluded.has(p._id) && !p.archivedAt);
  }, [projectTasks, blockedBy, blocks, task._id]);

  if (!canEdit && blockedBy.length === 0 && blocks.length === 0) return null;

  return (
    // Lives in the modal's side property panel — the heading mirrors the
    // panel's PropertyField label style so the column reads as one list.
    <Stack as="section" gap={3}>
      <h3 className="text-muted-foreground text-xs font-medium">
        {t('detail.dependencies')}
      </h3>
      <DependencyGroup
        label={t('detail.blockedBy')}
        items={blockedBy}
        candidates={candidates}
        canEdit={canEdit}
        projectKey={projectKey}
        onOpenTask={onOpenTask}
        onAdd={(blockerTaskId) =>
          void addDependency
            .mutateAsync({ blockerTaskId, blockedTaskId: task._id })
            .catch(onMutationError)
        }
        onRemove={(blockerTaskId) =>
          void removeDependency
            .mutateAsync({ blockerTaskId, blockedTaskId: task._id })
            .catch(onMutationError)
        }
      />
      <DependencyGroup
        label={t('detail.blocks')}
        items={blocks}
        candidates={candidates}
        canEdit={canEdit}
        projectKey={projectKey}
        onOpenTask={onOpenTask}
        onAdd={(blockedTaskId) =>
          void addDependency
            .mutateAsync({ blockerTaskId: task._id, blockedTaskId })
            .catch(onMutationError)
        }
        onRemove={(blockedTaskId) =>
          void removeDependency
            .mutateAsync({ blockerTaskId: task._id, blockedTaskId })
            .catch(onMutationError)
        }
      />
    </Stack>
  );
}

function DependencyGroup({
  label,
  items,
  candidates,
  canEdit,
  projectKey,
  onOpenTask,
  onAdd,
  onRemove,
}: {
  label: string;
  items: TaskRow[];
  candidates: TaskRow[];
  canEdit: boolean;
  projectKey?: string | null;
  onOpenTask?: (taskId: Id<'tasks'>) => void;
  onAdd: (taskId: Id<'tasks'>) => void;
  onRemove: (taskId: Id<'tasks'>) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');

  if (!canEdit && items.length === 0) return null;

  const options: SearchableSelectOption[] = candidates.map((c) => ({
    value: c._id,
    label: c.title,
    description: formatTaskIdentifier(projectKey, c.number) ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <Row gap={0} justify="between">
        <Text as="span" variant="caption">
          {label}
        </Text>
        {canEdit && candidates.length > 0 && (
          <SearchableSelect
            value={null}
            onValueChange={(value) => {
              const match = candidates.find((c) => c._id === value);
              if (match) onAdd(match._id);
            }}
            options={options}
            align="end"
            searchPlaceholder={t('detail.linkTask')}
            emptyText={tCommon('search.noResults')}
            aria-label={label}
            optionAction={(opt) => {
              const match = candidates.find((c) => c._id === opt.value);
              return match ? <TaskStatusBadge status={match.status} /> : null;
            }}
            trigger={
              <Button
                type="button"
                variant="ghost"
                icon={Plus}
                className="text-muted-foreground -mr-1 h-auto px-1.5 py-0.5"
              >
                {t('actions.add')}
              </Button>
            }
          />
        )}
      </Row>
      {items.length > 0 ? (
        <Stack as="ul" gap={1} className="w-full">
          {items.map((item) => {
            const identifier = formatTaskIdentifier(projectKey, item.number);
            return (
              // Full-width chip: title fades with a mask (no ellipsis); the
              // remove control is an absolute overlay that only appears on
              // hover / focus / touch — same pattern as browser tabs.
              <li key={item._id} className="group/dep relative w-full">
                <button
                  type="button"
                  onClick={() => onOpenTask?.(item._id)}
                  disabled={!onOpenTask}
                  title={item.title}
                  className={cn(
                    'bg-muted focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    !onOpenTask && 'cursor-default',
                  )}
                >
                  <TaskStatusBadge status={item.status} compact />
                  {identifier && (
                    <Text
                      as="span"
                      variant="caption"
                      className="shrink-0 font-mono text-[11px] tracking-wide"
                    >
                      {identifier}
                    </Text>
                  )}
                  <span className="min-w-0 flex-1 overflow-hidden mask-[linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] whitespace-nowrap">
                    {item.title}
                  </span>
                </button>
                {canEdit && (
                  // Gradient scrub under the remove control so the X doesn't
                  // sit on top of the title glyphs (see browser-tab chips).
                  <div
                    className={cn(
                      'absolute inset-y-0 right-0 z-10 flex items-center rounded-r-md bg-gradient-to-l from-muted from-45% to-transparent pr-0.5 pl-7 opacity-0 transition-opacity',
                      'group-focus-within/dep:opacity-100 group-hover/dep:opacity-100',
                      'pointer-coarse:opacity-100',
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      icon={X}
                      title={t('detail.removeDependency')}
                      className="text-muted-foreground hover:text-foreground pointer-events-none size-7 group-focus-within/dep:pointer-events-auto group-hover/dep:pointer-events-auto pointer-coarse:pointer-events-auto"
                      onClick={() => onRemove(item._id)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </Stack>
      ) : (
        <Text as="p" variant="muted" className="text-xs">
          {t('detail.noDependencies')}
        </Text>
      )}
    </div>
  );
}
