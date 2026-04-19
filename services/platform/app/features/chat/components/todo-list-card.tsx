'use client';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Loader2,
  MinusCircle,
  Telescope,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

type TodoStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';

interface TodoListCardProps {
  threadId: string;
  className?: string;
}

function TodoListCardComponent({ threadId, className }: TodoListCardProps) {
  const { t } = useT('todoList');
  const [collapsed, setCollapsed] = useState(false);

  const { data: todosData } = useConvexQuery(api.thread_todos.queries.get, {
    threadId,
  });

  const counts = useMemo(() => {
    const result: Record<TodoStatus, number> & { total: number } = {
      pending: 0,
      in_progress: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
    };
    if (!todosData) return result;
    for (const todo of todosData.todos) {
      result[todo.status] = result[todo.status] + 1;
      result.total = result.total + 1;
    }
    return result;
  }, [todosData]);

  if (!todosData || todosData.todos.length === 0) {
    return null;
  }

  const progressLabel = t('progress', {
    done: counts.done,
    total: counts.total,
  });

  return (
    <div
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-sm',
        className,
      )}
      aria-live="polite"
      aria-label={t('ariaLabel')}
    >
      <HStack
        align="center"
        justify="between"
        className="gap-2 border-b px-4 py-3"
      >
        <HStack align="center" className="min-w-0 gap-2">
          <Telescope className="text-muted-foreground size-4 shrink-0" />
          <Text as="div" className="truncate font-medium">
            {t('title')}
          </Text>
          <Badge variant="outline" className="shrink-0">
            {progressLabel}
          </Badge>
          {counts.failed > 0 && (
            <Badge variant="destructive" className="shrink-0">
              {t('failedCount', { count: counts.failed })}
            </Badge>
          )}
        </HStack>
        <Tooltip content={collapsed ? t('expand') : t('collapse')} side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? t('expand') : t('collapse')}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
        </Tooltip>
      </HStack>
      {!collapsed && (
        <ol className="m-0 flex list-none flex-col gap-0 p-0">
          {todosData.todos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </ol>
      )}
    </div>
  );
}

interface TodoRowProps {
  todo: {
    id: string;
    content: string;
    status: TodoStatus;
    findingsSummary?: string;
    failureReason?: string;
  };
}

function TodoRow({ todo }: TodoRowProps) {
  const { t } = useT('todoList');
  return (
    <li
      className={cn(
        'flex gap-3 border-b px-4 py-3 last:border-b-0',
        todo.status === 'cancelled' && 'opacity-60',
      )}
      aria-label={`${statusLabelKey(todo.status)}: ${todo.content}`}
    >
      <TodoStatusIcon
        status={todo.status}
        label={t(statusLabelKey(todo.status))}
      />
      <Stack className="min-w-0 flex-1 gap-1">
        <Text
          as="div"
          className={cn(
            'leading-snug',
            todo.status === 'done' &&
              'line-through decoration-muted-foreground/60',
            todo.status === 'cancelled' && 'line-through',
          )}
        >
          {todo.content}
        </Text>
        {todo.findingsSummary && todo.status === 'done' && (
          <Text as="div" variant="muted" className="text-sm leading-snug">
            {todo.findingsSummary}
          </Text>
        )}
        {todo.status === 'failed' && todo.failureReason && (
          <HStack align="center" className="gap-1.5">
            <AlertTriangle className="text-destructive size-3.5 shrink-0" />
            <Text as="div" variant="muted" className="text-sm leading-snug">
              {todo.failureReason}
            </Text>
          </HStack>
        )}
      </Stack>
    </li>
  );
}

interface TodoStatusIconProps {
  status: TodoStatus;
  label: string;
}

function TodoStatusIcon({ status, label }: TodoStatusIconProps) {
  const iconClass = 'size-5 shrink-0';
  const wrapperClass = 'mt-0.5';
  const node = (() => {
    switch (status) {
      case 'done':
        return (
          <Check
            className={cn(iconClass, 'text-emerald-500')}
            aria-hidden="true"
          />
        );
      case 'in_progress':
        return (
          <Loader2
            className={cn(
              iconClass,
              'animate-spin text-primary motion-reduce:animate-none',
            )}
            aria-hidden="true"
          />
        );
      case 'failed':
        return (
          <AlertTriangle
            className={cn(iconClass, 'text-destructive')}
            aria-hidden="true"
          />
        );
      case 'cancelled':
        return (
          <MinusCircle
            className={cn(iconClass, 'text-muted-foreground')}
            aria-hidden="true"
          />
        );
      case 'pending':
      default:
        return (
          <Circle
            className={cn(iconClass, 'text-muted-foreground')}
            aria-hidden="true"
          />
        );
    }
  })();
  return (
    <Tooltip content={label} side="right">
      <span className={wrapperClass} role="img" aria-label={label}>
        {status === 'in_progress' ? (
          <CircleDot
            className={cn(iconClass, 'text-primary')}
            aria-hidden="true"
          />
        ) : (
          node
        )}
      </span>
    </Tooltip>
  );
}

function statusLabelKey(status: TodoStatus): string {
  switch (status) {
    case 'in_progress':
      return 'statusInProgress';
    case 'done':
      return 'statusDone';
    case 'failed':
      return 'statusFailed';
    case 'cancelled':
      return 'statusCancelled';
    case 'pending':
    default:
      return 'statusPending';
  }
}

export const TodoListCard = memo(TodoListCardComponent);
