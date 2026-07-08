'use client';

import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import {
  memo,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useT } from '@/lib/i18n/client';

import type { ThreadFileItem } from '../types';
import {
  TreeRowButton,
  iconForPath,
  treeNavigationKeyDown,
} from './file-tree-primitives';

/**
 * The canvas file explorer — a directory tree over the thread workspace files,
 * in the same visual language as the external-agent "Workspace files" tree
 * (chevron + folder rows, per-extension file icons, WAI-ARIA tree + shared
 * keyboard navigation). The flat threadFiles list renders as the three real
 * workspace directories, so a file's provenance is its place in the tree:
 *
 *   code/     — scripts the agent authored (`agent_write`)
 *   uploads/  — files the user attached  (`user_upload`)
 *   output/   — files code runs produced (`run_output`)
 *
 * All data is client-side already — no lazy loading; empty directories are
 * omitted. Directories expand by default and collapse per-thread-session
 * (plain component state).
 */

const SOURCE_DIRS = [
  { source: 'agent_write', dir: 'code' },
  { source: 'user_upload', dir: 'uploads' },
  { source: 'run_output', dir: 'output' },
] as const;

/** i18n key + fallback naming each source area — the localized description a
 *  directory row carries for assistive tech alongside its literal dir name. */
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

interface CanvasFileTreeProps {
  files: ThreadFileItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  /** Paths currently being streamed by a `file_write` tool — drives the pulse dot. */
  streamingPaths?: Set<string>;
  /** Meta for the active file (e.g. "Writing…"), rendered inside its row. */
  meta?: ReactNode;
}

function CanvasFileTreeComponent({
  files,
  activePath,
  onSelect,
  streamingPaths,
  meta,
}: CanvasFileTreeProps) {
  const { t } = useT('chat');
  const treeRef = useRef<HTMLUListElement>(null);
  // Dirs the user explicitly collapsed — default is every group expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const groups = useMemo(
    () =>
      SOURCE_DIRS.map((d) => ({
        source: d.source,
        dir: d.dir,
        files: files.filter((f) => f.source === d.source),
      })).filter((g) => g.files.length > 0),
    [files],
  );

  const expanded = useMemo(
    () =>
      new Set(groups.map((g) => g.dir).filter((dir) => !collapsed.has(dir))),
    [groups, collapsed],
  );

  const toggleDir = (dir: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    treeNavigationKeyDown(event, treeRef.current, expanded, toggleDir);
  };

  if (groups.length === 0) return null;

  return (
    <ul
      ref={treeRef}
      role="tree"
      aria-label={t('canvas.title', { defaultValue: 'Canvas' })}
      onKeyDown={handleKeyDown}
      className="m-0 list-none p-0"
    >
      {groups.map((group) => {
        const isOpen = !collapsed.has(group.dir);
        const sourceLabel = t(SOURCE_LABEL[group.source].key, {
          defaultValue: SOURCE_LABEL[group.source].defaultValue,
        });
        return (
          <li role="none" key={group.dir}>
            <TreeRowButton
              isActive={false}
              depth={0}
              onClick={() => toggleDir(group.dir)}
              title={`/user/${group.dir}`}
              ariaLabel={`${group.dir}/ — ${sourceLabel}`}
              ariaExpanded={isOpen}
              dataDirPath={group.dir}
              dataParentPath={null}
            >
              {isOpen ? (
                <ChevronDown
                  className="text-muted-foreground size-3 shrink-0"
                  aria-hidden
                />
              ) : (
                <ChevronRight
                  className="text-muted-foreground size-3 shrink-0"
                  aria-hidden
                />
              )}
              {isOpen ? (
                <FolderOpen className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <Folder className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="truncate font-mono">{group.dir}/</span>
              {!isOpen && (
                <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                  {group.files.length}
                </span>
              )}
            </TreeRowButton>
            {isOpen ? (
              <ul
                role="group"
                aria-label={`${group.dir}/`}
                className="m-0 list-none p-0"
              >
                {group.files.map((f) => {
                  const isActive = f.path === activePath;
                  const isStreaming = streamingPaths?.has(f.path) ?? false;
                  const name = filename(f.path);
                  const Icon = iconForPath(name);
                  return (
                    <li role="none" key={f.path}>
                      <TreeRowButton
                        isActive={isActive}
                        depth={1}
                        onClick={() => onSelect(f.path)}
                        title={f.path}
                        ariaLabel={`${name} — ${sourceLabel}`}
                        dataParentPath={group.dir}
                      >
                        {isStreaming ? (
                          <span
                            className="bg-primary inline-block size-1.5 shrink-0 animate-pulse rounded-full"
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="size-1.5 shrink-0" aria-hidden />
                        )}
                        <Icon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate font-mono">{name}</span>
                        {isActive && meta && (
                          <span className="text-muted-foreground ml-auto shrink-0 text-[10px] font-normal">
                            {meta}
                          </span>
                        )}
                      </TreeRowButton>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export const CanvasFileTree = memo(CanvasFileTreeComponent);
