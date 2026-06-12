'use client';

import { Button, LinkButton } from '@tale/ui/button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tabs } from '@tale/ui/tabs';
import { BarChart3, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
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
import { TASK_STATUS_ORDER } from '../lib/display';
import { KanbanBoard } from './kanban-board';
import { TaskBoardProvider } from './task-board-context';
import type { TaskRow } from './task-card';
import { TaskModal } from './task-modal';
import { TaskStatusBadge } from './task-status-badge';
import { TasksList } from './tasks-list';

type TaskView = 'board' | 'list';

/** Brand an untrusted `?task=` URL value; a bogus id just renders an empty sheet. */
function asTaskId(value: string): Id<'tasks'> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- URL deep-link param; invalid ids resolve to null server-side
  return value as Id<'tasks'>;
}

const TASK_VIEWS: readonly TaskView[] = ['board', 'list'];

function isTaskView(value: string): value is TaskView {
  return (TASK_VIEWS as readonly string[]).includes(value);
}

/** One masked task-card placeholder mirroring the real card's footprint
 *  (identifier line · title · footer glyph row). */
function TaskCardSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="border-border bg-card rounded-lg border p-3 shadow-sm">
      <SkeletonBox>
        <div className="h-3 w-12" />
      </SkeletonBox>
      <div className="mt-1.5" style={{ width: titleWidth }}>
        <SkeletonBox fullWidth>
          <div className="h-3.5" />
        </SkeletonBox>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <SkeletonBox>
          <div className="h-3.5 w-10" />
        </SkeletonBox>
        <SkeletonBox>
          <div className="size-6 rounded-full" />
        </SkeletonBox>
      </div>
    </div>
  );
}

/**
 * First-load placeholder that fills the same `min-h-0 flex-1` slot as the real
 * board/list. It mirrors the loaded structure exactly — every status lane /
 * section renders (with its real status badge) holding 5 masked placeholder
 * rows — so the reveal is an in-place mask swap with no layout shift.
 */
function TasksSkeleton({ view }: { view: TaskView }) {
  if (view === 'board') {
    return (
      <Skeletonize loading>
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-0.5 pb-4">
          {TASK_STATUS_ORDER.map((status, col) => (
            <section
              key={status}
              className="bg-muted/40 flex w-[80vw] max-w-72 shrink-0 flex-col rounded-lg sm:w-72"
            >
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <TaskStatusBadge status={status} />
                <SkeletonBox>
                  <div className="h-3.5 w-4" />
                </SkeletonBox>
              </div>
              <div className="flex flex-col gap-2 overflow-hidden px-2 pt-0.5 pb-2">
                {Array.from({ length: 5 }).map((_, card) => (
                  <TaskCardSkeleton
                    key={card}
                    titleWidth={`${55 + (((col + card) * 17) % 36)}%`}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </Skeletonize>
    );
  }
  return (
    <Skeletonize loading>
      <div className="min-h-0 flex-1 overflow-hidden">
        {TASK_STATUS_ORDER.map((status, section) => (
          <section key={status}>
            <div className="bg-background flex items-center gap-2 px-3 py-1.5">
              <span className="text-muted-foreground -ml-1 flex items-center gap-2 p-1">
                <ChevronRight
                  className="size-3.5 shrink-0 rotate-90"
                  aria-hidden="true"
                />
                <TaskStatusBadge status={status} />
                <SkeletonBox>
                  <div className="h-3.5 w-4" />
                </SkeletonBox>
              </span>
            </div>
            {Array.from({ length: 5 }).map((_, row) => (
              <div
                key={row}
                className="border-border/60 flex items-center gap-2.5 border-b py-1.5 pr-3 pl-9"
              >
                <SkeletonBox>
                  <div className="size-3.5 rounded" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="hidden h-3.5 w-14 sm:block" />
                </SkeletonBox>
                <div className="min-w-0 flex-1">
                  <div
                    className="max-w-xs"
                    style={{ width: `${42 + (((section + row) * 19) % 31)}%` }}
                  >
                    <SkeletonBox fullWidth>
                      <div className="h-3.5" />
                    </SkeletonBox>
                  </div>
                </div>
                <SkeletonBox>
                  <div className="size-6 rounded-full" />
                </SkeletonBox>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Skeletonize>
  );
}

export function TasksWorkspace({
  organizationId,
  projectId,
  openTaskParam,
  onOpenTaskParamChange,
}: {
  organizationId: string;
  projectId: string;
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

  const [storedView, setView] = usePersistedState<TaskView>(
    `tale.platform.tasks.${projectId}.view`,
    'board',
  );
  // Migration guard: 'metrics' used to be a view pill before it moved to its
  // own page — a persisted 'metrics' (or any unknown value) falls back to
  // 'board' instead of rendering nothing.
  const view: TaskView = isTaskView(storedView) ? storedView : 'board';
  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskIdState] = useState(
    openTaskParam ? asTaskId(openTaskParam) : null,
  );
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
          ]}
        />
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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
