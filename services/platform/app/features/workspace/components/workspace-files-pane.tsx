'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useMatch } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  MoonStar,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import {
  getFileExtensionLower,
  isTextBasedFile,
} from '@/lib/utils/text-file-types';

import { CodeViewer } from '../viewers/code-viewer';
import { ImageViewer } from '../viewers/image-viewer';
import { RenderableFileViewer } from '../viewers/renderable-file-viewer';
import { useWorkspaceFiles } from './workspace-files-context';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
// Wider default than a single-column pane: the body is a two-column tree+viewer
// split on desktop, so give both columns room.
const DEFAULT_WIDTH = 560;
const STRIP_WIDTH = 48;

/** The agent's working area — the explorer root (matches the backend). Rooted
 * at `/user/workspace`, not the `/user` data root, so the panel shows only the
 * workspace tree — not the sibling `uploads/`/`output/` dirs. */
const WORKSPACE_ROOT = '/user/workspace';

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'svg',
]);

/** Text files that read far better rendered than as raw source — previewed via
 *  the RenderableFileViewer (which still offers a Source toggle). */
const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown']);

function iconForPath(name: string): typeof File {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return FileText;
  if (lower.endsWith('.json') || lower.endsWith('.jsonc')) return FileJson;
  if (
    lower.endsWith('.py') ||
    lower.endsWith('.js') ||
    lower.endsWith('.cjs') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.bash') ||
    lower.endsWith('.zsh') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.toml')
  ) {
    return FileCode;
  }
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.avif')
  ) {
    return FileImage;
  }
  if (
    lower.endsWith('.csv') ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.tsv')
  ) {
    return FileSpreadsheet;
  }
  if (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.7z') ||
    lower.endsWith('.rar')
  ) {
    return FileArchive;
  }
  return File;
}

/** Join a directory path with a child name into an absolute path. */
function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

type FsEntryType = 'file' | 'dir' | 'other';

interface FsEntry {
  name: string;
  type: FsEntryType;
  size: number;
  mtimeMs: number;
}

/** Lazily-loaded children cache for one directory. */
interface DirNode {
  status: 'loading' | 'loaded' | 'error';
  entries: FsEntry[];
  truncated: boolean;
  error?: string;
}

interface WorkspaceFileTreeProps {
  threadId: string;
  showHidden: boolean;
  /** Bump to force a re-fetch of every currently-expanded directory. */
  refreshNonce: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** Reports whether the live session is running (drives the empty states). */
  onSessionRunningChange: (running: boolean) => void;
}

/**
 * Lazy, read-only file tree over the live external-agent session workspace.
 * Reuses the visual language of the skill bundle tree (icons via `iconForPath`,
 * depth indentation, chevron expand/collapse, WAI-ARIA tree roles + keyboard
 * nav) but loads each directory's children on first expand via
 * `listWorkspaceDir`, caching results in a `path → DirNode` map. The root
 * (`/user`) auto-expands once on mount.
 */
function WorkspaceFileTree({
  threadId,
  showHidden,
  refreshNonce,
  selectedPath,
  onSelectFile,
  onSessionRunningChange,
}: WorkspaceFileTreeProps) {
  const { t } = useT('chat');
  const listDir = useAction(
    api.node_only.sandbox.workspace_files.listWorkspaceDir,
  );
  const treeRef = useRef<HTMLUListElement>(null);

  // path → loaded children. Absent = not yet fetched.
  const [nodes, setNodes] = useState(() => new Map<string, DirNode>());
  const [expanded, setExpanded] = useState(() => new Set<string>());

  // Latest action ref so a re-render mid-fetch doesn't strand the closure.
  const listDirRef = useRef(listDir);
  listDirRef.current = listDir;
  const onSessionRunningRef = useRef(onSessionRunningChange);
  onSessionRunningRef.current = onSessionRunningChange;
  // Mirror of `expanded` so the refresh effect can read the current expansion
  // set without depending on it (a dep would re-fetch the whole tree on every
  // expand/collapse).
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  // Mirror of `nodes` so `toggleDir` can decide whether a directory still needs
  // loading without nesting one setState inside another.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const loadDir = useCallback(
    async (dirPath: string) => {
      setNodes((prev) => {
        const next = new Map(prev);
        const existing = next.get(dirPath);
        next.set(dirPath, {
          status: 'loading',
          entries: existing?.entries ?? [],
          truncated: existing?.truncated ?? false,
        });
        return next;
      });
      try {
        const result = await listDirRef.current({
          threadId,
          path: dirPath,
          showHidden,
        });
        onSessionRunningRef.current(result.sessionRunning);
        setNodes((prev) => {
          const next = new Map(prev);
          next.set(dirPath, {
            status: 'loaded',
            entries: result.entries,
            truncated: result.truncated,
          });
          return next;
        });
      } catch (err) {
        console.error('[workspace-files] listWorkspaceDir failed', err);
        setNodes((prev) => {
          const next = new Map(prev);
          next.set(dirPath, {
            status: 'error',
            entries: [],
            truncated: false,
            error: err instanceof Error ? err.message : String(err),
          });
          return next;
        });
      }
    },
    [threadId, showHidden],
  );

  // Auto-expand + load the root once per (thread, showHidden, refresh) change.
  // Changing `showHidden` or bumping `refreshNonce` re-fetches every currently
  // expanded directory so the listing reflects the new filter / latest state.
  useEffect(() => {
    // Ensure the root is expanded (no-op after the first run).
    setExpanded((prev) => {
      if (prev.has(WORKSPACE_ROOT)) return prev;
      const next = new Set(prev);
      next.add(WORKSPACE_ROOT);
      return next;
    });
    // Refresh the root + every directory currently expanded so the listing
    // reflects the new filter / latest workspace state.
    const toRefresh = new Set<string>([WORKSPACE_ROOT, ...expandedRef.current]);
    for (const dir of toRefresh) void loadDir(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, showHidden, refreshNonce]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      const willExpand = !expandedRef.current.has(dirPath);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) next.delete(dirPath);
        else next.add(dirPath);
        return next;
      });
      if (willExpand) {
        // Load children on first expand (or if a prior load errored).
        const node = nodesRef.current.get(dirPath);
        if (!node || node.status === 'error') void loadDir(dirPath);
      }
    },
    [loadDir],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const { key } = event;
    if (
      ![
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
      ].includes(key)
    ) {
      return;
    }
    const items =
      treeRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]');
    if (!items || items.length === 0) return;
    event.preventDefault();

    const current = document.activeElement;
    let idx = -1;
    items.forEach((el, i) => {
      if (el === current) idx = i;
    });

    if (key === 'ArrowDown') {
      const next = idx === -1 ? 0 : Math.min(idx + 1, items.length - 1);
      items[next]?.focus();
      return;
    }
    if (key === 'ArrowUp') {
      const next = idx === -1 ? items.length - 1 : Math.max(idx - 1, 0);
      items[next]?.focus();
      return;
    }
    if (key === 'Home') {
      items[0]?.focus();
      return;
    }
    if (key === 'End') {
      items[items.length - 1]?.focus();
      return;
    }
    if (idx === -1) return;
    const el = items[idx];
    const dirPath = el.dataset.dirPath;
    const parentPath = el.dataset.parentPath;
    if (key === 'ArrowRight' && dirPath !== undefined) {
      if (!expanded.has(dirPath)) {
        toggleDir(dirPath);
      } else {
        items[Math.min(idx + 1, items.length - 1)]?.focus();
      }
      return;
    }
    if (key === 'ArrowLeft') {
      if (dirPath !== undefined && expanded.has(dirPath)) {
        toggleDir(dirPath);
        return;
      }
      if (parentPath) {
        const parent = treeRef.current?.querySelector<HTMLButtonElement>(
          `[data-dir-path="${CSS.escape(parentPath)}"]`,
        );
        parent?.focus();
      }
    }
  };

  const ariaLabel = t('workspaceFiles.ariaTree', {
    defaultValue: 'Workspace files',
  });

  const root = nodes.get(WORKSPACE_ROOT);

  return (
    <ul
      ref={treeRef}
      role="tree"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="m-0 list-none p-0"
    >
      <DirChildren
        dirPath={WORKSPACE_ROOT}
        depth={0}
        parentPath={null}
        node={root}
        nodes={nodes}
        expanded={expanded}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
        onToggleDir={toggleDir}
        onRetry={loadDir}
        isRoot
      />
    </ul>
  );
}

interface DirChildrenProps {
  dirPath: string;
  depth: number;
  parentPath: string | null;
  node: DirNode | undefined;
  nodes: Map<string, DirNode>;
  expanded: Set<string>;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  onRetry: (path: string) => void;
  isRoot?: boolean;
}

/** Renders the children of one directory (the loaded entries of `node`). */
function DirChildren({
  dirPath,
  depth,
  parentPath,
  node,
  nodes,
  expanded,
  selectedPath,
  onSelectFile,
  onToggleDir,
  onRetry,
  isRoot,
}: DirChildrenProps) {
  const { t } = useT('chat');

  if (!node || node.status === 'loading') {
    return (
      <li role="none" className="px-2 py-1.5">
        <span className="inline-flex items-center gap-2">
          <Spinner
            size="sm"
            label={t('workspaceFiles.error', { defaultValue: 'Loading' })}
          />
        </span>
      </li>
    );
  }

  if (node.status === 'error') {
    return (
      <li role="none" className="px-2 py-1.5">
        <Stack gap={1}>
          <Text variant="caption" className="text-destructive">
            {t('workspaceFiles.error', {
              defaultValue: 'Could not load this folder.',
            })}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={() => onRetry(dirPath)}
          >
            {t('workspaceFiles.retry', { defaultValue: 'Retry' })}
          </Button>
        </Stack>
      </li>
    );
  }

  if (node.entries.length === 0) {
    return (
      <li role="none" className="px-2 py-1.5">
        <Text variant="muted" className="text-xs">
          {t('workspaceFiles.emptyDir', { defaultValue: 'Empty folder' })}
        </Text>
      </li>
    );
  }

  return (
    <>
      {node.entries.map((entry) => {
        const fullPath = joinPath(dirPath, entry.name);
        if (entry.type === 'dir') {
          const isOpen = expanded.has(fullPath);
          return (
            <li role="none" key={fullPath}>
              <TreeRowButton
                isActive={false}
                depth={depth}
                onClick={() => onToggleDir(fullPath)}
                title={fullPath}
                ariaLabel={`${entry.name}/`}
                ariaExpanded={isOpen}
                dataDirPath={fullPath}
                dataParentPath={isRoot ? null : (parentPath ?? dirPath)}
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
                <span className="truncate font-mono">{entry.name}</span>
              </TreeRowButton>
              {isOpen ? (
                <ul
                  role="group"
                  aria-label={`${entry.name}/`}
                  className="m-0 list-none p-0"
                >
                  <DirChildren
                    dirPath={fullPath}
                    depth={depth + 1}
                    parentPath={dirPath}
                    node={nodes.get(fullPath)}
                    nodes={nodes}
                    expanded={expanded}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    onToggleDir={onToggleDir}
                    onRetry={onRetry}
                  />
                </ul>
              ) : null}
            </li>
          );
        }
        const Icon = iconForPath(entry.name);
        const isActive = selectedPath === fullPath;
        return (
          <li role="none" key={fullPath}>
            <TreeRowButton
              isActive={isActive}
              depth={depth}
              onClick={() => onSelectFile(fullPath)}
              title={fullPath}
              ariaLabel={fullPath}
              dataParentPath={isRoot ? null : dirPath}
            >
              <span className="size-3 shrink-0" aria-hidden />
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="truncate font-mono">{entry.name}</span>
            </TreeRowButton>
          </li>
        );
      })}
      {node.truncated && (
        <li
          role="none"
          className="px-2 py-1"
          style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        >
          <Text variant="muted" className="text-[10px]">
            {t('workspaceFiles.truncated', {
              defaultValue: '… more items hidden (list truncated)',
            })}
          </Text>
        </li>
      )}
    </>
  );
}

interface TreeRowButtonProps {
  isActive: boolean;
  depth: number;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  ariaExpanded?: boolean;
  dataDirPath?: string;
  dataParentPath?: string | null;
  children: React.ReactNode;
}

function TreeRowButton({
  isActive,
  depth,
  onClick,
  title,
  ariaLabel,
  ariaExpanded,
  dataDirPath,
  dataParentPath,
  children,
}: TreeRowButtonProps) {
  const state = isActive
    ? 'bg-muted text-foreground'
    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground';
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={isActive}
      aria-level={depth + 1}
      tabIndex={isActive ? 0 : -1}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      data-dir-path={dataDirPath}
      data-parent-path={dataParentPath ?? undefined}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs',
        state,
        'focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none',
      )}
    >
      {children}
    </button>
  );
}

type ViewerState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'text'; content: string }
  | { kind: 'image'; objectUrl: string }
  | { kind: 'download'; reason?: 'too_large' }
  | { kind: 'session_stopped' }
  | { kind: 'error' };

interface WorkspaceFileViewerProps {
  threadId: string;
  path: string;
}

/**
 * A selected workspace file: a persistent header toolbar (filename + an
 * always-available Download + a Preview action for previewable types) over a
 * content area. Preview is an EXPLICIT action — clicking it fetches the file
 * from the same-origin httpAction and renders it (text → CodeViewer, image →
 * object URL via ImageViewer; binary / 404 missing-or-too-large → a notice).
 * Download is a direct link that works for ANY file regardless of size/type.
 * The object URL is revoked on reload / path change / unmount.
 */
function WorkspaceFileViewer({ threadId, path }: WorkspaceFileViewerProps) {
  const { t } = useT('chat');
  const [state, setState] = useState<ViewerState>({ kind: 'idle' });
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fileUrl = useMemo(() => {
    const params = new URLSearchParams({ threadId, path });
    return `/api/sandbox/workspace_file?${params.toString()}`;
  }, [threadId, path]);

  const downloadUrl = useMemo(() => {
    const params = new URLSearchParams({ threadId, path, download: '1' });
    return `/api/sandbox/workspace_file?${params.toString()}`;
  }, [threadId, path]);

  const ext = getFileExtensionLower(path);
  const isImage = IMAGE_EXTS.has(ext);
  // Whether to OFFER preview (by extension/name) — the fetch still has the final
  // say (a too-large/binary file falls back to the download notice).
  const previewable = isImage || isTextBasedFile(path);
  const filename = path.split('/').pop() ?? path;

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // Reset to the idle (toolbar-only) state on file change — never auto-fetch;
  // preview is explicit. Abort an in-flight load + revoke a prior object URL.
  useEffect(() => {
    setState({ kind: 'idle' });
    return () => {
      abortRef.current?.abort();
      revokeObjectUrl();
    };
  }, [path, revokeObjectUrl]);

  const loadPreview = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    revokeObjectUrl();
    setState({ kind: 'loading' });
    try {
      const res = await fetch(fileUrl, {
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (res.status === 409) {
        setState({ kind: 'session_stopped' });
        return;
      }
      if (res.status === 404) {
        // Missing OR over the 20 MB preview cap — can't preview, offer download.
        setState({ kind: 'download', reason: 'too_large' });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'error' });
        return;
      }
      const contentType = res.headers.get('Content-Type') ?? '';
      if (isImage || contentType.startsWith('image/')) {
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setState({ kind: 'image', objectUrl: url });
        return;
      }
      const isText =
        contentType.startsWith('text/') ||
        contentType.includes('json') ||
        contentType.includes('xml') ||
        contentType.includes('javascript') ||
        contentType.includes('yaml') ||
        contentType === '' ||
        contentType === 'application/octet-stream';
      if (isText) {
        const text = await res.text();
        if (controller.signal.aborted) return;
        setState({ kind: 'text', content: text });
        return;
      }
      // Known non-text binary (PDF, archive, …) — download only.
      setState({ kind: 'download' });
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[workspace-files] file fetch failed', err);
      setState({ kind: 'error' });
    }
  }, [fileUrl, isImage, revokeObjectUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: filename + actions. Download is ALWAYS available (any file,
          any size/type); Preview is offered only for previewable types. */}
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <Text variant="caption" className="truncate font-mono" title={path}>
          {filename}
        </Text>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Preview is the idle CTA; once a file is shown, the content area
              (and, for markdown/html, its own Source/Preview toggle) takes
              over, so the toolbar button hides to avoid a duplicate control. */}
          {previewable &&
            (state.kind === 'idle' ||
              state.kind === 'loading' ||
              state.kind === 'error') && (
              <Button
                variant="ghost"
                size="sm"
                icon={Eye}
                className="h-7"
                onClick={() => void loadPreview()}
                disabled={state.kind === 'loading'}
              >
                {t('workspaceFiles.preview', { defaultValue: 'Preview' })}
              </Button>
            )}
          {/* Always available — any file, any size/type. The icon lives inside
              the <a> (not Button's `icon` prop) because `asChild` + `icon`
              makes Button forward className onto a Fragment (React warning). */}
          <Button asChild variant="secondary" size="sm" className="h-7">
            <a href={downloadUrl} download={filename}>
              <Download className="mr-2 size-4" aria-hidden="true" />
              {t('workspaceFiles.download', { defaultValue: 'Download' })}
            </a>
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceFileViewerContent
          state={state}
          path={path}
          filename={filename}
          previewable={previewable}
        />
      </div>
    </div>
  );
}

/** Renders the viewer's content area for the current {@link ViewerState}. The
 *  surrounding toolbar (download/preview) lives in {@link WorkspaceFileViewer}. */
function WorkspaceFileViewerContent({
  state,
  path,
  filename,
  previewable,
}: {
  state: ViewerState;
  path: string;
  filename: string;
  previewable: boolean;
}) {
  const { t } = useT('chat');

  if (state.kind === 'idle') {
    return (
      <Stack
        gap={2}
        className="h-full items-center justify-center p-8 text-center"
      >
        <Text variant="muted" className="text-sm">
          {previewable
            ? t('workspaceFiles.previewHint', {
                defaultValue: 'Select Preview to view this file.',
              })
            : t('workspaceFiles.previewUnavailable', {
                defaultValue:
                  "This file type can't be previewed — use Download.",
              })}
        </Text>
      </Stack>
    );
  }

  if (state.kind === 'loading') {
    return (
      <Stack gap={3} className="h-full items-center justify-center p-8">
        <Spinner
          label={t('workspaceFiles.error', { defaultValue: 'Loading' })}
        />
        <Text variant="caption" className="font-mono">
          {filename}
        </Text>
      </Stack>
    );
  }

  if (state.kind === 'session_stopped') {
    return <SessionStoppedState />;
  }

  if (state.kind === 'error') {
    return (
      <Stack gap={2} className="h-full items-center justify-center p-8">
        <Text variant="muted" className="text-sm">
          {t('workspaceFiles.error', {
            defaultValue: 'Could not load this file.',
          })}
        </Text>
      </Stack>
    );
  }

  if (state.kind === 'image') {
    return <ImageViewer url={state.objectUrl} alt={filename} />;
  }

  if (state.kind === 'text') {
    // Markdown reads better rendered: open in the RenderableFileViewer's
    // Preview mode (it still exposes a Source toggle). Everything else is
    // shown as syntax-highlighted source.
    if (MARKDOWN_EXTS.has(getFileExtensionLower(path))) {
      return (
        <RenderableFileViewer
          kind="markdown"
          path={path}
          content={state.content}
          defaultMode="preview"
        />
      );
    }
    return <CodeViewer path={path} content={state.content} showWrapToggle />;
  }

  // download-only notice (binary, or 404 missing/too-large) — the Download
  // button itself lives in the toolbar above.
  return (
    <Stack
      gap={2}
      className="h-full items-center justify-center p-8 text-center"
    >
      <Text variant="muted" className="text-sm">
        {state.reason === 'too_large'
          ? t('workspaceFiles.tooLarge', {
              defaultValue:
                "Can't preview this file (missing or too large) — download it instead.",
            })
          : t('workspaceFiles.previewUnavailable', {
              defaultValue: "This file type can't be previewed — use Download.",
            })}
      </Text>
    </Stack>
  );
}

function SessionStoppedState() {
  const { t } = useT('chat');
  return (
    <Stack
      gap={3}
      className="h-full items-center justify-center p-8 text-center"
    >
      <MoonStar className="text-muted-foreground size-6" aria-hidden />
      <Text variant="label" className="text-sm">
        {t('workspaceFiles.sessionStopped', {
          defaultValue: 'Workspace not running',
        })}
      </Text>
      <Text variant="muted" className="max-w-xs text-sm">
        {t('workspaceFiles.resumeHint', {
          defaultValue:
            'Send a message to resume the session and browse files.',
        })}
      </Text>
    </Stack>
  );
}

/** The full open-pane body: header + tree (left) + viewer (below). Shared by
 *  the desktop resizable pane and the mobile sheet. */
function WorkspaceFilesBody({ threadId }: { threadId: string }) {
  const { t } = useT('chat');
  const { close } = useWorkspaceFiles();
  const [showHidden, setShowHidden] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sessionRunning, setSessionRunning] = useState(true);

  const handleSelectFile = useCallback((p: string) => setSelectedPath(p), []);

  return (
    <>
      <div className="border-border flex items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Folder
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          <span className="truncate text-sm font-medium">
            {t('workspaceFiles.title', { defaultValue: 'Workspace files' })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip
            content={t('workspaceFiles.showHidden', {
              defaultValue: 'Show hidden files',
            })}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setShowHidden((v) => !v)}
              aria-pressed={showHidden}
              aria-label={t('workspaceFiles.showHidden', {
                defaultValue: 'Show hidden files',
              })}
            >
              {showHidden ? (
                <Eye className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
            </Button>
          </Tooltip>
          <Tooltip
            content={t('workspaceFiles.refresh', { defaultValue: 'Refresh' })}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setRefreshNonce((n) => n + 1)}
              aria-label={t('workspaceFiles.refresh', {
                defaultValue: 'Refresh',
              })}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </Tooltip>
          {/* Rendered in every variant. On desktop it's the pane's close; in
              the mobile Sheet (`embedded`) it replaces the Sheet's own absolute
              top-right close (suppressed via `hideClose`) so it can't collide
              with the Show-hidden / Refresh actions in this same row. */}
          <Tooltip
            content={t('workspaceFiles.paneClose', {
              defaultValue: 'Close files panel',
            })}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={close}
              aria-label={t('workspaceFiles.paneClose', {
                defaultValue: 'Close files panel',
              })}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {!sessionRunning ? (
        <SessionStoppedState />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Tree: stacked on top under `md` (narrow), left sidebar on desktop
              (the conventional file-explorer left/right layout). */}
          <div className="border-border max-h-[45%] min-h-0 w-full shrink-0 overflow-y-auto border-b p-2 md:h-full md:max-h-none md:w-1/3 md:max-w-[280px] md:min-w-[160px] md:border-r md:border-b-0">
            <WorkspaceFileTree
              threadId={threadId}
              showHidden={showHidden}
              refreshNonce={refreshNonce}
              selectedPath={selectedPath}
              onSelectFile={handleSelectFile}
              onSessionRunningChange={setSessionRunning}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedPath ? (
              <WorkspaceFileViewer
                key={selectedPath}
                threadId={threadId}
                path={selectedPath}
              />
            ) : (
              <Stack
                gap={2}
                className="h-full items-center justify-center p-8 text-center"
              >
                <Text variant="muted" className="text-sm">
                  {t('workspaceFiles.selectFile', {
                    defaultValue: 'Select a file to preview.',
                  })}
                </Text>
              </Stack>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Mobile/embedded variant — renders just the body (no resizable shell). The
 *  caller (the chat Sheet) supplies the panel chrome. */
export function WorkspaceFilesMobileBody({ threadId }: { threadId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceFilesBody threadId={threadId} />
    </div>
  );
}

/**
 * Read-only right-side pane listing the live external-agent session workspace.
 * Clones the CanvasPane shell: resizable 320–720px (default ~480), a
 * collapse-to-48px strip with a vertical label, a `border-l` left edge, a drag
 * handle, and `React.memo`. Renders only on external-agent threads with a live
 * (or recoverable) session — it is the SOLE right pane on those threads, so no
 * mutual-exclusion with Canvas/Plan is needed (those never mount here).
 */
function WorkspaceFilesPaneComponent() {
  const { t } = useT('chat');
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const { isOpen, open } = useWorkspaceFiles();

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

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

  // Gating lives at the mount site: chat.tsx only mounts this pane when
  // `useSandboxPanesAvailable` is true (external-agent thread with a session).
  // With no threadId there's nothing to browse.
  if (!threadId) return null;

  // Collapsed: hidden on mobile (the Sheet takes over below `md`), a vertical
  // strip on desktop so the pane is one click away after the user closes it.
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={t('workspaceFiles.toggleLabel', {
          defaultValue: 'Workspace files',
        })}
        className="border-border bg-background hover:bg-muted/50 group hidden h-full shrink-0 cursor-pointer flex-col items-center gap-3 border-l py-4 transition-colors md:flex"
        style={{ width: STRIP_WIDTH }}
      >
        <Folder className="text-muted-foreground group-hover:text-foreground size-4" />
        <span className="text-muted-foreground group-hover:text-foreground rotate-180 text-[10px] [writing-mode:vertical-rl]">
          {t('workspaceFiles.title', { defaultValue: 'Workspace files' })}
        </span>
      </button>
    );
  }

  return (
    <div
      className="border-border bg-background relative hidden h-full shrink-0 flex-col border-l md:flex"
      style={{ width }}
      role="complementary"
      aria-label={t('workspaceFiles.title', {
        defaultValue: 'Workspace files',
      })}
    >
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('workspaceFiles.paneClose', {
          defaultValue: 'Resize files panel',
        })}
      />
      <WorkspaceFilesBody threadId={threadId} />
    </div>
  );
}

export const WorkspaceFilesPane = memo(WorkspaceFilesPaneComponent);
