'use client';

import { useMatch } from '@tanstack/react-router';
import { PanelRightClose, Telescope, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useCanvasOptional } from '../canvas/canvas-context';
import { TodoListCard } from '../todo-list-card';

const MIN_WIDTH = 280;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 360;
const STRIP_WIDTH = 48;

function PlanPaneComponent() {
  const { t } = useT('todoList');
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const { data: todosData } = useConvexQuery(
    api.thread_todos.queries.get,
    threadId ? { threadId } : 'skip',
  );
  const hasTodos = !!todosData && todosData.todos.length > 0;
  const counts = computeCounts(todosData?.todos ?? []);

  const canvas = useCanvasOptional();
  const isCanvasOpen = !!canvas?.isCanvasOpen;

  const [userDismissed, setUserDismissed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    setUserDismissed(false);
    setIsOpen(false);
    setIsMinimized(false);
  }, [threadId]);

  useEffect(() => {
    if (hasTodos && !userDismissed && !isOpen) {
      setIsOpen(true);
    }
  }, [hasTodos, userDismissed, isOpen]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setUserDismissed(true);
  }, []);

  const handleMinimize = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const handleStripOpen = useCallback(() => {
    canvas?.closeCanvas();
    setIsMinimized(false);
    setUserDismissed(false);
    setIsOpen(true);
  }, [canvas]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth =
      resizeRef.current?.parentElement?.offsetWidth ?? DEFAULT_WIDTH;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + delta),
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  if (!threadId || !hasTodos || !isOpen) return null;

  if (isCanvasOpen || isMinimized) {
    return (
      <button
        type="button"
        onClick={handleStripOpen}
        aria-label={t('stripOpen')}
        className={cn(
          'border-border bg-background hover:bg-muted/50 group flex h-full shrink-0 flex-col items-center gap-3 border-l py-4 transition-colors',
          'cursor-pointer',
        )}
        style={{ width: STRIP_WIDTH }}
      >
        <Telescope className="text-muted-foreground group-hover:text-foreground size-4" />
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
      </button>
    );
  }

  return (
    <div
      className="border-border bg-background relative flex h-full shrink-0 flex-col border-l"
      style={{ width }}
      role="complementary"
      aria-label={t('ariaLabel')}
    >
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('paneResizeHandle')}
      />

      <div className="border-border flex items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Telescope className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{t('title')}</span>
          <Badge variant="outline" className="shrink-0 text-xs">
            {t('progress', { done: counts.done, total: counts.total })}
          </Badge>
          {counts.failed > 0 && (
            <Badge variant="destructive" className="shrink-0 text-xs">
              {t('failedCount', { count: counts.failed })}
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content={t('paneMinimize')} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleMinimize}
              aria-label={t('paneMinimize')}
            >
              <PanelRightClose className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('paneClose')} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleClose}
              aria-label={t('paneClose')}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <TodoListCard
          threadId={threadId}
          hideHeader
          className="border-0 shadow-none"
        />
      </div>
    </div>
  );
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
