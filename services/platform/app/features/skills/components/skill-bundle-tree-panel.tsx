'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { File, FileCode, FileText } from 'lucide-react';
import { useMemo } from 'react';

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
}

const SKILL_MD = 'SKILL.md';

function iconForPath(rel: string): typeof File {
  if (rel.endsWith('.md')) return FileText;
  if (
    rel.endsWith('.py') ||
    rel.endsWith('.js') ||
    rel.endsWith('.cjs') ||
    rel.endsWith('.mjs') ||
    rel.endsWith('.ts')
  ) {
    return FileCode;
  }
  return File;
}

/**
 * Middle pane of the three-pane skill detail view: a shallow tree of
 * every file in the bundle, grouped by top-level directory. Click a
 * row to set the selected file in the right pane.
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
}: SkillBundleTreePanelProps) {
  const { t } = useT('settings');

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

  return (
    <aside className="border-border w-72 shrink-0 overflow-y-auto border-r p-3">
      <Text variant="caption" className="mb-2 block px-1">
        {t('skills.detail.tree.heading', { defaultValue: 'Bundle' })}
      </Text>
      <Stack gap={0}>
        <button
          type="button"
          onClick={() => onSelectPath(SKILL_MD)}
          className={
            selectedPath === SKILL_MD
              ? 'bg-muted text-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm'
          }
        >
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate font-mono">SKILL.md</span>
        </button>
        {grouped.map(({ dir, files }) => (
          <div key={dir} className="mt-2">
            <Text
              variant="caption"
              className="text-muted-foreground px-2 font-mono"
            >
              {dir === '.'
                ? t('skills.bundle.dirRoot', { defaultValue: '(root)' })
                : `${dir}/`}
            </Text>
            <Stack gap={0} className="mt-0.5">
              {files.map((f) => {
                const leaf =
                  dir === '.' ? f.path : f.path.slice(dir.length + 1);
                const Icon = iconForPath(f.path);
                const isActive = selectedPath === f.path;
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => onSelectPath(f.path)}
                    className={
                      isActive
                        ? 'bg-muted text-foreground ml-3 flex w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground ml-3 flex w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs'
                    }
                  >
                    <Icon className="size-3 shrink-0" aria-hidden />
                    <span className="truncate font-mono">{leaf}</span>
                  </button>
                );
              })}
            </Stack>
          </div>
        ))}
      </Stack>
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
