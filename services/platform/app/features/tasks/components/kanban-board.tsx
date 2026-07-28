import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Row } from '@tale/ui/layout';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { useTaskBoardDnd } from '../hooks/use-task-board-dnd';
import { plannedTransitionKind } from '../hooks/use-task-status-choreography';
import {
  resolveTaskOwnership,
  useTaskContractAutomations,
} from '../hooks/use-task-subject-contract';
import { BOARD_TASK_STATUSES } from '../lib/display';
import { partitionSubtasks } from '../lib/subtasks';
import { BoardColumn } from './board-column';
import { useRunCancelConfirm } from './run-cancel-confirm';
import { useTaskBoardContext } from './task-board-context';
import { TaskCard, type TaskRow } from './task-card';

/**
 * Kanban board. All drag mechanics (cross-column landing preview, within-column
 * reorder, empty-lane drops, bounce-free optimistic move, gentle autoscroll)
 * live in {@link useTaskBoardDnd}, shared with the list and table layouts.
 *
 * While an OWNED card is being dragged, each column that would carry a verb
 * (start / request changes / cancel) announces it in its header — the drag's
 * consequence is visible BEFORE the drop, not discovered from a toast after.
 * Cancelling a live run additionally asks first ({@link useRunCancelConfirm}).
 */
export function KanbanBoard({
  tasks,
  onOpenTask,
  projectKey,
  canEdit = false,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
  /** Caller may write to the project — gates drag-reorder and inline pickers. */
  canEdit?: boolean;
}) {
  const { t } = useT('tasks');
  const { confirmCancel, dialog } = useRunCancelConfirm();
  const dnd = useTaskBoardDnd(tasks, { confirmCancel });
  const { isAgentWorking } = useTaskBoardContext();
  const automations = useTaskContractAutomations(
    tasks[0]?.organizationId ?? '',
    tasks[0]?.projectId,
  );
  // The board keeps every task as a card (grouped by status); this map only
  // feeds the per-card subtask-progress ring.
  const childrenByParent = useMemo(
    () => partitionSubtasks(tasks).childrenByParent,
    [tasks],
  );

  // The dragged card's verb per column, from the SAME matrix that executes
  // the drop (`plannedTransitionKind`) — automation-owned cards name the
  // workflow act, agent-owned cards name the run kick/cancel.
  const { locale } = useLocale();
  const dropHints = useMemo(() => {
    const task = dnd.activeTask;
    if (!task) return null;
    const ownership = resolveTaskOwnership(task, automations, locale);
    const runActive = isAgentWorking(task._id);
    const hints = new Map<string, string>();
    for (const status of BOARD_TASK_STATUSES) {
      if (status === task.status) continue;
      if (ownership.kind === 'automation') {
        const kind = plannedTransitionKind(
          ownership.contract,
          task.status,
          status,
          runActive,
        );
        if (kind !== null) {
          hints.set(
            status,
            t(`automation.will.${kind}`, { name: ownership.displayName }),
          );
        }
      } else if (ownership.kind === 'agent') {
        if (status === 'in_progress') {
          hints.set(status, t('agentRun.willStart'));
        } else if (task.status === 'in_progress' && runActive) {
          hints.set(status, t('agentRun.willCancel'));
        }
      }
    }
    return hints.size > 0 ? hints : null;
  }, [automations, dnd.activeTask, isAgentWorking, locale, t]);

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.onDragStart}
      onDragOver={dnd.onDragOver}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
      autoScroll={dnd.autoScroll}
    >
      <Row
        gap={3}
        align="stretch"
        className="h-full snap-x overflow-x-auto px-0.5 pb-4"
      >
        {BOARD_TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={dnd.columns[status]
              .map((id) => dnd.byId.get(id))
              .filter((row): row is TaskRow => row != null)}
            childrenByParent={childrenByParent}
            onOpenTask={onOpenTask}
            projectKey={projectKey}
            canEdit={canEdit}
            dropHint={dropHints?.get(status) ?? null}
          />
        ))}
      </Row>
      <DragOverlay>
        {dnd.activeTask ? (
          <TaskCard
            task={dnd.activeTask}
            subtasks={childrenByParent.get(dnd.activeTask._id)}
            dragging
            projectKey={projectKey}
            canEdit={canEdit}
          />
        ) : null}
      </DragOverlay>
      {dialog}
    </DndContext>
  );
}
