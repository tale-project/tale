import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';

import { AssigneeAvatar } from './assignee-avatar';
import type { TaskRow } from './task-card';
import { TaskPriorityBadge } from './task-priority-badge';
import { TaskStatusBadge } from './task-status-badge';

export function TasksTable({
  tasks,
  onOpenTask,
  projectKey,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
  const { t } = useT('tasks');
  const showIdColumn = tasks.some(
    (task) => formatTaskIdentifier(projectKey, task.number) !== null,
  );

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border bg-muted/40 text-muted-foreground border-b text-left">
          <tr>
            {showIdColumn && (
              <th className="px-3 py-2 font-medium">{t('fields.id')}</th>
            )}
            <th className="px-3 py-2 font-medium">{t('fields.title')}</th>
            <th className="px-3 py-2 font-medium">{t('fields.status')}</th>
            <th className="px-3 py-2 font-medium">{t('fields.priority')}</th>
            <th className="px-3 py-2 font-medium">{t('fields.assignee')}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- table row open affordance; keyboard activation handled via onKeyDown
            <tr
              key={task._id}
              tabIndex={0}
              onClick={() => onOpenTask?.(task)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenTask?.(task);
                }
              }}
              className="border-border hover:bg-muted/30 cursor-pointer border-b last:border-0"
            >
              {showIdColumn && (
                <td className="text-muted-foreground px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {formatTaskIdentifier(projectKey, task.number) ?? '—'}
                </td>
              )}
              <td className="px-3 py-2">
                <Text as="span" variant="label">
                  {task.title}
                </Text>
              </td>
              <td className="px-3 py-2">
                <TaskStatusBadge status={task.status} />
              </td>
              <td className="px-3 py-2">
                {task.priority ? (
                  <TaskPriorityBadge priority={task.priority} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                <AssigneeAvatar
                  assigneeType={task.assigneeType}
                  assigneeId={task.assigneeId}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
