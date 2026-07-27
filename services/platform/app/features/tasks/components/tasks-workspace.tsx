'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Tabs } from '@tale/ui/tabs';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useProjectDependencies,
  useTaskOpsIndicators,
  useTasksByProject,
} from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import { BOARD_TASK_STATUSES, TASK_PRIORITY_ORDER } from '../lib/display';
import {
  ALL_ASSIGNEE_FILTER,
  ALL_PRIORITY_FILTER,
  ASSIGNEE_FILTER_ME,
  ASSIGNEE_FILTER_UNASSIGNED,
  filterTasksByFacets,
  resolveAssigneeQueryFilter,
  type TaskPriorityFilter,
} from '../lib/filter-tasks';
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
  /** The view this page renders — fixed per route (`/tasks/board`,
   *  `/tasks/list`). */
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
  const [includeArchived, setIncludeArchived] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState(ALL_ASSIGNEE_FILTER);
  const [priorityFilter, setPriorityFilter] =
    useState<TaskPriorityFilter>(ALL_PRIORITY_FILTER);
  const { members, agents, currentUserId } = useActorDirectory(
    organizationId,
    projectId,
  );
  const assigneeQueryFilter = resolveAssigneeQueryFilter(
    assigneeFilter,
    currentUserId,
  );
  const {
    tasks: loadedTasks,
    canEdit,
    isLoading,
  } = useTasksByProject(typedProjectId, {
    statuses: BOARD_TASK_STATUSES,
    includeArchived,
    assigneeId: assigneeQueryFilter,
  });
  const tasks = useMemo(
    () =>
      filterTasksByFacets(loadedTasks, {
        assignee: assigneeFilter,
        priority: priorityFilter,
        currentUserId,
      }),
    [loadedTasks, assigneeFilter, priorityFilter, currentUserId],
  );
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

  const handleAssigneeFilterChange = useCallback((values: string[]) => {
    setAssigneeFilter(values[0] ?? ALL_ASSIGNEE_FILTER);
  }, []);

  const handlePriorityFilterChange = useCallback((values: string[]) => {
    setPriorityFilter(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- value is one of this filter's own priority options
      (values[0] as TaskPriorityFilter | undefined) ?? ALL_PRIORITY_FILTER,
    );
  }, []);

  const handleArchivedFilterChange = useCallback((values: string[]) => {
    setIncludeArchived(values.includes('include'));
  }, []);

  const handleClearFilters = useCallback(() => {
    setAssigneeFilter(ALL_ASSIGNEE_FILTER);
    setPriorityFilter(ALL_PRIORITY_FILTER);
    setIncludeArchived(false);
  }, []);

  const hasActiveFilters =
    assigneeFilter !== ALL_ASSIGNEE_FILTER ||
    priorityFilter !== ALL_PRIORITY_FILTER ||
    includeArchived;

  const taskFilterConfigs = useMemo(
    () => [
      {
        key: 'assignee',
        title: t('fields.assignee'),
        options: [
          ...(currentUserId
            ? [{ value: ASSIGNEE_FILTER_ME, label: t('assignee.you') }]
            : []),
          {
            value: ASSIGNEE_FILTER_UNASSIGNED,
            label: t('fields.unassigned'),
          },
          ...members.map((member) => ({
            value: member.id,
            label: member.name,
          })),
          ...agents.map((agent) => ({
            value: agent.id,
            label: agent.name,
          })),
        ],
        selectedValues:
          assigneeFilter === ALL_ASSIGNEE_FILTER ? [] : [assigneeFilter],
        onChange: handleAssigneeFilterChange,
      },
      {
        key: 'priority',
        title: t('fields.priority'),
        options: [
          ...TASK_PRIORITY_ORDER.map((priority) => ({
            value: priority,
            label: t(`priority.${priority}`),
          })),
          { value: 'none', label: t('priority.none') },
        ],
        selectedValues:
          priorityFilter === ALL_PRIORITY_FILTER ? [] : [priorityFilter],
        onChange: handlePriorityFilterChange,
      },
      // Archived tasks are only actionable for editors (viewers can't
      // restore them), so the filter mirrors the old checkbox's canEdit gate.
      ...(canEdit
        ? [
            {
              key: 'archived',
              title: t('archived.badge'),
              options: [{ value: 'include', label: t('list.showArchived') }],
              selectedValues: includeArchived ? ['include'] : [],
              onChange: handleArchivedFilterChange,
              multiSelect: true,
              widensResultSet: true,
            },
          ]
        : []),
    ],
    [
      agents,
      assigneeFilter,
      canEdit,
      currentUserId,
      handleArchivedFilterChange,
      handleAssigneeFilterChange,
      handlePriorityFilterChange,
      includeArchived,
      members,
      priorityFilter,
      t,
    ],
  );

  // Only skeletonize the genuine first load (no cached tasks yet). A background
  // refetch with rows already present keeps showing them instead of flashing.
  const isFirstLoad = isLoading && loadedTasks.length === 0;

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
            ]}
          />
          <DataTableFilters
            filters={taskFilterConfigs}
            onClearAll={handleClearFilters}
            // Editors always get the widening archived filter, so the button
            // must stay reachable even over an empty default view (an
            // all-archived project is re-opened through it).
            disabled={!canEdit && loadedTasks.length === 0 && !hasActiveFilters}
            className="w-auto"
          />
        </Row>
        <Row gap={2}>
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
                canEdit={canEdit}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <TasksList
                tasks={tasks}
                onOpenTask={handleOpenTask}
                projectKey={projectKey}
                canEdit={canEdit}
              />
            </div>
          )}
        </TaskBoardProvider>
      )}

      <TaskModal
        organizationId={organizationId}
        projectId={typedProjectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultStatus="todo"
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
