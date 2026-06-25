'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
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
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { ChatPaneDescriptor } from '@/app/features/chat/components/chat-panel/types';
import {
  useAutoOpen,
  useRegisterPane,
} from '@/app/features/chat/components/chat-panel/use-register-pane';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import {
  getFileExtensionLower,
  isTextBasedFile,
} from '@/lib/utils/text-file-types';

import { CanvasPreferencesProvider } from '../hooks/canvas-preferences';
import { CodeFileViewer } from '../viewers/code-file-viewer';
import { ImageViewer } from '../viewers/image-viewer';
import { RenderableFileViewer } from '../viewers/renderable-file-viewer';
import { useWorkspaceFiles } from './workspace-files-context';

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

  // Auto-load previewable files on selection so their source shows immediately;
  // non-previewable binaries keep the download-only notice. Abort an in-flight
  // load + revoke a prior object URL on path change / unmount.
  useEffect(() => {
    if (previewable) {
      void loadPreview();
    } else {
      setState({ kind: 'idle' });
    }
    return () => {
      abortRef.current?.abort();
      revokeObjectUrl();
    };
  }, [previewable, loadPreview, revokeObjectUrl]);

  return (
    <Stack gap={0} className="h-full min-h-0">
      {/* Toolbar: filename + actions. Download is ALWAYS available (any file,
          any size/type); Preview is offered only for previewable types. */}
      <Row
        gap={2}
        justify="between"
        className="border-border border-b px-3 py-2"
      >
        <Text variant="caption" className="truncate font-mono" title={path}>
          {filename}
        </Text>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Files auto-load on select, so this button is mainly the retry
              affordance when a load errors (it shows disabled while loading).
              Once content is shown, the area's own Source/Preview toggle (for
              markdown/html) takes over, so the toolbar button hides. */}
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
      </Row>
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceFileViewerContent
          state={state}
          path={path}
          filename={filename}
          previewable={previewable}
        />
      </div>
    </Stack>
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
    // Show source by default. Markdown still goes through the
    // RenderableFileViewer so its Source/Preview toggle stays available (it
    // just opens on Source); everything else is syntax-highlighted source.
    if (MARKDOWN_EXTS.has(getFileExtensionLower(path))) {
      return (
        <RenderableFileViewer
          kind="markdown"
          path={path}
          content={state.content}
          defaultMode="source"
        />
      );
    }
    return <CodeFileViewer path={path} content={state.content} />;
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

interface WorkspaceFilesBodyProps {
  threadId: string;
  showHidden: boolean;
  refreshNonce: number;
}

/** The open-pane body: tree (left) + viewer (right). The Show-hidden / Refresh
 *  controls are lifted to the registrar so they can also live in the shell's
 *  tab-bar header actions; this body just consumes the resulting props. */
function WorkspaceFilesBody({
  threadId,
  showHidden,
  refreshNonce,
}: WorkspaceFilesBodyProps) {
  const { t } = useT('chat');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sessionRunning, setSessionRunning] = useState(true);

  const handleSelectFile = useCallback((p: string) => setSelectedPath(p), []);

  // An explicit Refresh re-probes a stopped session without remounting the body
  // (a remount would collapse the tree's expanded folders and drop the open
  // file — the very thing the user wants to keep). Flipping back to "running"
  // re-mounts the tree, whose first load reports the real state and flips this
  // back to stopped if the session is still down. When already running this is a
  // no-op, and the tree refreshes its expanded dirs in place off `refreshNonce`.
  useEffect(() => {
    setSessionRunning(true);
  }, [refreshNonce]);

  if (!sessionRunning) {
    return <SessionStoppedState />;
  }

  return (
    // Provider sits above the `key={selectedPath}` viewer below (which remounts
    // per file) so the wrap / Source-Preview preferences hold as you browse.
    <CanvasPreferencesProvider>
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
    </CanvasPreferencesProvider>
  );
}

interface WorkspaceFilesPaneProps {
  /** True on external-agent threads with a session — the content signal. */
  available: boolean;
}

/**
 * Read-only workspace-files pane. A registrar: it publishes a descriptor (tree
 * + viewer body, Show-hidden / Refresh header actions) to the unified right
 * panel. Availability is the content signal — `chat.tsx` passes
 * `useSandboxPanesAvailable`. Renders nothing itself.
 */
function WorkspaceFilesPaneComponent({ available }: WorkspaceFilesPaneProps) {
  const { t } = useT('chat');
  const threadMatch = useMatch({
    from: '/dashboard/$id/chat/$threadId',
    shouldThrow: false,
  });
  const threadId = threadMatch?.params?.threadId;

  const { isOpen } = useWorkspaceFiles();
  const [showHidden, setShowHidden] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const hasContent = !!threadId && available;
  // Sandbox panes don't auto-open on bare availability — open only when the
  // user asks (the `+`-menu flips the context `isOpen`). Bridge that to the
  // shell so opening Files from the menu maximizes its tab.
  useAutoOpen('files', hasContent && isOpen);

  const descriptor = useMemo<ChatPaneDescriptor | null>(() => {
    if (!hasContent || !threadId) return null;

    const headerActions: ReactNode = (
      <>
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
      </>
    );

    return {
      id: 'files',
      icon: Folder,
      label: t('workspaceFiles.title', { defaultValue: 'Workspace files' }),
      ariaLabel: t('workspaceFiles.toggleLabel', {
        defaultValue: 'Workspace files',
      }),
      hasContent: true,
      headerActions,
      body: (
        // Key by threadId alone so the body remounts on a thread switch —
        // resetting `selectedPath` and `sessionRunning` to fresh defaults so the
        // previous thread's file/state never bleeds in. Deliberately NOT keyed
        // by `refreshNonce`: Refresh must preserve the open file and the tree's
        // expanded folders. The tree re-fetches its expanded dirs in place off
        // the `refreshNonce` prop, and a STOPPED session is re-probed by the
        // effect in the body (which re-mounts the tree to re-check) — no remount
        // of the whole body, so nothing collapses.
        <WorkspaceFilesBody
          key={threadId}
          threadId={threadId}
          showHidden={showHidden}
          refreshNonce={refreshNonce}
        />
      ),
    };
  }, [hasContent, threadId, t, showHidden, refreshNonce]);

  useRegisterPane(descriptor);

  return null;
}

export const WorkspaceFilesPane = memo(WorkspaceFilesPaneComponent);
