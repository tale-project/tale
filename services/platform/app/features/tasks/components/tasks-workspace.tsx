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
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useDebounce } from '@/app/hooks/use-debounce';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useProjectDependencies,
  useTaskOpsIndicators,
  useTaskOpsIndicatorsAcrossProjects,
  useTasksAcrossProjects,
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
  allProjects = false,
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
  /** Cross-project aggregate scope (`?projects=all`). */
  allProjects?: boolean;
}) {
  const { t } = useT('tasks');
  const typedProjectId = asProjectId(projectId);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const trimmedSearchQuery = debouncedSearchQuery.trim();
  const [assigneeFilter, setAssigneeFilter] = useState(ALL_ASSIGNEE_FILTER);
  const [priorityFilter, setPriorityFilter] =
    useState<TaskPriorityFilter>(ALL_PRIORITY_FILTER);
  const [needsMyReviewFilter, setNeedsMyReviewFilter] = useState(false);
  const { members, agents, currentUserId } = useActorDirectory(
    organizationId,
    // Agents are project-scoped; in all-projects mode the filter still lists
    // org members, and agent assignees resolve via the directory without a
    // project agent catalog.
    allProjects ? undefined : projectId,
  );
  const assigneeQueryFilter = resolveAssigneeQueryFilter(
    assigneeFilter,
    currentUserId,
  );
  const listOptions = {
    statuses: BOARD_TASK_STATUSES,
    includeArchived,
    assigneeId: assigneeQueryFilter,
  };
  const projectList = useTasksByProject(
    allProjects ? undefined : typedProjectId,
    listOptions,
  );
  const acrossList = useTasksAcrossProjects({
    ...listOptions,
    enabled: allProjects,
  });
  const loadedTasks = allProjects ? acrossList.tasks : projectList.tasks;
  const canEdit = allProjects ? acrossList.canEdit : projectList.canEdit;
  const isLoading = allProjects ? acrossList.isLoading : projectList.isLoading;
  const { edges } = useProjectDependencies(
    allProjects ? undefined : typedProjectId,
  );
  const projectOps = useTaskOpsIndicators(
    allProjects ? undefined : typedProjectId,
  );
  const acrossOps = useTaskOpsIndicatorsAcrossProjects(allProjects);
  const runningTaskIds = allProjects
    ? acrossOps.runningTaskIds
    : projectOps.runningTaskIds;
  const askingTaskIds = allProjects
    ? acrossOps.askingTaskIds
    : projectOps.askingTaskIds;
  const pendingReviews = allProjects
    ? acrossOps.pendingReviews
    : projectOps.pendingReviews;
  const reviewRequestedFor = useMemo(
    () =>
      new Map(
        pendingReviews.map((review) => [
          String(review.taskId),
          review.requestedFor,
        ]),
      ),
    [pendingReviews],
  );
  const searchHits = useConvexQuery(
    api.tasks.search.searchTasks,
    trimmedSearchQuery.length > 0
      ? {
          organizationId,
          query: trimmedSearchQuery,
          ...(allProjects ? {} : { projectId: typedProjectId }),
        }
      : 'skip',
  );
  const searchMatchedIds = useMemo(() => {
    if (trimmedSearchQuery.length === 0 || !searchHits.data) return null;
    return new Set(searchHits.data.map((hit) => hit.taskId));
  }, [searchHits.data, trimmedSearchQuery]);
  const facetFilteredTasks = useMemo(
    () =>
      filterTasksByFacets(loadedTasks, {
        assignee: assigneeFilter,
        priority: priorityFilter,
        currentUserId,
        needsMyReview: needsMyReviewFilter,
        reviewRequestedFor,
      }),
    [
      loadedTasks,
      assigneeFilter,
      priorityFilter,
      currentUserId,
      needsMyReviewFilter,
      reviewRequestedFor,
    ],
  );
  const tasks = useMemo(() => {
    if (!searchMatchedIds) return facetFilteredTasks;
    return facetFilteredTasks.filter((task) => searchMatchedIds.has(task._id));
  }, [facetFilteredTasks, searchMatchedIds]);
  const { project } = useProject(typedProjectId);
  const projectKey = allProjects ? null : (project?.key ?? null);

  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskIdState] = useState(
    openTaskParam ? asTaskId(openTaskParam) : null,
  );
  // When opening from the all-projects board, the modal must target the row's
  // real project — not the route anchor.
  const [openTaskProjectId, setOpenTaskProjectId] =
    useState<Id<'projects'>>(typedProjectId);
  // Re-sync from the URL when `?task=` changes while mounted (e.g. an inbox
  // link clicked from this page) — render-time state adjustment, no effect.
  const [prevOpenTaskParam, setPrevOpenTaskParam] = useState(openTaskParam);
  if (openTaskParam !== prevOpenTaskParam) {
    setPrevOpenTaskParam(openTaskParam);
    setOpenTaskIdState(openTaskParam ? asTaskId(openTaskParam) : null);
    if (openTaskParam) {
      const fromRow = loadedTasks.find((task) => task._id === openTaskParam);
      if (fromRow) setOpenTaskProjectId(fromRow.projectId);
    }
  }
  const setOpenTaskId = (
    taskId: Id<'tasks'> | null,
    taskProjectId?: Id<'projects'>,
  ) => {
    setOpenTaskIdState(taskId);
    if (taskProjectId) setOpenTaskProjectId(taskProjectId);
    onOpenTaskParamChange?.(taskId);
  };

  const handleOpenTask = (task: TaskRow) =>
    setOpenTaskId(task._id, task.projectId);

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

  const handleReviewFilterChange = useCallback((values: string[]) => {
    setNeedsMyReviewFilter(values.includes('me'));
  }, []);

  const handleClearFilters = useCallback(() => {
    setAssigneeFilter(ALL_ASSIGNEE_FILTER);
    setPriorityFilter(ALL_PRIORITY_FILTER);
    setIncludeArchived(false);
    setNeedsMyReviewFilter(false);
    setSearchQuery('');
  }, []);

  const hasActiveFilters =
    assigneeFilter !== ALL_ASSIGNEE_FILTER ||
    priorityFilter !== ALL_PRIORITY_FILTER ||
    includeArchived ||
    needsMyReviewFilter ||
    searchQuery.trim().length > 0;

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
      // "Needs my review": the named-reviewer queue — tasks whose pending
      // review waits on the current user (or that sit at in_review with them
      // designated). Hidden for signed-out edge states (no current user).
      ...(currentUserId
        ? [
            {
              key: 'review',
              title: t('review.filterTitle'),
              options: [{ value: 'me', label: t('review.needsMyReview') }],
              selectedValues: needsMyReviewFilter ? ['me'] : [],
              onChange: handleReviewFilterChange,
              multiSelect: true,
            },
          ]
        : []),
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
      handleReviewFilterChange,
      includeArchived,
      members,
      needsMyReviewFilter,
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
            search={{
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: t('searchPlaceholder'),
            }}
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
              write); hide the action rather than surface a doomed button.
              All-projects mode has no single write target — Create stays off. */}
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
          askingTaskIds={askingTaskIds}
          pendingReviews={pendingReviews.map((review) => ({
            taskId: String(review.taskId),
            requestedFor: review.requestedFor,
          }))}
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

      {!allProjects && (
        <TaskModal
          organizationId={organizationId}
          projectId={typedProjectId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultStatus="todo"
          // A template create lands the user inside the new task, where the
          // subject panel names the next step (upload input files / Start).
          onOpenTask={(id) => setOpenTaskId(id, typedProjectId)}
        />
      )}
      <TaskModal
        organizationId={organizationId}
        projectId={openTaskProjectId}
        taskId={openTaskId}
        open={openTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
        onOpenTask={(id) => setOpenTaskId(id, openTaskProjectId)}
      />
    </ContentArea>
  );
}
