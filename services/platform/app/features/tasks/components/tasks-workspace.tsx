'use client';

import { Button, LinkButton } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Tabs } from '@tale/ui/tabs';
import { BarChart3, Plus } from 'lucide-react';
import { useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useProjectDependencies,
  useTaskOpsIndicators,
  useTasksByProject,
} from '../hooks/queries';
import { isTaskView, type TaskView } from '../lib/view';
import { KanbanBoard } from './kanban-board';
import { TaskBoardProvider } from './task-board-context';
import type { TaskRow } from './task-card';
import { TaskModal } from './task-modal';
import { TasksList } from './tasks-list';
import { TasksSkeleton } from './tasks-skeleton';

/** Brand an untrusted `?task=` URL value; a bogus id just renders an empty sheet. */
function asTaskId(value: string): Id<'tasks'> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- URL deep-link param; invalid ids resolve to null server-side
  return value as Id<'tasks'>;
}

export function TasksWorkspace({
  organizationId,
  projectId,
  view,
  onViewChange,
  openTaskParam,
  onOpenTaskParamChange,
}: {
  organizationId: string;
  projectId: string;
  /** The view this page renders — fixed per route (`/tasks/board`, `/tasks/list`). */
  view: TaskView;
  /** Switch pages: the route navigates to the sibling view and persists it. */
  onViewChange: (view: TaskView) => void;
  /** `?task=` deep-link target (route search param). */
  openTaskParam?: string;
  /** Keeps the URL in sync so open tasks are shareable/linkable. */
  onOpenTaskParamChange?: (taskId: string | null) => void;
}) {
  const { t } = useT('tasks');
  const typedProjectId = asProjectId(projectId);
  const { tasks, isLoading } = useTasksByProject(typedProjectId);
  const { edges } = useProjectDependencies(typedProjectId);
  const { runningTaskIds, reviewTaskIds } =
    useTaskOpsIndicators(typedProjectId);
  const { project } = useProject(typedProjectId);
  const projectKey = project?.key ?? null;

  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskIdState] = useState(
    openTaskParam ? asTaskId(openTaskParam) : null,
  );
  // Re-sync from the URL when `?task=` changes while mounted (e.g. an inbox
  // link clicked from this page) — render-time state adjustment, no effect.
  const [prevOpenTaskParam, setPrevOpenTaskParam] = useState(openTaskParam);
  if (openTaskParam !== prevOpenTaskParam) {
    setPrevOpenTaskParam(openTaskParam);
    setOpenTaskIdState(openTaskParam ? asTaskId(openTaskParam) : null);
  }
  const setOpenTaskId = (taskId: Id<'tasks'> | null) => {
    setOpenTaskIdState(taskId);
    onOpenTaskParamChange?.(taskId);
  };

  const handleOpenTask = (task: TaskRow) => setOpenTaskId(task._id);

  // Only skeletonize the genuine first load (no cached tasks yet). A background
  // refetch with rows already present keeps showing them instead of flashing.
  const isFirstLoad = isLoading && tasks.length === 0;

  return (
    <ContentArea gap={4} className="flex h-full flex-col py-4">
      <Row gap={3} justify="between">
        <Tabs
          variant="pill"
          value={view}
          onValueChange={(value) => {
            if (isTaskView(value) && value !== view) onViewChange(value);
          }}
          items={[
            { value: 'board', label: t('views.board') },
            { value: 'list', label: t('views.list') },
          ]}
        />
        <Row gap={2}>
          <LinkButton
            href="/dashboard/$id/projects/$projectId/metrics"
            params={{ id: organizationId, projectId }}
            variant="secondary"
            size="sm"
            icon={BarChart3}
          >
            {t('metrics.link')}
          </LinkButton>
          <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
            {t('actions.create')}
          </Button>
        </Row>
      </Row>

      {isFirstLoad ? (
        <TasksSkeleton view={view} />
      ) : (
        // An empty project still renders every lane / section (with its empty
        // hint) so the page keeps its shape instead of swapping to an island.
        <TaskBoardProvider
          tasks={tasks}
          dependencyEdges={edges}
          runningTaskIds={runningTaskIds}
          reviewTaskIds={reviewTaskIds}
        >
          {view === 'board' ? (
            <div className="min-h-0 flex-1">
              <KanbanBoard
                tasks={tasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <TasksList
                tasks={tasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
              />
            </div>
          )}
        </TaskBoardProvider>
      )}

      {/* One modal, two roles: create (no taskId) and view/edit (taskId). */}
      <TaskModal
        organizationId={organizationId}
        projectId={typedProjectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <TaskModal
        organizationId={organizationId}
        projectId={typedProjectId}
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
