'use client';

import { Button } from '@tale/ui/button';
import {
  ChevronLeft,
  ChevronRight,
  FileCode,
  FilePlus,
  FileText,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
  /**
   * Create a new file at `path` (empty content). When omitted, the "+"
   * affordance is hidden — read-only mode (e.g. revision viewer).
   * Implementations should resolve once the row has persisted; the sidebar
   * auto-selects the new path after.
   */
  onAddFile?: (path: string) => Promise<void>;
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
  onAddFile,
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

  // Add-file inline form state. Open mode swaps the file-count chip header
  // for an <input>; submitting calls `onAddFile`, then auto-selects the
  // new path. Submit is gated against duplicate / empty paths so the
  // mutation only fires for actionable input.
  const [adding, setAdding] = useState(false);
  const [draftPath, setDraftPath] = useState('');
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [adding_inflight, setAddingInflight] = useState(false);
  const draftInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage may be disabled (Safari private). Ignore.
    }
  }, [collapsed]);

  useEffect(() => {
    if (adding) draftInputRef.current?.focus();
  }, [adding]);

  const handleAddSubmit = async () => {
    if (!onAddFile) return;
    const trimmed = draftPath.trim();
    if (trimmed === '') {
      setAddError(t('canvas.fileSidebar.errorPathRequired'));
      return;
    }
    if (files.some((f) => f.path === trimmed)) {
      setAddError(t('canvas.fileSidebar.errorPathExists'));
      return;
    }
    setAddError(undefined);
    setAddingInflight(true);
    try {
      await onAddFile(trimmed);
      onSelect(trimmed);
      setAdding(false);
      setDraftPath('');
    } catch (err) {
      console.error('[canvas-file-sidebar] add file failed', err);
      setAddError(
        err instanceof Error
          ? err.message
          : t('canvas.fileSidebar.errorAddFailed'),
      );
    } finally {
      setAddingInflight(false);
    }
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraftPath('');
    setAddError(undefined);
  };

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
        <div className="flex items-center gap-0.5">
          {onAddFile && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setAdding(true)}
              disabled={adding}
              aria-label={t('canvas.fileSidebar.addFile')}
            >
              <FilePlus className="size-3.5" aria-hidden />
            </Button>
          )}
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
      </div>
      {adding && (
        <div className="border-border flex flex-col gap-1 border-b px-2 py-1.5">
          <input
            ref={draftInputRef}
            type="text"
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAddSubmit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelAdd();
              }
            }}
            placeholder={t('canvas.fileSidebar.addFilePlaceholder')}
            aria-label={t('canvas.fileSidebar.addFile')}
            disabled={adding_inflight}
            className="bg-background border-border focus:border-ring rounded border px-1.5 py-1 font-mono text-xs outline-none"
          />
          {addError !== undefined && (
            <span className="text-destructive text-[10px]">{addError}</span>
          )}
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={cancelAdd}
              disabled={adding_inflight}
            >
              {t('canvas.fileSidebar.addFileCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => void handleAddSubmit()}
              disabled={adding_inflight || draftPath.trim() === ''}
            >
              {t('canvas.fileSidebar.addFileConfirm')}
            </Button>
          </div>
        </div>
      )}
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
