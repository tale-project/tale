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

import { useProjectDependencies, useTasksByProject } from '../hooks/queries';
import { CreateTaskDialog } from './create-task-dialog';
import { KanbanBoard } from './kanban-board';
import { TaskBoardProvider } from './task-board-context';
import type { TaskRow } from './task-card';
import { TaskDetailSheet } from './task-detail-sheet';
import { TasksList } from './tasks-list';
import { TasksTable } from './tasks-table';

type TaskView = 'board' | 'list' | 'table';

const TASK_VIEWS: readonly TaskView[] = ['board', 'list', 'table'];

function isTaskView(value: string): value is TaskView {
  return (TASK_VIEWS as readonly string[]).includes(value);
}

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
  const { edges } = useProjectDependencies(typedProjectId);
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
            if (isTaskView(value)) setView(value);
          }}
          items={[
            { value: 'board', label: t('views.board') },
            { value: 'list', label: t('views.list') },
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
          description={t('empty.description')}
          action={
            <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
              {t('actions.create')}
            </Button>
          }
        />
      ) : (
        <TaskBoardProvider tasks={tasks} dependencyEdges={edges}>
          {view === 'board' ? (
            <div className="min-h-0 flex-1">
              <KanbanBoard
                tasks={tasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
              />
            </div>
          ) : view === 'list' ? (
            <div className="min-h-0 flex-1">
              <TasksList
                tasks={tasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <TasksTable
                tasks={tasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
              />
            </div>
          )}
        </TaskBoardProvider>
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
        onOpenTask={(id) => setOpenTaskId(id)}
      />
    </ContentArea>
  );
}
