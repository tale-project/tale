'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
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

/**
 * First-load placeholder that fills the same `min-h-0 flex-1` slot as the real
 * board/list/table. Rendered instead of mounting the loaded view against an
 * empty task array (which used to flash a board full of "No tasks" lanes) so
 * the reveal is a mask swap with no layout shift.
 */
function TasksSkeleton({ view }: { view: TaskView }) {
  if (view === 'board') {
    return (
      <Skeletonize loading>
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, col) => (
            <div key={col} className="flex w-64 shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <SkeletonBox>
                  <div className="h-3.5 w-20" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="size-5 rounded" />
                </SkeletonBox>
              </div>
              {Array.from({ length: 3 }).map((__, card) => (
                <SkeletonBox key={card} fullWidth>
                  <div className="h-20 w-full rounded-lg" />
                </SkeletonBox>
              ))}
            </div>
          ))}
        </div>
      </Skeletonize>
    );
  }
  return (
    <Skeletonize loading>
      <div className="border-border min-h-0 flex-1 overflow-hidden rounded-lg border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="border-border flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
          >
            <SkeletonBox>
              <div className="size-4 rounded" />
            </SkeletonBox>
            <div className="min-w-0 flex-1">
              <div
                className="max-w-xs"
                style={{ width: `${42 + ((i * 19) % 31)}%` }}
              >
                <SkeletonBox fullWidth>
                  <div className="h-3.5" />
                </SkeletonBox>
              </div>
            </div>
            <SkeletonBox>
              <div className="h-5 w-16 rounded-full" />
            </SkeletonBox>
            <SkeletonBox>
              <div className="size-6 rounded-full" />
            </SkeletonBox>
          </div>
        ))}
      </div>
    </Skeletonize>
  );
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

  // Only skeletonize the genuine first load (no cached tasks yet). A background
  // refetch with rows already present keeps showing them instead of flashing.
  const isFirstLoad = isLoading && tasks.length === 0;

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

      {isFirstLoad ? (
        <TasksSkeleton view={view} />
      ) : tasks.length === 0 ? (
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
