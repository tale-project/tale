'use client';

import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { useT } from '@/lib/i18n/client';
import {
  buildBundleTree,
  collectDirPaths,
  type BundleTreeNode,
} from '@/lib/skills/build-bundle-tree';

interface BundleAsset {
  path: string;
  size: number;
}

interface SkillBundleTreePanelProps {
  assets: ReadonlyArray<BundleAsset>;
  /** Skill slug — used as the per-bundle localStorage key for expansion state. */
  slug: string;
  /**
   * Selected file — 'SKILL.md', an asset path, or `null` when the panel shows
   * the skill overview (no file selected). No tree row is highlighted for null.
   */
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  /**
   * Total files in the bundle (SKILL.md + assets), rendered inline in the pane
   * header as "Bundle · N files". Omitted while loading (shows just "Bundle").
   */
  fileCount?: number;
  loading?: boolean;
}

const SKILL_MD = 'SKILL.md';
const EXPANSION_STORAGE_PREFIX = 'skill-bundle-tree-expanded:';

function iconForPath(rel: string): typeof File {
  const lower = rel.toLowerCase();
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

function readExpansionState(slug: string): Set<string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EXPANSION_STORAGE_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((s): s is string => typeof s === 'string'));
  } catch (err) {
    console.warn('[skill-tree] failed to read expansion state:', err);
    return null;
  }
}

function writeExpansionState(slug: string, expanded: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      EXPANSION_STORAGE_PREFIX + slug,
      JSON.stringify(Array.from(expanded)),
    );
  } catch (err) {
    console.warn('[skill-tree] failed to persist expansion state:', err);
  }
}

/**
 * Middle pane of the three-pane skill detail view: a recursive tree of
 * every file in the bundle, with chevron expand/collapse on directories.
 * Implements WAI-ARIA tree semantics — Up/Down move focus between
 * visible rows, Left/Right collapse/expand or jump to parent, Home and
 * End jump to the first/last visible row, Enter and Space activate.
 *
 * Expansion state is persisted per-skill in localStorage under
 * `skill-bundle-tree-expanded:<slug>`. Default state when no entry
 * exists: every directory expanded — Office-class skills like `pptx`
 * nest six levels deep, and a collapsed-by-default tree would hide the
 * 25+ XSDs that are the point of the bundle.
 *
 * SKILL.md is pinned at the top as the "root" file of the bundle.
 */
export function SkillBundleTreePanel({
  assets,
  slug,
  selectedPath,
  onSelectPath,
  fileCount,
  loading,
}: SkillBundleTreePanelProps) {
  const { t } = useT('settings');
  const treeRef = useRef<HTMLUListElement>(null);

  const tree = useMemo(() => buildBundleTree(assets), [assets]);
  const allDirPaths = useMemo(() => collectDirPaths(tree), [tree]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(allDirPaths),
  );
  const [hydrated, setHydrated] = useState(false);

  // Hydrate expansion from localStorage on first mount (or when the slug
  // changes). Done in an effect so SSR renders the deterministic
  // "all-expanded" default and avoids hydration mismatches.
  useEffect(() => {
    const stored = readExpansionState(slug);
    if (stored) {
      setExpanded(stored);
    } else {
      setExpanded(new Set(allDirPaths));
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // When the asset list changes (file added/removed/renamed) keep newly
  // appeared directories expanded by default — the user just navigated
  // there, hiding the new node would feel broken. We only add, never
  // remove, so user-collapsed directories stay collapsed.
  useEffect(() => {
    if (!hydrated) return;
    setExpanded((prev) => {
      let mutated = false;
      const next = new Set(prev);
      for (const dir of allDirPaths) {
        if (!next.has(dir)) {
          // Only auto-expand a brand-new dir that wasn't previously
          // present at all. If the user already collapsed it before
          // refresh, the stored state already covers that case.
          next.add(dir);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [allDirPaths, hydrated]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) next.delete(dirPath);
        else next.add(dirPath);
        writeExpansionState(slug, next);
        return next;
      });
    },
    [slug],
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
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      if (idx === -1) return;
      const el = items[idx];
      const dirPath = el.dataset.dirPath;
      const parentPath = el.dataset.parentPath;
      if (key === 'ArrowRight' && dirPath !== undefined) {
        if (!expanded.has(dirPath)) {
          toggleDir(dirPath);
        } else {
          // Already expanded — move into the first child if present.
          const nextIdx = Math.min(idx + 1, items.length - 1);
          items[nextIdx]?.focus();
        }
        return;
      }
      if (key === 'ArrowLeft') {
        if (dirPath !== undefined && expanded.has(dirPath)) {
          toggleDir(dirPath);
          return;
        }
        // Leaf or collapsed dir — jump to parent dir row if one exists.
        if (parentPath) {
          const parent = treeRef.current?.querySelector<HTMLButtonElement>(
            `[data-dir-path="${CSS.escape(parentPath)}"]`,
          );
          parent?.focus();
        }
      }
    }
  };

  // Inline "Bundle · N files" header (replaces the old separate boxed
  // "Bundle files" stat) — falls back to just "Bundle" while the count loads.
  const heading =
    fileCount != null
      ? t('skills.detail.tree.headingCount', {
          defaultValue: 'Bundle · {fileCount} files',
          fileCount,
        })
      : t('skills.detail.tree.heading', { defaultValue: 'Bundle' });

  return (
    <Skeletonize
      loading={loading ?? false}
      label={heading}
      className="contents"
    >
      <aside
        className="border-border w-72 shrink-0 overflow-y-auto border-r p-3"
        aria-label={heading}
      >
        <Heading level={2} className="sr-only">
          {heading}
        </Heading>
        <Text variant="caption" className="mb-2 block px-1" aria-hidden>
          {heading}
        </Text>
        <ul
          ref={treeRef}
          role="tree"
          aria-label={heading}
          onKeyDown={handleKeyDown}
          className="m-0 list-none p-0"
        >
          <li role="none">
            <TreeRowButton
              isActive={selectedPath === SKILL_MD}
              depth={0}
              onClick={() => onSelectPath(SKILL_MD)}
              title={SKILL_MD}
              ariaLabel={SKILL_MD}
            >
              <span className="size-3 shrink-0" aria-hidden />
              <FileText className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate font-mono">
                <SkeletonBox>SKILL.md</SkeletonBox>
              </span>
            </TreeRowButton>
          </li>
          {tree.length === 0 ? (
            <li role="none" className="mt-3 px-2">
              <Text variant="muted" className="text-xs">
                {t('skills.detail.tree.empty', {
                  defaultValue:
                    'Only SKILL.md — add files under scripts/, references/, or assets/.',
                })}
              </Text>
            </li>
          ) : (
            tree.map((node) => (
              <TreeNodeRow
                key={node.path}
                node={node}
                depth={0}
                parentPath={null}
                expanded={expanded}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                onToggleDir={toggleDir}
              />
            ))
          )}
        </ul>
      </aside>
    </Skeletonize>
  );
}

interface TreeNodeRowProps {
  node: BundleTreeNode;
  depth: number;
  parentPath: string | null;
  expanded: Set<string>;
  /** Selected file path, or `null` when the overview (no file) is shown. */
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onToggleDir: (path: string) => void;
}

function TreeNodeRow({
  node,
  depth,
  parentPath,
  expanded,
  selectedPath,
  onSelectPath,
  onToggleDir,
}: TreeNodeRowProps) {
  if (node.kind === 'dir') {
    const isOpen = expanded.has(node.path);
    return (
      <li role="none">
        <TreeRowButton
          isActive={false}
          depth={depth}
          onClick={() => onToggleDir(node.path)}
          title={node.path}
          ariaLabel={`${node.name}/`}
          ariaExpanded={isOpen}
          dataDirPath={node.path}
          dataParentPath={parentPath}
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
          <span className="truncate font-mono">
            <SkeletonBox>{node.name}</SkeletonBox>
          </span>
        </TreeRowButton>
        {isOpen && node.children && node.children.length > 0 ? (
          <ul
            role="group"
            aria-label={`${node.name}/`}
            className="m-0 list-none p-0"
          >
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                parentPath={node.path}
                expanded={expanded}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                onToggleDir={onToggleDir}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  const Icon = iconForPath(node.path);
  const isActive = selectedPath === node.path;
  return (
    <li role="none">
      <TreeRowButton
        isActive={isActive}
        depth={depth}
        onClick={() => onSelectPath(node.path)}
        title={node.path}
        ariaLabel={node.path}
        dataParentPath={parentPath}
      >
        <span className="size-3 shrink-0" aria-hidden />
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate font-mono">
          <SkeletonBox>{node.name}</SkeletonBox>
        </span>
      </TreeRowButton>
    </li>
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
  const base =
    depth === 0
      ? 'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm'
      : 'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs';
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
      className={`${base} ${state} focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none`}
    >
      {children}
    </button>
  );
}
