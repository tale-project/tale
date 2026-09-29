'use client';

import {
  iconForPath,
  TreeRowButton,
  treeNavigationKeyDown,
} from '@tale/ui/file-tree-primitives';
import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';
import {
  buildBundleTree,
  bundleTreeEntryPath,
  collectDirPaths,
  type BundleTreeNode,
} from '@/lib/skills/build-bundle-tree';

interface BundleAsset {
  path: string;
  size: number;
}

interface SkillBundleTreePanelProps {
  /** With the slug, keys the folders this browser remembers as collapsed:
   * every organization starts with the same builtin slugs. */
  organizationId: string;
  assets: ReadonlyArray<BundleAsset>;
  /** Skill slug — keys the folders this browser remembers as collapsed. */
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
/** Per organization and skill: the folders the member collapsed. Every other
 * folder shows open, one the bundle gains later included. */
const COLLAPSED_STORAGE_PREFIX = 'skill-bundle-tree-collapsed:';
/**
 * The earlier record: the folders left OPEN, per slug. It is dropped, not
 * read — a folder missing from it may have been collapsed or may have
 * joined the bundle since it was written, and the tree re-expanded every
 * folder on open anyway, so no member ever saw it kept.
 */
const LEGACY_EXPANDED_STORAGE_PREFIX = 'skill-bundle-tree-expanded:';
const NONE: readonly string[] = [];
// The top level reads as the bundle's headings.
const TOP_LEVEL_ROW = 'py-1.5 text-sm';

function dropLegacyExpansion(slug: string): void {
  try {
    window.localStorage.removeItem(LEGACY_EXPANDED_STORAGE_PREFIX + slug);
  } catch (err) {
    console.warn(
      '[skill-tree] failed to drop the earlier expansion state:',
      err,
    );
  }
}

/** A stored value as the set of folder paths it names; anything else as none. */
function pathSet(stored: unknown): Set<string> {
  return new Set(
    Array.isArray(stored)
      ? stored.filter((path): path is string => typeof path === 'string')
      : [],
  );
}

/**
 * Middle pane of the three-pane skill detail view: a recursive tree of
 * every file in the bundle, with chevron expand/collapse on directories.
 * Implements WAI-ARIA tree semantics with the shared file-tree primitives —
 * Up/Down move focus between visible rows, Left/Right collapse/expand or
 * jump to parent, Home and End jump to the first/last visible row, Enter and
 * Space activate. One row carries the Tab stop: the selected file, or the
 * folder that hides it once collapsed, so Tab always finds the tree.
 *
 * The folders a member collapses are remembered per skill in localStorage
 * under `skill-bundle-tree-collapsed:<organizationId>:<slug>`; every other
 * folder opens expanded — Office-class skills like `pptx` nest six levels
 * deep, and a collapsed-by-default tree would hide the 25+ XSDs that are
 * the point of the bundle — a folder the bundle gains later included.
 *
 * SKILL.md is pinned at the top as the "root" file of the bundle.
 */
export function SkillBundleTreePanel({
  organizationId,
  assets,
  slug,
  selectedPath,
  onSelectPath,
  fileCount,
  loading,
}: SkillBundleTreePanelProps) {
  const { t } = useT('skills');
  const treeRef = useRef<HTMLUListElement>(null);

  const tree = useMemo(() => buildBundleTree(assets), [assets]);
  const allDirPaths = useMemo(() => collectDirPaths(tree), [tree]);

  const [storedCollapsed, setStoredCollapsed] = usePersistedState<
    readonly string[]
  >(`${COLLAPSED_STORAGE_PREFIX}${organizationId}:${slug}`, NONE);
  useEffect(() => {
    dropLegacyExpansion(slug);
  }, [slug]);
  const expanded = useMemo(() => {
    const collapsed = pathSet(storedCollapsed);
    return new Set(allDirPaths.filter((dir) => !collapsed.has(dir)));
  }, [allDirPaths, storedCollapsed]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setStoredCollapsed((prev) => {
        const present = new Set(allDirPaths);
        const collapsed = pathSet(prev);
        if (collapsed.has(dirPath)) collapsed.delete(dirPath);
        else collapsed.add(dirPath);
        // Folders that left the bundle are forgotten.
        return [...collapsed].filter((path) => present.has(path));
      });
    },
    [allDirPaths, setStoredCollapsed],
  );

  const entryPath =
    bundleTreeEntryPath(tree, expanded, selectedPath) ?? SKILL_MD;

  // Inline "Bundle · N files" header (replaces the old separate boxed
  // "Bundle files" stat) — falls back to just "Bundle" while the count loads.
  const heading =
    fileCount != null
      ? t('detail.tree.headingCount', {
          defaultValue: 'Bundle · {fileCount} files',
          fileCount,
        })
      : t('detail.tree.heading', { defaultValue: 'Bundle' });

  return (
    <Skeletonize
      loading={loading ?? false}
      label={heading}
      className="contents"
    >
      <aside
        className="border-border w-72 shrink-0 overflow-y-auto border-r"
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
          onKeyDown={(event) =>
            treeNavigationKeyDown(event, treeRef.current, expanded, toggleDir)
          }
          className="m-0 list-none p-0"
        >
          <li role="none">
            <TreeRowButton
              isActive={selectedPath === SKILL_MD}
              tabbable={entryPath === SKILL_MD}
              depth={0}
              onClick={() => onSelectPath(SKILL_MD)}
              title={SKILL_MD}
              ariaLabel={SKILL_MD}
              className={TOP_LEVEL_ROW}
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
                {t('detail.tree.empty', {
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
                entryPath={entryPath}
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
  expanded: ReadonlySet<string>;
  /** Selected file path, or `null` when the overview (no file) is shown. */
  selectedPath: string | null;
  /** The one row Tab lands on (`bundleTreeEntryPath`). */
  entryPath: string;
  onSelectPath: (path: string) => void;
  onToggleDir: (path: string) => void;
}

function TreeNodeRow({
  node,
  depth,
  parentPath,
  expanded,
  selectedPath,
  entryPath,
  onSelectPath,
  onToggleDir,
}: TreeNodeRowProps) {
  const rowClassName = depth === 0 ? TOP_LEVEL_ROW : undefined;
  if (node.kind === 'dir') {
    const isOpen = expanded.has(node.path);
    return (
      <li role="none">
        <TreeRowButton
          isActive={false}
          tabbable={entryPath === node.path}
          depth={depth}
          onClick={() => onToggleDir(node.path)}
          title={node.path}
          ariaLabel={`${node.name}/`}
          ariaExpanded={isOpen}
          dataDirPath={node.path}
          dataParentPath={parentPath}
          className={rowClassName}
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
                entryPath={entryPath}
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
  return (
    <li role="none">
      <TreeRowButton
        isActive={selectedPath === node.path}
        tabbable={entryPath === node.path}
        depth={depth}
        onClick={() => onSelectPath(node.path)}
        title={node.path}
        ariaLabel={node.path}
        dataParentPath={parentPath}
        className={rowClassName}
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
