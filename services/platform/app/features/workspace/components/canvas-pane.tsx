'use client';

import { useMatch } from '@tanstack/react-router';
import { parsePartialJson } from 'ai';
import { Palette } from 'lucide-react';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { ChatPaneDescriptor } from '@/app/features/chat/components/chat-panel/types';
import {
  useAutoOpen,
  useRegisterPane,
} from '@/app/features/chat/components/chat-panel/use-register-pane';
import { useBranchContext } from '@/app/features/chat/context/branch-context';
import { useStreamingTools } from '@/app/features/chat/context/streaming-tool-context';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { preloadHighlighter } from '@/lib/utils/shiki';

import { CanvasPreferencesProvider } from '../hooks/canvas-preferences';
import type { ThreadFileItem } from '../types';
import { FileViewerRouter } from './file-viewer-router';
import { useWorkspace } from './workspace-context';
import { WorkspaceFileTabs, WorkspaceOutputDock } from './workspace-file-tabs';

/** id of the file viewer container — the tab strip + output dock point their
 *  `aria-controls` at it. */
const CANVAS_VIEWER_ID = 'canvas-file-viewer';

interface CanvasPaneProps {
  organizationId: string;
}

interface LiveFile {
  toolCallId: string;
  path: string;
  contentPreview?: string;
  encoding: 'utf-8' | 'base64';
}

/**
 * Canvas (workspace files) pane. A registrar: it owns the file list + the
 * streaming `file_write` merge and publishes a descriptor to the unified right
 * panel. The active-file path still persists per-thread via `WorkspaceProvider`
 * (`setActiveFilePath`); open/close of the pane is now governed by the shell's
 * active tab, so this no longer calls `openWorkspace`/`closeWorkspace`.
 */
function CanvasPaneComponent({ organizationId }: CanvasPaneProps) {
  const { t } = useT('chat');

  // Warm shiki as soon as the canvas is in play so the first code file the user
  // opens highlights without the lazy cold-start delay (engine + grammars).
  useEffect(() => {
    preloadHighlighter();
  }, []);
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

  const { activeFilePath, setActiveFilePath } = useWorkspace();

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

  const hasContent = !!threadId && mergedFiles.length > 0;
  useAutoOpen('canvas', hasContent);

  const descriptor = useMemo<ChatPaneDescriptor | null>(() => {
    if (!hasContent || !threadId) return null;

    // Active-file meta, pinned to the right of the tab strip. Only the
    // streaming indicator rides here now — the file size was dropped.
    const activeMeta: ReactNode = isActiveStreaming
      ? t('canvas.writing', { defaultValue: 'Writing…' })
      : null;

    const body: ReactNode = (
      <CanvasPreferencesProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkspaceFileTabs
            files={mergedFiles}
            activePath={resolvedPath}
            onSelect={setActiveFilePath}
            streamingPaths={livePaths}
            viewerId={CANVAS_VIEWER_ID}
            meta={activeMeta}
          />
          <div id={CANVAS_VIEWER_ID} className="min-h-0 flex-1 overflow-hidden">
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
          <WorkspaceOutputDock
            files={mergedFiles}
            activePath={resolvedPath}
            onSelect={setActiveFilePath}
            viewerId={CANVAS_VIEWER_ID}
          />
        </div>
      </CanvasPreferencesProvider>
    );

    return {
      id: 'canvas',
      icon: Palette,
      label: t('canvas.title', { defaultValue: 'Canvas' }),
      ariaLabel: t('canvas.stripOpen', { defaultValue: 'Open canvas' }),
      hasContent: true,
      body,
    };
  }, [
    hasContent,
    threadId,
    organizationId,
    t,
    resolvedPath,
    isActiveStreaming,
    mergedFiles,
    livePaths,
    activeLive,
    setActiveFilePath,
  ]);

  useRegisterPane(descriptor);

  return null;
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
