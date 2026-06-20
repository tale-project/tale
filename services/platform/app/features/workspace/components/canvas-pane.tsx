'use client';

import { Button } from '@tale/ui/button';
import { useMatch } from '@tanstack/react-router';
import { parsePartialJson } from 'ai';
import { Download, PanelRightOpen, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useBranchContext } from '@/app/features/chat/context/branch-context';
import { useStreamingTools } from '@/app/features/chat/context/streaming-tool-context';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import type { ThreadFileItem } from '../types';
import { FileViewerRouter } from './file-viewer-router';
import { useWorkspace } from './workspace-context';
import { WorkspaceFileSidebar } from './workspace-file-sidebar';

interface CanvasPaneProps {
  organizationId: string;
}

interface LiveFile {
  toolCallId: string;
  path: string;
  contentPreview?: string;
  encoding: 'utf-8' | 'base64';
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
  const routeThreadId = threadMatch?.params?.threadId;

  // Files written on a branch live on the branch-tip thread, not the route
  // thread. Resolve to the same active-branch thread the message list uses so
  // branch-tip files stay visible after streaming; fall back to the route param
  // before the branch chain resolves.
  const { activeBranchThreadId } = useBranchContext();
  const threadId = activeBranchThreadId ?? routeThreadId;

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
  const threadFiles = useMemo(() => filesData ?? [], [filesData]);

  // ── Streaming file_write live state ──────────────────────────────────────
  const { active: activeTools } = useStreamingTools();
  const [liveFiles, setLiveFiles] = useState<LiveFile[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: LiveFile[] = [];
      for (const call of activeTools) {
        if (call.toolName !== 'file_write') continue;
        try {
          const parsed = await parsePartialJson(call.rawInput);
          const value = parsed.value;
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
          }
          const pathField = (value as { path?: unknown }).path;
          const path = typeof pathField === 'string' ? pathField : undefined;
          if (!path) continue;
          const contentField = (value as { content?: unknown }).content;
          const content =
            typeof contentField === 'string' ? contentField : undefined;
          const encodingField = (value as { encoding?: unknown }).encoding;
          const encoding = encodingField === 'base64' ? 'base64' : 'utf-8';
          out.push({
            toolCallId: call.toolCallId,
            path,
            contentPreview: encoding === 'base64' ? undefined : content,
            encoding,
          });
        } catch (err) {
          console.warn('canvas: parsePartialJson failed', err);
        }
      }
      if (cancelled) return;
      setLiveFiles((prev) => (equalLiveFiles(prev, out) ? prev : out));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTools]);

  // ── Merge live entries with landed threadFiles ───────────────────────────
  const livePaths = useMemo(
    () => new Set(liveFiles.map((f) => f.path)),
    [liveFiles],
  );
  const mergedFiles = useMemo<ThreadFileItem[]>(() => {
    const live: ThreadFileItem[] = liveFiles.map((lf) => ({
      path: lf.path,
      size: lf.contentPreview ? new Blob([lf.contentPreview]).size : 0,
      contentType: 'text/plain',
      source: 'agent_write' as const,
      updatedAt: Date.now(),
    }));
    const landed = threadFiles.filter((f) => !livePaths.has(f.path));
    return [...live, ...landed];
  }, [liveFiles, threadFiles, livePaths]);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [userDismissed, setUserDismissed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    setUserDismissed(false);
  }, [threadId]);

  // Auto-open trigger: fires on the first file path (landed or live).
  const firstFilePath = mergedFiles[0]?.path;
  useEffect(() => {
    if (firstFilePath && !userDismissed && !isOpen) {
      openWorkspace(firstFilePath);
    }
  }, [firstFilePath, userDismissed, isOpen, openWorkspace]);

  // While a file is streaming, focus the viewer on it so the user sees the
  // live content even if a previously-landed file was active.
  const newestLivePath = liveFiles[0]?.path;
  useEffect(() => {
    if (newestLivePath && activeFilePath !== newestLivePath) {
      setActiveFilePath(newestLivePath);
    }
    // We intentionally only react to newestLivePath changes — switching back
    // to the previously-active file when streaming ends is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestLivePath]);

  const handleClose = useCallback(() => {
    closeWorkspace();
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
    activeFilePath && mergedFiles.some((f) => f.path === activeFilePath)
      ? activeFilePath
      : (mergedFiles[0]?.path ?? null);

  const activeLive = useMemo(
    () => liveFiles.find((f) => f.path === resolvedPath),
    [liveFiles, resolvedPath],
  );

  const isActiveStreaming = !!activeLive;
  const { data: downloadMeta } = useConvexQuery(
    api.thread_files.queries.getThreadFileContentUrl,
    threadId && resolvedPath && !isActiveStreaming
      ? { threadId, organizationId, path: resolvedPath }
      : 'skip',
  );
  const downloadUrl = downloadMeta?.url;
  const [isDownloading, setIsDownloading] = useState(false);
  const handleDownload = useCallback(async () => {
    if (!downloadUrl || !resolvedPath || isDownloading) return;
    try {
      setIsDownloading(true);
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = resolvedPath.split('/').pop() ?? resolvedPath;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Canvas download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  }, [downloadUrl, resolvedPath, isDownloading]);

  if (!threadId || mergedFiles.length === 0) return null;

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
          {t('canvas.title', { defaultValue: 'Canvas' })} · {mergedFiles.length}
        </span>
      </button>
    );
  }

  const activeFile = mergedFiles.find((f) => f.path === resolvedPath);
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
          {isActiveStreaming && (
            <span
              className="bg-primary inline-block size-1.5 shrink-0 animate-pulse rounded-full"
              aria-hidden="true"
            />
          )}
          <span
            className="truncate font-mono text-xs"
            title={resolvedPath ?? ''}
          >
            {filename}
          </span>
          {activeFile && !isActiveStreaming && (
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {Math.max(1, Math.round(activeFile.size / 1024))} KB
            </span>
          )}
          {isActiveStreaming && (
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {t('canvas.writing', { defaultValue: 'Writing…' })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip
            content={t('canvas.download', { defaultValue: 'Download' })}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => void handleDownload()}
              disabled={!downloadUrl || isDownloading || isActiveStreaming}
              aria-label={t('canvas.download', { defaultValue: 'Download' })}
            >
              <Download className="size-3.5" />
            </Button>
          </Tooltip>
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
          files={mergedFiles}
          activePath={resolvedPath}
          onSelect={setActiveFilePath}
          streamingPaths={livePaths}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileViewerRouter
            threadId={threadId}
            organizationId={organizationId}
            path={resolvedPath}
            liveContent={
              activeLive?.contentPreview ?? (activeLive ? '' : undefined)
            }
            liveEncoding={activeLive?.encoding}
          />
        </div>
      </div>
    </div>
  );
}

function equalLiveFiles(a: LiveFile[], b: LiveFile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.toolCallId !== y.toolCallId ||
      x.path !== y.path ||
      x.encoding !== y.encoding ||
      x.contentPreview !== y.contentPreview
    ) {
      return false;
    }
  }
  return true;
}

export const CanvasPane = memo(CanvasPaneComponent);
