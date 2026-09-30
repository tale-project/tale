'use client';

import { Alert } from '@tale/ui/alert';
import { cn } from '@tale/ui/cn';
import { ContentArea } from '@tale/ui/content-area';
import { DataTableActionMenu } from '@tale/ui/data-table/data-table-action-menu';
import {
  DataTableFilters,
  DataTableToolbar,
} from '@tale/ui/data-table/data-table-filters';
import { isFilterAffordanceDisabled } from '@tale/ui/filters/filter-panel';
import { Row } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tabs } from '@tale/ui/tabs';
import { useDebounce } from '@tale/ui/use-debounce';
import { Plus } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useT } from '@/lib/i18n/client';

import {
  useProjectDependencies,
  useTaskOpsIndicators,
  useTaskOpsIndicatorsAcrossProjects,
  useTasksAcrossProjects,
  useTasksByProject,
} from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import { useTaskAccess } from '../hooks/use-task-access';
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
import { readFailed, readRetrying } from '../lib/read-state';
import { isTaskView, type TaskView } from '../lib/view';
import { KanbanBoard } from './kanban-board';
import { TaskBoardProvider } from './task-board-context';
import type { TaskRow } from './task-card';
import { TaskModal } from './task-modal';
import { TaskReadAlert } from './task-read-alert';
import { TasksList } from './tasks-list';
import { TasksSkeleton } from './tasks-skeleton';

/** Brand an untrusted `?task=` URL value; a bogus id just renders an empty sheet. */
function asTaskId(value: string): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- URL deep-link param; invalid ids resolve to null server-side
  return value;
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
  // The search is a board filter: the server matches it with the others
  // before the board's cap, so every matching task is reachable (#3745).
  const listOptions = {
    statuses: BOARD_TASK_STATUSES,
    includeArchived,
    assigneeId: assigneeQueryFilter,
    query: trimmedSearchQuery,
    keepRowsWhileNarrowing: true,
  };
  const projectList = useTasksByProject(
    allProjects ? undefined : typedProjectId,
    listOptions,
  );
  const acrossList = useTasksAcrossProjects({
    ...listOptions,
    enabled: allProjects,
  });
  const list = allProjects ? acrossList : projectList;
  const loadedTasks = list.tasks;
  const tasksRead = list.read;
  // A subtask's parents are looked up among the loaded cards: work rights
  // run down the subtask tree.
  const loadedById = useMemo(
    () => new Map(loadedTasks.map((task) => [task._id, task])),
    [loadedTasks],
  );
  const resolveLoadedTask = useCallback(
    (taskId: string) => loadedById.get(taskId),
    [loadedById],
  );
  // Editors work every task; every reader creates tasks and works their own —
  // one decision per task, the server's own rule.
  const access = useTaskAccess(
    organizationId,
    { canEdit: list.canEdit, canCreate: list.canCreate },
    resolveLoadedTask,
  );
  const { canCreate } = access;
  const dependencies = useProjectDependencies(
    allProjects ? undefined : typedProjectId,
  );
  const { edges } = dependencies;
  const projectOps = useTaskOpsIndicators(
    allProjects ? undefined : typedProjectId,
  );
  const acrossOps = useTaskOpsIndicatorsAcrossProjects(allProjects);
  const ops = allProjects ? acrossOps : projectOps;
  const { runningTaskIds, askingTaskIds, pendingReviews } = ops;
  const reviewRequestedFor = useMemo(
    () =>
      new Map(
        pendingReviews.map((review) => [review.taskId, review.requestedFor]),
      ),
    [pendingReviews],
  );
  // One array per answer: a new one each render would rebuild the board's
  // context and re-render every card that reads it.
  const pendingReviewRefs = useMemo(
    () =>
      pendingReviews.map((review) => ({
        taskId: review.taskId,
        requestedFor: review.requestedFor,
      })),
    [pendingReviews],
  );
  const tasks = useMemo(
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
  const { project } = useProject(typedProjectId);
  const projectKey = allProjects ? null : (project?.key ?? null);
  // A board read with no answer — pending, or failed — says nothing about
  // the viewer's rights; the project layout's own read does, so Create and
  // the archived filter stay put while the tasks load or fail to: every
  // reader of an active project may create a task there.
  const answered = tasksRead.kind === 'ready' || tasksRead.kind === 'stale';
  const controlsCanCreate =
    canCreate ||
    (!answered &&
      !allProjects &&
      project != null &&
      project.archivedAt === undefined);

  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskIdState] = useState(
    openTaskParam ? asTaskId(openTaskParam) : null,
  );
  // When opening from the all-projects board, the modal must target the row's
  // real project — not the route anchor.
  const [openTaskProjectId, setOpenTaskProjectId] =
    useState<string>(typedProjectId);
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
  // The route hands a new callback on every render, and a `?task=` change is
  // one. The open handler reads the latest one through a ref so it keeps one
  // identity: the memoized board and list then skip every render the dialog
  // causes, where each open and close re-rendered all cards twice (#3939).
  // The ref follows the committed props, as `useFocusHandoff` does: a render
  // React discards never hands its callback to a later click.
  const onOpenTaskParamChangeRef = useRef(onOpenTaskParamChange);
  useLayoutEffect(() => {
    onOpenTaskParamChangeRef.current = onOpenTaskParamChange;
  });
  const setOpenTaskId = useCallback(
    (taskId: string | null, taskProjectId?: string) => {
      setOpenTaskIdState(taskId);
      if (taskProjectId) setOpenTaskProjectId(taskProjectId);
      onOpenTaskParamChangeRef.current?.(taskId);
    },
    [],
  );

  const handleOpenTask = useCallback(
    (task: TaskRow) => setOpenTaskId(task._id, task.projectId),
    [setOpenTaskId],
  );

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
      // Archived tasks are only actionable for someone who may restore one —
      // an editor, or a member their own — so the filter shows for whoever
      // may create (and so archive) a task here, and stays while it is on,
      // so it can always be turned off.
      ...(controlsCanCreate || includeArchived
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
      controlsCanCreate,
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
  // refetch keeps showing its rows, and a new search or filter keeps the
  // previous ones — dimmed and busy — until its answer lands.
  const isFirstLoad = tasksRead.kind === 'loading';
  const updating = tasksRead.kind === 'ready' && tasksRead.updating;
  // The project layout already knows its permission while the task read is
  // pending. Reserve the pickers' footprint an editor gets on every card.
  const skeletonCanEdit =
    list.canEdit || (!allProjects && project?.canEdit === true);
  // Where a retry that worked hands the focus: the board it brought back.
  const boardRegionRef = useRef<HTMLDivElement>(null);
  const focusBoard = useCallback(() => boardRegionRef.current?.focus(), []);
  // While the tasks fail, their alert stands for every failed board read,
  // so its Try again re-issues each of them.
  const retryTasks = () => {
    list.retry();
    if (readFailed(dependencies.read)) dependencies.retry();
    if (readFailed(ops.read)) ops.retry();
  };

  return (
    <ContentArea gap={4} className="flex h-full flex-col">
      {/* The list pages' toolbar (DataTable's header): controls left, the
          create action right at their h-9 height, wrapping to a line of its
          own when the column can't hold both, and on a phone a full-width
          row beneath them. */}
      <DataTableToolbar
        action={
          // Every reader of an active project may create a task; on an
          // archived one the server refuses, so the action is hidden rather
          // than a doomed button. All-projects mode has no single write
          // target — Create stays off there (drag / pickers still work).
          controlsCanCreate && !allProjects ? (
            <Skeletonize loading={isFirstLoad} className="contents">
              <DataTableActionMenu
                label={t('actions.create')}
                icon={Plus}
                onClick={() => setCreateOpen(true)}
              />
            </Skeletonize>
          ) : null
        }
      >
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
            // Whoever may create gets the widening archived filter, so the
            // button stays reachable over an empty default view (an
            // all-archived project is re-opened through it); a failed or
            // pending read is an unknown set, never an empty one.
            disabled={isFilterAffordanceDisabled({
              isLoading: isFirstLoad,
              isError: readFailed(tasksRead),
              itemCount: loadedTasks.length,
              hasActiveFilters,
              filters: taskFilterConfigs,
            })}
            className="w-auto"
          />
        </Row>
      </DataTableToolbar>

      {tasksRead.kind === 'failed' ? (
        // No lanes over a failed read: six "No tasks" would claim an empty
        // board the server never answered (#3747).
        <TaskReadAlert
          message={t('read.tasksFailed')}
          retrying={tasksRead.retrying}
          onRetry={retryTasks}
          onFocusLost={focusBoard}
        />
      ) : isFirstLoad ? (
        <TasksSkeleton view={view} canEdit={skeletonCanEdit} />
      ) : (
        <>
          {tasksRead.kind === 'stale' ? (
            <TaskReadAlert
              message={t('read.tasksStale')}
              retrying={tasksRead.retrying}
              onRetry={retryTasks}
              onFocusLost={focusBoard}
            />
          ) : (
            <>
              {readFailed(dependencies.read) && (
                <TaskReadAlert
                  variant="warning"
                  message={t('read.dependenciesFailed')}
                  retrying={readRetrying(dependencies.read)}
                  onRetry={dependencies.retry}
                  onFocusLost={focusBoard}
                />
              )}
              {readFailed(ops.read) && (
                <TaskReadAlert
                  variant="warning"
                  message={
                    needsMyReviewFilter
                      ? t('read.activityFailedReviewFilter')
                      : t('read.activityFailed')
                  }
                  retrying={readRetrying(ops.read)}
                  onRetry={ops.retry}
                  onFocusLost={focusBoard}
                />
              )}
            </>
          )}
          {list.truncated && (
            <Alert
              variant="info"
              live="off"
              description={t('read.truncated', { count: loadedTasks.length })}
            />
          )}
          {/* An empty project still renders every lane / section (with its
              empty hint) so the page keeps its shape instead of swapping to
              an island. */}
          <TaskBoardProvider
            tasks={tasks}
            dependencyEdges={edges}
            runningTaskIds={runningTaskIds}
            askingTaskIds={askingTaskIds}
            pendingReviews={pendingReviewRefs}
          >
            <div
              ref={boardRegionRef}
              role="region"
              aria-label={view === 'board' ? t('views.board') : t('views.list')}
              aria-busy={updating || undefined}
              tabIndex={-1}
              className={cn(
                'focus-visible:ring-ring min-h-0 flex-1 rounded-lg transition-opacity duration-200 outline-none focus-visible:ring-2 motion-reduce:transition-none',
                // Dimmed only once an answer is slow, so a quick one never
                // flickers the board.
                updating && 'opacity-60 delay-300',
              )}
            >
              {view === 'board' ? (
                <KanbanBoard
                  tasks={tasks}
                  onOpenTask={handleOpenTask}
                  projectKey={projectKey}
                  canWorkTask={access.canWorkTask}
                />
              ) : (
                <TasksList
                  tasks={tasks}
                  onOpenTask={handleOpenTask}
                  projectKey={projectKey}
                  canWorkTask={access.canWorkTask}
                />
              )}
            </div>
          </TaskBoardProvider>
        </>
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
        showProjectLink={allProjects}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
        onOpenTask={(id) => setOpenTaskId(id, openTaskProjectId)}
      />
    </ContentArea>
  );
}
