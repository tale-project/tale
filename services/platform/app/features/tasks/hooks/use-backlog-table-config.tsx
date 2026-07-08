'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Play, XCircle } from 'lucide-react';
import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';

import { AssigneePicker } from '../components/assignee-picker';
import type { TaskRow } from '../components/task-card';
import { useAssignTask, useUpdateTaskStatus } from './mutations';

/**
 * Triage verbs for one proposed (backlog) task: Start promotes it onto the
 * board (status → `todo`), Close rejects it (status → `cancelled`). Both go
 * through the standard `updateTaskStatus` mutation, so its guards apply
 * (`statusChangedAt` stamp, agent circuit-breaker reset, parent-close check);
 * a failure surfaces as the shared error toast and the reactive query reverts
 * the row. Hidden for read-only viewers — the server rejects the write anyway.
 */
function BacklogRowActions({
  task,
  canEdit,
}: {
  task: TaskRow;
  canEdit: boolean;
}) {
  const { t } = useT('tasks');
  const updateStatus = useUpdateTaskStatus();
  if (!canEdit) return null;
  return (
    <HStack gap={2} justify="end">
      <Button
        size="sm"
        variant="secondary"
        icon={Play}
        disabled={updateStatus.isPending}
        onClick={(e) => {
          e.stopPropagation();
          updateStatus.mutate({ taskId: task._id, status: 'todo' });
        }}
      >
        {t('backlog.start')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={XCircle}
        disabled={updateStatus.isPending}
        onClick={(e) => {
          e.stopPropagation();
          updateStatus.mutate({ taskId: task._id, status: 'cancelled' });
        }}
      >
        {t('backlog.close')}
      </Button>
    </HStack>
  );
}

/** The same inline assignee control the List rows carry (it already stops
 *  click propagation, so opening it never opens the row's task modal). */
function BacklogAssigneeCell({
  task,
  canEdit,
}: {
  task: TaskRow;
  canEdit: boolean;
}) {
  const assignTask = useAssignTask();
  return (
    <AssigneePicker
      organizationId={task.organizationId}
      projectId={task.projectId}
      assigneeType={task.assigneeType}
      assigneeId={task.assigneeId}
      align="end"
      disabled={!canEdit}
      onAssign={(assigneeType, assigneeId) =>
        assignTask.mutate({ taskId: task._id, assigneeType, assigneeId })
      }
      onUnassign={() => assignTask.mutate({ taskId: task._id })}
    />
  );
}

interface BacklogTableConfig {
  columns: ColumnDef<TaskRow>[];
}

/**
 * Column config for the Backlog triage tab's DataTable (mirrors the
 * `use-*-table-config` pattern of customers/audit-logs). Proposed tasks —
 * typically synced by automations, titled like "#1337 Add button to header" —
 * are triaged with the inline Start/Close verbs in the actions column.
 */
export function useBacklogTableConfig({
  projectKey,
  canEdit,
}: {
  projectKey: string | null;
  canEdit: boolean;
}): BacklogTableConfig {
  const { t } = useT('tasks');

  const columns = useMemo<ColumnDef<TaskRow>[]>(
    () => [
      {
        accessorKey: 'title',
        header: t('fields.title'),
        size: 280,
        cell: ({ row }) => {
          const identifier = formatTaskIdentifier(
            projectKey,
            row.original.number,
          );
          return (
            <HStack gap={2} className="min-w-0">
              {identifier && (
                <Text
                  as="span"
                  variant="caption"
                  className="shrink-0 font-mono text-[11px] tracking-wide"
                >
                  {identifier}
                </Text>
              )}
              <Text as="span" variant="body" truncate>
                {row.original.title}
              </Text>
            </HStack>
          );
        },
      },
      {
        accessorKey: 'description',
        header: t('fields.description'),
        size: 240,
        // The one prose column soaks up the container slack; siblings keep
        // their declared px (see DataTable's `meta.flex` contract).
        meta: { flex: true },
        cell: ({ row }) => (
          <Text as="span" variant="muted" truncate className="block max-w-xl">
            {/* Synced descriptions carry newlines/markdown — collapse to one
                line for the snippet; the modal shows the full text. */}
            {row.original.description?.replaceAll(/\s+/g, ' ').trim() || '–'}
          </Text>
        ),
      },
      {
        id: 'assignee',
        header: t('fields.assignee'),
        size: 90,
        meta: { skeleton: { type: 'badge' as const } },
        cell: ({ row }) => (
          <BacklogAssigneeCell task={row.original} canEdit={canEdit} />
        ),
      },
      {
        accessorKey: 'createdAt',
        header: () => (
          <Text as="span" align="right" className="block w-full">
            {t('fields.created')}
          </Text>
        ),
        size: 120,
        meta: { headerLabel: t('fields.created'), align: 'right' as const },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.createdAt}
            preset="short"
            alignRight
          />
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('backlog.actions')}</span>,
        // Wider than ACTIONS_COLUMN_SIZE on purpose: triage is this tab's whole
        // job, so its two verbs stay inline instead of behind a 3-dot menu.
        size: 190,
        meta: { isAction: true },
        cell: ({ row }) => (
          <BacklogRowActions task={row.original} canEdit={canEdit} />
        ),
      },
    ],
    [t, projectKey, canEdit],
  );

  return { columns };
}
