'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Tabs } from '@tale/ui/tabs';
import { ListTodo, Plus } from 'lucide-react';
import { useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useTasksByProject } from '../hooks/queries';
import { CreateTaskDialog } from './create-task-dialog';
import { KanbanBoard } from './kanban-board';
import type { TaskRow } from './task-card';
import { TaskDetailSheet } from './task-detail-sheet';
import { TasksTable } from './tasks-table';

type TaskView = 'board' | 'table';

export function TasksWorkspace({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useT('tasks');
  const typedProjectId = asProjectId(projectId);
  const { tasks, isLoading } = useTasksByProject(typedProjectId);
  const { project } = useProject(typedProjectId);
  const projectKey = project?.key ?? null;

  const [view, setView] = usePersistedState<TaskView>(
    `tale.platform.tasks.${projectId}.view`,
    'board',
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<Id<'tasks'> | null>(null);

  const handleOpenTask = (task: TaskRow) => setOpenTaskId(task._id);

  return (
    <ContentArea gap={4} className="flex h-full flex-col py-4">
      <div className="flex items-center justify-between gap-3">
        <Tabs
          variant="pill"
          value={view}
          onValueChange={(value) => {
            if (value === 'board' || value === 'table') setView(value);
          }}
          items={[
            { value: 'board', label: t('views.board') },
            { value: 'table', label: t('views.table') },
          ]}
        />
        <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
          {t('actions.create')}
        </Button>
      </div>

      {!isLoading && tasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={t('title')}
          description={t('actions.create')}
        />
      ) : view === 'board' ? (
        <div className="min-h-0 flex-1">
          <KanbanBoard
            tasks={tasks}
            onOpenTask={handleOpenTask}
            projectKey={projectKey}
          />
        </div>
      ) : (
        <TasksTable
          tasks={tasks}
          onOpenTask={handleOpenTask}
          projectKey={projectKey}
        />
      )}

      <CreateTaskDialog
        organizationId={organizationId}
        projectId={typedProjectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <TaskDetailSheet
        taskId={openTaskId}
        open={openTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
      />
    </ContentArea>
  );
}
