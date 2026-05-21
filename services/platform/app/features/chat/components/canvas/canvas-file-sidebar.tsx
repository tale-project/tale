'use client';

import { Button } from '@tale/ui/button';
import { ChevronLeft, ChevronRight, FileCode, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface ArtifactFile {
  path: string;
  content: string;
}

interface CanvasFileSidebarProps {
  files: readonly ArtifactFile[];
  entryFile: string;
  /**
   * Path of the file the LLM is currently streaming into (advisory). When
   * the streamed file is not yet in `files[]` (mid-create), we still render
   * it in the tree as a "ghost" entry so the user sees the placeholder
   * before the row settles.
   */
  streamingPath?: string;
  activePath: string;
  onSelect: (path: string) => void;
}

const COLLAPSED_STORAGE_KEY = 'canvas-sidebar-collapsed';

function iconForPath(path: string) {
  if (
    path.endsWith('.md') ||
    path.endsWith('.txt') ||
    path.endsWith('.json') ||
    path.endsWith('.yaml') ||
    path.endsWith('.yml')
  ) {
    return FileText;
  }
  return FileCode;
}

export function CanvasFileSidebar({
  files,
  entryFile,
  streamingPath,
  activePath,
  onSelect,
}: CanvasFileSidebarProps) {
  const { t } = useT('chat');

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage may be disabled (Safari private). Ignore.
    }
  }, [collapsed]);

  // Synthesize a ghost entry for a `streamingPath` that hasn't landed in
  // `files[]` yet — the canvas should show *something* under the cursor
  // while the create stream is mid-flight.
  const ghostStreaming =
    streamingPath !== undefined && !files.some((f) => f.path === streamingPath);
  const tree: { path: string; ghost: boolean }[] = [
    ...files.map((f) => ({ path: f.path, ghost: false })),
    ...(ghostStreaming ? [{ path: streamingPath, ghost: true }] : []),
  ];

  if (collapsed) {
    return (
      <div className="border-border bg-muted/10 flex w-8 shrink-0 flex-col items-center border-r py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setCollapsed(false)}
          aria-label={t('canvas.fileSidebar.expand')}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="border-border bg-muted/10 flex w-44 shrink-0 flex-col border-r"
      role="navigation"
      aria-label={t('canvas.fileSidebar.label')}
    >
      <div className="border-border flex items-center justify-between border-b px-2 py-1.5">
        <span className="text-muted-foreground text-xs font-medium uppercase">
          {t('canvas.fileSidebar.title')}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => setCollapsed(true)}
          aria-label={t('canvas.fileSidebar.collapse')}
        >
          <ChevronLeft className="size-3.5" aria-hidden />
        </Button>
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-auto p-1">
        {tree.map(({ path, ghost }) => {
          const Icon = iconForPath(path);
          const isActive = path === activePath;
          const isEntry = path === entryFile;
          const isStreaming = path === streamingPath;
          return (
            <li key={path}>
              <button
                type="button"
                onClick={() => onSelect(path)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'group flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  ghost && 'italic opacity-70',
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="flex-1 truncate font-mono">{path}</span>
                {isStreaming && (
                  <span
                    className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500"
                    aria-label={t('canvas.fileSidebar.streamingDot')}
                  />
                )}
                {isEntry && !isStreaming && (
                  <span className="text-muted-foreground/60 shrink-0 text-[10px]">
                    {t('canvas.fileSidebar.entryBadge')}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
