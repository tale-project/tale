'use client';

import { Button } from '@tale/ui/button';
import { useMatch } from '@tanstack/react-router';
import { PanelRightOpen, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { FileViewerRouter } from './file-viewer-router';
import { useWorkspace } from './workspace-context';
import { WorkspaceFileSidebar } from './workspace-file-sidebar';

interface CanvasPaneProps {
  organizationId: string;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 480;
const STRIP_WIDTH = 48;

function CanvasPaneComponent({ organizationId }: CanvasPaneProps) {
  const { t } = useT('chat');
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const {
    isOpen,
    activeFilePath,
    openWorkspace,
    closeWorkspace,
    setActiveFilePath,
  } = useWorkspace();

  const { data: filesData } = useConvexQuery(
    api.thread_files.queries.listThreadFilesForUser,
    threadId ? { threadId, organizationId } : 'skip',
  );
  const files = filesData ?? [];

  const [userDismissed, setUserDismissed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Reset per-thread dismissal state when the thread changes.
  useEffect(() => {
    setUserDismissed(false);
  }, [threadId]);

  // Auto-open the pane the first time files appear in this thread (unless
  // the user already dismissed it). Depend on the first-file path rather
  // than the array reference so Convex ticks don't refire this effect.
  const firstFilePath = files[0]?.path;
  useEffect(() => {
    if (firstFilePath && !userDismissed && !isOpen) {
      openWorkspace(firstFilePath);
    }
  }, [firstFilePath, userDismissed, isOpen, openWorkspace]);

  const handleClose = useCallback(() => {
    closeWorkspace();
    // Mark dismissed so we don't immediately re-auto-open. The strip
    // remains visible as a permanent re-entry point.
    setUserDismissed(true);
  }, [closeWorkspace]);

  const handleStripOpen = useCallback(() => {
    setUserDismissed(false);
    openWorkspace(firstFilePath);
  }, [openWorkspace, firstFilePath]);

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

  // Resolve the active path against the current file list; fall back to the
  // first file if the previously-active path was deleted or doesn't exist.
  const resolvedPath =
    activeFilePath && files.some((f) => f.path === activeFilePath)
      ? activeFilePath
      : (files[0]?.path ?? null);

  if (!threadId || files.length === 0) return null;

  // Closed → render the permanent strip so the user can always re-open.
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={handleStripOpen}
        aria-label={t('canvas.stripOpen', { defaultValue: 'Open canvas' })}
        className="border-border bg-background hover:bg-muted/50 group flex h-full shrink-0 cursor-pointer flex-col items-center gap-3 border-l py-4 transition-colors"
        style={{ width: STRIP_WIDTH }}
      >
        <PanelRightOpen className="text-muted-foreground group-hover:text-foreground size-4" />
        <span className="text-muted-foreground group-hover:text-foreground rotate-180 text-[10px] [writing-mode:vertical-rl]">
          {t('canvas.title', { defaultValue: 'Canvas' })} · {files.length}
        </span>
      </button>
    );
  }

  const activeFile = files.find((f) => f.path === resolvedPath);
  const filename = resolvedPath?.split('/').pop() ?? '';

  return (
    <div
      className="border-border bg-background relative flex h-full shrink-0 flex-col border-l"
      style={{ width }}
      role="complementary"
      aria-label={t('canvas.ariaLabel', { defaultValue: 'Canvas panel' })}
    >
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('canvas.paneResizeHandle', {
          defaultValue: 'Resize canvas panel',
        })}
      />

      <div className="border-border flex items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate font-mono text-xs"
            title={resolvedPath ?? ''}
          >
            {filename}
          </span>
          {activeFile && (
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {Math.max(1, Math.round(activeFile.size / 1024))} KB
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip
            content={t('canvas.paneClose', { defaultValue: 'Close canvas' })}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleClose}
              aria-label={t('canvas.paneClose', {
                defaultValue: 'Close canvas',
              })}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <WorkspaceFileSidebar
          files={files}
          activePath={resolvedPath}
          onSelect={setActiveFilePath}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileViewerRouter
            threadId={threadId}
            organizationId={organizationId}
            path={resolvedPath}
          />
        </div>
      </div>
    </div>
  );
}

export const CanvasPane = memo(CanvasPaneComponent);
