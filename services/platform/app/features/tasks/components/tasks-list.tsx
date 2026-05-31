import { Text } from '@tale/ui/text';
import { GitBranch } from 'lucide-react';

import { formatTaskIdentifier } from '@/lib/shared/project_key';

import { TASK_STATUS_ORDER, type TaskStatus } from '../lib/display';
import { AssigneeAvatar } from './assignee-avatar';
import type { TaskRow } from './task-card';
import { TaskPriorityBadge } from './task-priority-badge';
import { TaskStatusBadge } from './task-status-badge';

function groupByStatus(tasks: TaskRow[]): Record<TaskStatus, TaskRow[]> {
  const groups = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    cancelled: [],
  } as Record<TaskStatus, TaskRow[]>;
  for (const task of tasks) groups[task.status].push(task);
  for (const status of TASK_STATUS_ORDER) {
    groups[status].sort((a, b) => a.rank.localeCompare(b.rank));
  }
  return groups;
}

/**
 * Compact, single-column list grouped by status — the middle ground between the
 * spatial board and the dense table. Each status becomes a sticky section header
 * carrying its status badge; empty statuses are omitted so the list stays
 * scannable.
 */
export function TasksList({
  tasks,
  onOpenTask,
  projectKey,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
  const groups = groupByStatus(tasks);

  return (
    <div className="border-border h-full min-h-0 overflow-auto overscroll-contain rounded-lg border">
      {TASK_STATUS_ORDER.filter((status) => groups[status].length > 0).map(
        (status) => (
          <section key={status}>
            <div className="bg-muted sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
              <TaskStatusBadge status={status} />
              <Text as="span" variant="caption" className="tabular-nums">
                {groups[status].length}
              </Text>
            </div>
            <ul>
              {groups[status].map((task) => {
                const identifier = formatTaskIdentifier(
                  projectKey,
                  task.number,
                );
                return (
                  <li key={task._id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask?.(task)}
                      className="group hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring/50 flex w-full cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                    >
                      {identifier && (
                        <Text
                          as="span"
                          variant="caption"
                          className="hidden w-16 shrink-0 font-mono text-[11px] tracking-wide sm:block"
                        >
                          {identifier}
                        </Text>
                      )}
                      <Text
                        as="span"
                        variant="body"
                        className="line-clamp-1 flex-1"
                      >
                        {task.title}
                      </Text>
                      {task.parentTaskId && (
                        <GitBranch
                          className="text-muted-foreground size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      {task.priority && (
                        <div className="hidden shrink-0 sm:block">
                          <TaskPriorityBadge priority={task.priority} />
                        </div>
                      )}
                      <AssigneeAvatar
                        assigneeType={task.assigneeType}
                        assigneeId={task.assigneeId}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
