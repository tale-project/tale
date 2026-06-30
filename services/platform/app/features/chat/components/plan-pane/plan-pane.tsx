'use client';

import { Badge } from '@tale/ui/badge';
import { useMatch } from '@tanstack/react-router';
import { Telescope } from 'lucide-react';
import { memo, useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import type { ChatPaneDescriptor } from '../chat-panel/types';
import { useAutoOpen, useRegisterPane } from '../chat-panel/use-register-pane';
import { TodoListCard } from '../todo-list-card';

/**
 * Research-plan pane. A registrar: it owns the todos query and publishes a
 * descriptor to the unified right panel ({@link useRegisterPane}); the shell
 * renders the strip / tab / body. The component itself renders nothing.
 */
function PlanPaneComponent() {
  const { t } = useT('todoList');
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const organizationId = useOrganizationId();
  const { data: todosData } = useConvexQuery(
    api.thread_todos.queries.get,
    threadId && organizationId ? { threadId, organizationId } : 'skip',
  );
  const hasTodos = !!todosData && todosData.todos.length > 0;
  const counts = computeCounts(todosData?.todos ?? []);

  const hasContent = !!threadId && hasTodos;
  useAutoOpen('plan', hasContent);

  const descriptor = useMemo<ChatPaneDescriptor | null>(() => {
    if (!hasContent || !threadId) return null;
    return {
      id: 'plan',
      icon: Telescope,
      label: t('title'),
      ariaLabel: t('stripOpen', { defaultValue: 'Open research plan' }),
      badge: (
        <div className="flex flex-col items-center gap-1">
          <Badge
            variant="outline"
            className="rotate-180 text-[10px] [writing-mode:vertical-rl]"
          >
            {t('progress', { done: counts.done, total: counts.total })}
          </Badge>
          {counts.failed > 0 && (
            <Badge
              variant="destructive"
              className="rotate-180 text-[10px] [writing-mode:vertical-rl]"
            >
              {t('failedCount', { count: counts.failed })}
            </Badge>
          )}
        </div>
      ),
      hasContent: true,
      body: (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TodoListCard
            threadId={threadId}
            hideHeader
            className="border-0 shadow-none"
          />
        </div>
      ),
    };
  }, [hasContent, threadId, t, counts.done, counts.total, counts.failed]);

  useRegisterPane(descriptor);

  return null;
}

function computeCounts(
  todos: Array<{
    status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  }>,
) {
  let done = 0;
  let failed = 0;
  for (const todo of todos) {
    if (todo.status === 'done') done += 1;
    else if (todo.status === 'failed') failed += 1;
  }
  return { done, failed, total: todos.length };
}

export const PlanPane = memo(PlanPaneComponent);
