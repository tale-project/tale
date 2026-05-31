import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
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
    <div className="border-border h-full min-h-0 overflow-auto overscroll-contain rounded-lg border">
      <Table stickyLayout>
        <TableHeader sticky>
          <TableRow>
            {showIdColumn && (
              <TableHead className="hidden sm:table-cell">
                {t('fields.id')}
              </TableHead>
            )}
            <TableHead>{t('fields.title')}</TableHead>
            <TableHead>{t('fields.status')}</TableHead>
            <TableHead className="hidden sm:table-cell">
              {t('fields.priority')}
            </TableHead>
            <TableHead className="text-right">{t('fields.assignee')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- table row open affordance; keyboard activation handled via onKeyDown
            <TableRow
              key={task._id}
              tabIndex={0}
              onClick={() => onOpenTask?.(task)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenTask?.(task);
                }
              }}
              className="focus-visible:bg-muted focus-visible:ring-ring/50 cursor-pointer focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
            >
              {showIdColumn && (
                <TableCell className="text-muted-foreground hidden font-mono text-xs whitespace-nowrap sm:table-cell">
                  {formatTaskIdentifier(projectKey, task.number) ?? '—'}
                </TableCell>
              )}
              <TableCell>
                <Text as="span" variant="label" className="line-clamp-1">
                  {task.title}
                </Text>
              </TableCell>
              <TableCell>
                <TaskStatusBadge status={task.status} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {task.priority ? (
                  <TaskPriorityBadge priority={task.priority} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <AssigneeAvatar
                    assigneeType={task.assigneeType}
                    assigneeId={task.assigneeId}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
