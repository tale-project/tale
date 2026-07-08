'use client';

import { Inbox } from 'lucide-react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useT } from '@/lib/i18n/client';

import { useBacklogTableConfig } from '../hooks/use-backlog-table-config';
import type { TaskRow } from './task-card';

/**
 * The Backlog triage tab: a table of PROPOSED tasks (status `backlog`,
 * typically synced in by automations such as the GitHub issue sync) that a
 * human either **Start**s (→ `todo`, onto the board) or **Close**s
 * (→ `cancelled`). Row click opens the same task detail modal as the board
 * and list; columns and verbs live in {@link useBacklogTableConfig}.
 */
export function TasksBacklog({
  tasks,
  onOpenTask,
  projectKey,
  canEdit = false,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
  /** Caller may write to the project — gates the Start/Close triage verbs. */
  canEdit?: boolean;
}) {
  const { t } = useT('tasks');
  const { columns } = useBacklogTableConfig({
    projectKey: projectKey ?? null,
    canEdit,
  });

  return (
    <DataTable
      columns={columns}
      data={tasks}
      caption={t('backlog.caption')}
      getRowId={(task) => task._id}
      onRowClick={(row) => onOpenTask?.(row.original)}
      stickyLayout
      className="h-full"
      emptyState={{
        icon: Inbox,
        title: t('backlog.empty.title'),
        description: t('backlog.empty.description'),
      }}
    />
  );
}
