'use client';

import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
} from 'lucide-react';
import { useMemo, useRef, type KeyboardEvent } from 'react';

import { useT } from '@/lib/i18n/client';

interface BundleAsset {
  path: string;
  size: number;
}

interface SkillBundleTreePanelProps {
  assets: ReadonlyArray<BundleAsset>;
  totalBytes: number;
  maxTotalBytes: number;
  maxAssets: number;
  /** Path of the file selected in the viewer ('SKILL.md' or an asset path). */
  selectedPath: string;
  onSelectPath: (path: string) => void;
  loading?: boolean;
}

const SKILL_MD = 'SKILL.md';

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

/**
 * Middle pane of the three-pane skill detail view: a shallow tree of
 * every file in the bundle, grouped by top-level directory. Implements
 * WAI-ARIA tree semantics — Up/Down move focus between siblings, Home
 * and End jump to the first/last visible row, Enter and Space activate.
 *
 * Single-level grouping is the sweet spot for skills — bundles almost
 * never nest beyond two levels in practice, and a recursive tree would
 * be ceremony without value. SKILL.md is pinned at the top as the
 * "root" file of the bundle.
 */
export function SkillBundleTreePanel({
  assets,
  totalBytes,
  maxTotalBytes,
  maxAssets,
  selectedPath,
  onSelectPath,
  loading,
}: SkillBundleTreePanelProps) {
  const { t } = useT('settings');
  const treeRef = useRef<HTMLUListElement>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, BundleAsset[]>();
    for (const asset of assets) {
      const slash = asset.path.indexOf('/');
      const bucket = slash === -1 ? '.' : asset.path.slice(0, slash);
      const arr = groups.get(bucket) ?? [];
      arr.push(asset);
      groups.set(bucket, arr);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        // Pin root (".") last so directories surface first — matches
        // the Claude shape where scripts/ / assets/ / references/
        // anchor the tree visually.
        if (a === '.') return 1;
        if (b === '.') return -1;
        return a.localeCompare(b);
      })
      .map(([dir, files]) => ({
        dir,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      }));
  }, [assets]);

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const { key } = event;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
    const items =
      treeRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]');
    if (!items || items.length === 0) return;
    event.preventDefault();
    const current = document.activeElement;
    let idx = -1;
    items.forEach((el, i) => {
      if (el === current) idx = i;
    });
    let next = idx;
    if (key === 'ArrowDown')
      next = idx === -1 ? 0 : Math.min(idx + 1, items.length - 1);
    else if (key === 'ArrowUp')
      next = idx === -1 ? items.length - 1 : Math.max(idx - 1, 0);
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = items.length - 1;
    items[next]?.focus();
  };

  const heading = t('skills.detail.tree.heading', { defaultValue: 'Bundle' });

  if (loading) {
    return (
      <aside
        className="border-border w-72 shrink-0 overflow-y-auto border-r p-3"
        aria-label={heading}
      >
        <Skeleton className="mb-2 ml-1 h-3 w-16" />
        <Stack gap={0}>
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          {Array.from({ length: 3 }).map((_, groupIdx) => (
            <div key={groupIdx} className="mt-2">
              <Skeleton className="ml-2 h-3 w-20" />
              <Stack gap={0} className="mt-0.5">
                {Array.from({ length: 2 + (groupIdx % 2) }).map(
                  (__, fileIdx) => (
                    <div
                      key={fileIdx}
                      className="ml-3 flex items-center gap-1.5 rounded-md px-2 py-1"
                    >
                      <Skeleton className="size-3 shrink-0 rounded" />
                      <Skeleton
                        className="h-3"
                        style={{ width: `${50 + ((fileIdx * 17) % 35)}%` }}
                      />
                    </div>
                  ),
                )}
              </Stack>
            </div>
          ))}
        </Stack>
        <Skeleton className="mt-4 ml-1 h-3 w-40" />
      </aside>
    );
  }

  const rowClass = (active: boolean, depth: 'root' | 'child') => {
    const base =
      depth === 'root'
        ? 'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm'
        : 'ml-3 flex w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs';
    const state = active
      ? 'bg-muted text-foreground border-l-2 border-primary'
      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground border-l-2 border-transparent';
    return `${base} ${state} focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none`;
  };

  return (
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
          <button
            type="button"
            role="treeitem"
            aria-selected={selectedPath === SKILL_MD}
            aria-level={1}
            tabIndex={selectedPath === SKILL_MD ? 0 : -1}
            onClick={() => onSelectPath(SKILL_MD)}
            title={SKILL_MD}
            aria-label={SKILL_MD}
            className={rowClass(selectedPath === SKILL_MD, 'root')}
          >
            <FileText className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-mono">SKILL.md</span>
          </button>
        </li>
        {grouped.length === 0 ? (
          <li role="none" className="mt-3 px-2">
            <Text variant="muted" className="text-xs">
              {t('skills.detail.tree.empty', {
                defaultValue:
                  'Only SKILL.md — add files under scripts/, references/, or assets/.',
              })}
            </Text>
          </li>
        ) : null}
        {grouped.map(({ dir, files }) => {
          const dirLabel =
            dir === '.'
              ? t('skills.bundle.dirRoot', { defaultValue: '(root)' })
              : `${dir}/`;
          return (
            <li key={dir} role="none" className="mt-2">
              <div className="flex items-center gap-1.5 px-2">
                <Folder
                  className="text-muted-foreground size-3 shrink-0"
                  aria-hidden
                />
                <Text
                  variant="caption"
                  className="text-muted-foreground font-mono"
                  aria-hidden
                >
                  {dirLabel}
                </Text>
              </div>
              <ul
                role="group"
                aria-label={dirLabel}
                className="m-0 mt-0.5 list-none p-0"
              >
                {files.map((f) => {
                  const leaf =
                    dir === '.' ? f.path : f.path.slice(dir.length + 1);
                  const Icon = iconForPath(f.path);
                  const isActive = selectedPath === f.path;
                  return (
                    <li key={f.path} role="none">
                      <button
                        type="button"
                        role="treeitem"
                        aria-selected={isActive}
                        aria-level={2}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onSelectPath(f.path)}
                        title={f.path}
                        aria-label={f.path}
                        className={rowClass(isActive, 'child')}
                      >
                        <Icon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate font-mono">{leaf}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <Text variant="caption" className="mt-4 block px-1 text-xs">
        {t('skills.bundle.quota', {
          defaultValue: '{used}/{max} files · {bytes}/{byteMax} bytes',
          used: assets.length,
          max: maxAssets,
          bytes: totalBytes,
          byteMax: maxTotalBytes,
        })}
      </Text>
    </aside>
  );
}
