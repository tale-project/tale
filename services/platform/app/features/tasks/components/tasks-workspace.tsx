'use client';

import { Button, LinkButton } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Tabs } from '@tale/ui/tabs';
import { BarChart3, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useMyAttentionSummary } from '@/app/features/notifications/hooks/queries';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useProjectDependencies,
  useTaskOpsIndicators,
  useTasksByProject,
} from '../hooks/queries';
import { TRIAGED_TASK_STATUSES } from '../lib/display';
import { isTaskView, type TaskView } from '../lib/view';
import { KanbanBoard } from './kanban-board';
import { TaskBoardProvider } from './task-board-context';
import type { TaskRow } from './task-card';
import { TaskModal } from './task-modal';
import { TasksBacklog } from './tasks-backlog';
import { TasksList } from './tasks-list';
import { TasksSkeleton } from './tasks-skeleton';

/** The Backlog tab's server-side scope: proposed tasks only. */
const BACKLOG_STATUSES = ['backlog' as const];

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
  /** The view this page renders — fixed per route (`/tasks/board`,
   *  `/tasks/list`, `/tasks/backlog`). */
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
  // Each view is scoped server-side: the board/list never receive backlog
  // rows (proposed tasks), and the backlog tab receives only them.
  const { tasks, canEdit, isLoading } = useTasksByProject(typedProjectId, {
    statuses: view === 'backlog' ? BACKLOG_STATUSES : TRIAGED_TASK_STATUSES,
  });
  const { edges } = useProjectDependencies(typedProjectId);
  const { runningTaskIds, reviewTaskIds } =
    useTaskOpsIndicators(typedProjectId);
  const { data: attention } = useMyAttentionSummary(
    organizationId,
    typedProjectId,
  );
  const [waitingOnMeOnly, setWaitingOnMeOnly] = usePersistedState(
    `tale.platform.tasks.${projectId}.waitingOnMe`,
    false,
  );
  const waitingOnMeIds = useMemo(
    () => new Set(attention?.waitingOnMeTaskIds ?? []),
    [attention?.waitingOnMeTaskIds],
  );
  const visibleTasks = useMemo(
    () =>
      waitingOnMeOnly
        ? tasks.filter((task) => waitingOnMeIds.has(task._id))
        : tasks,
    [tasks, waitingOnMeOnly, waitingOnMeIds],
  );
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
      <Row gap={3} justify="between" wrap>
        <Row gap={2} wrap>
          <Tabs
            variant="pill"
            value={view}
            onValueChange={(value) => {
              if (isTaskView(value) && value !== view) onViewChange(value);
            }}
            items={[
              { value: 'board', label: t('views.board') },
              { value: 'list', label: t('views.list') },
              { value: 'backlog', label: t('views.backlog') },
            ]}
          />
          <Button
            variant={waitingOnMeOnly ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={waitingOnMeOnly}
            disabled={waitingOnMeIds.size === 0 && !waitingOnMeOnly}
            onClick={() => setWaitingOnMeOnly((prev) => !prev)}
          >
            {t('filters.waitingOnMe')}
            {waitingOnMeIds.size > 0
              ? ` (${waitingOnMeIds.size > 99 ? '99+' : waitingOnMeIds.size})`
              : ''}
          </Button>
        </Row>
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
          {/* Read-only viewers can't create tasks (the server rejects the
              write); hide the action rather than surface a doomed button. */}
          {canEdit && (
            <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
              {t('actions.create')}
            </Button>
          )}
        </Row>
      </Row>

      {isFirstLoad ? (
        <TasksSkeleton view={view} />
      ) : (
        // An empty project still renders every lane / section (with its empty
        // hint) so the page keeps its shape instead of swapping to an island.
        <TaskBoardProvider
          tasks={visibleTasks}
          dependencyEdges={edges}
          runningTaskIds={runningTaskIds}
          reviewTaskIds={reviewTaskIds}
        >
          {view === 'board' ? (
            <div className="min-h-0 flex-1">
              <KanbanBoard
                tasks={visibleTasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
                canEdit={canEdit}
              />
            </div>
          ) : view === 'list' ? (
            <div className="min-h-0 flex-1">
              <TasksList
                tasks={visibleTasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
                canEdit={canEdit}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <TasksBacklog
                tasks={tasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
                canEdit={canEdit}
              />
            </div>
          )}
        </TaskBoardProvider>
      )}

      {/* One modal, two roles: create (no taskId) and view/edit (taskId). The
          preset status follows the view so a new task lands where the user is
          looking: a board/list create starts triaged (`todo`), a backlog-tab
          create files another proposal. */}
      <TaskModal
        organizationId={organizationId}
        projectId={typedProjectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultStatus={view === 'backlog' ? 'backlog' : 'todo'}
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
