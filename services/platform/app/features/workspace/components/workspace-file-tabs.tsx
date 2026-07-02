'use client';

import { Text } from '@tale/ui/text';
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Terminal,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useResizeObserver } from '@/app/hooks/use-resize-observer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ThreadFileItem } from '../types';

interface WorkspaceFileTabsProps {
  files: ThreadFileItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  /** Paths currently being streamed by a `file_write` tool — drives the pulse dot. */
  streamingPaths?: Set<string>;
  /** id of the viewer panel these tabs control, for `aria-controls`. */
  viewerId?: string;
  /** Meta for the active file (size / "Writing…"), pinned to the right edge of
   *  the tab row — replaces the old standalone file sub-header. */
  meta?: ReactNode;
}

/** Differential per-source icon — the only *visual* group cue now that the
 *  labelled accordions are gone (AI-written vs user-uploaded). `run_output`
 *  never appears in this strip (it docks at the bottom), but the map is total
 *  so the lookup needs no narrowing cast. */
const TAB_ICON: Record<ThreadFileItem['source'], LucideIcon> = {
  agent_write: Sparkles,
  user_upload: Upload,
  run_output: Terminal,
};

/** i18n key + fallback for each source — folded into the tab's `aria-label` so
 *  the icon-only group cue is still announced to assistive tech. */
const SOURCE_LABEL: Record<
  ThreadFileItem['source'],
  { key: string; defaultValue: string }
> = {
  agent_write: { key: 'canvas.sourceAgentWrite', defaultValue: 'AI files' },
  user_upload: { key: 'canvas.sourceUserUpload', defaultValue: 'Uploaded' },
  run_output: { key: 'canvas.sourceRunOutput', defaultValue: 'Code output' },
};

function filename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * The canvas file picker, editor-style: a single horizontal tab strip for the
 * AI-written (`agent_write`) + user-uploaded (`user_upload`) files. Each tab
 * carries a differential source icon so the grouping survives without the old
 * collapsible accordions. Overflowing tabs scroll horizontally (no wrap), and
 * the active tab is scrolled into view.
 *
 * Code-run output (`run_output`) is NOT shown here — it docks at the bottom via
 * {@link WorkspaceOutputDock}, the way an editor docks its output panel.
 *
 * A hand-rolled WAI-ARIA tablist (not the `@tale/ui/tabs` Radix primitive)
 * because the single file viewer it controls is owned by the canvas, not by
 * Radix — mirrors the chat-panel tab bar.
 */
function WorkspaceFileTabsComponent({
  files,
  activePath,
  onSelect,
  streamingPaths,
  viewerId,
  meta,
}: WorkspaceFileTabsProps) {
  const { t } = useT('chat');
  const listRef = useRef<HTMLDivElement>(null);

  // Tab files: AI-written first, then uploaded — preserve that order.
  const tabFiles = useMemo(() => {
    const agent = files.filter((f) => f.source === 'agent_write');
    const uploads = files.filter((f) => f.source === 'user_upload');
    return [...agent, ...uploads];
  }, [files]);

  // Scroll the active tab into view when it changes (e.g. a freshly-streamed
  // file becomes active off-screen).
  useEffect(() => {
    if (!activePath) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-path="${CSS.escape(activePath)}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = tabFiles.findIndex((f) => f.path === activePath);
    if (idx === -1) {
      onSelect(tabFiles[0]?.path ?? activePath ?? '');
      return;
    }
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + delta + tabFiles.length) % tabFiles.length;
    onSelect(tabFiles[nextIdx].path);
  };

  if (tabFiles.length === 0) return null;

  // Roving-tabindex needs exactly one focusable tab. When `activePath` is null
  // or doesn't match a current file, fall back to the first tab so the tablist
  // stays keyboard-reachable instead of every tab getting tabIndex={-1}.
  const effectiveActivePath = tabFiles.some((f) => f.path === activePath)
    ? activePath
    : tabFiles[0].path;

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={t('canvas.title', { defaultValue: 'Canvas' })}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="border-border scrollbar-hide flex shrink-0 items-center gap-4 overflow-x-auto border-b px-3"
    >
      {tabFiles.map((f) => {
        const isActive = f.path === effectiveActivePath;
        const isStreaming = streamingPaths?.has(f.path) ?? false;
        const Icon = TAB_ICON[f.source];
        const name = filename(f.path);
        const sourceLabel = t(SOURCE_LABEL[f.source].key, {
          defaultValue: SOURCE_LABEL[f.source].defaultValue,
        });
        return (
          <button
            key={f.path}
            type="button"
            role="tab"
            data-path={f.path}
            aria-selected={isActive}
            aria-controls={viewerId}
            aria-label={`${name} — ${sourceLabel}`}
            title={f.path}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(f.path)}
            className={cn(
              'focus-visible:ring-ring relative flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2 pt-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
              isActive
                ? 'border-primary text-foreground'
                : 'text-muted-foreground border-transparent hover:text-foreground',
            )}
          >
            {isStreaming && (
              <span
                className="bg-primary inline-block size-1.5 shrink-0 animate-pulse rounded-full"
                aria-hidden="true"
              />
            )}
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="max-w-[12rem] truncate font-mono">{name}</span>
            {/* Active-file meta (size / "Writing…") rides inside its own tab. */}
            {isActive && meta && (
              <span className="text-muted-foreground ml-1 shrink-0 text-[10px] font-normal">
                {meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const WorkspaceFileTabs = memo(WorkspaceFileTabsComponent);

interface WorkspaceOutputDockProps {
  files: ThreadFileItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  /** id of the viewer panel these chips control, for `aria-controls`. */
  viewerId?: string;
}

/**
 * The bottom "Code output" dock — a thin horizontal strip of the code-run
 * output files (`run_output`), docked under the viewer like an editor's output
 * panel. Selecting a chip opens that file in the same shared viewer above.
 * Renders nothing when there are no output files.
 */
function WorkspaceOutputDockComponent({
  files,
  activePath,
  onSelect,
  viewerId,
}: WorkspaceOutputDockProps) {
  const { t } = useT('chat');
  const outputFiles = useMemo(
    () => files.filter((f) => f.source === 'run_output'),
    [files],
  );

  // Expandable overflow: collapsed = today's single scroll row; expanded =
  // wrapped rows (bounded, so a huge run can't swallow the viewer). The
  // toggle renders only when chips genuinely overflow the row — measured, not
  // guessed — so the affordance never shows for a strip that already fits.
  const rowRef = useRef<HTMLDivElement>(null);
  const rowId = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const measureOverflow = useCallback(() => {
    const el = rowRef.current;
    if (el === null) return;
    setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, []);
  // A ResizeObserver fires only when the row's own box resizes — new chips
  // grow scrollWidth without a box resize, so re-measure on file changes too.
  useEffect(() => {
    measureOverflow();
  }, [measureOverflow, outputFiles]);
  useResizeObserver(rowRef, measureOverflow);

  if (outputFiles.length === 0) return null;

  const label = t('canvas.sourceRunOutput', { defaultValue: 'Code output' });
  const toggleLabel = expanded
    ? t('canvas.outputCollapse', { defaultValue: 'Show fewer files' })
    : t('canvas.outputExpand', { defaultValue: 'Show all files' });
  const ToggleIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <div
      role="group"
      aria-label={label}
      className="border-border flex shrink-0 items-start gap-2 border-t px-3 py-1.5"
    >
      <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 py-0.5 text-[11px] font-medium">
        <Terminal className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
      <div
        id={rowId}
        ref={rowRef}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2',
          expanded
            ? 'max-h-24 flex-wrap overflow-y-auto'
            : 'scrollbar-hide overflow-x-auto',
        )}
      >
        {outputFiles.map((f) => {
          const isActive = f.path === activePath;
          const name = filename(f.path);
          return (
            <button
              key={f.path}
              type="button"
              aria-controls={viewerId}
              aria-label={name}
              aria-current={isActive ? 'true' : undefined}
              title={f.path}
              onClick={() => onSelect(f.path)}
              className={cn(
                'focus-visible:ring-ring shrink-0 rounded px-2 py-0.5 font-mono text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
      {(overflowing || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={rowId}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ToggleIcon className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export const WorkspaceOutputDock = memo(WorkspaceOutputDockComponent);

/** Shared empty state, shown by the canvas when no files exist at all. */
export function WorkspaceFilesEmpty(): ReactNode {
  const { t } = useT('chat');
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center">
      <Text variant="muted" className="text-sm">
        {t('canvas.noFilesYet', { defaultValue: 'No files yet' })}
      </Text>
    </div>
  );
}
