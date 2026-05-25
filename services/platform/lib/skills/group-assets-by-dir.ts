export interface BundleAssetGroup<T extends { path: string }> {
  /** Top-level directory key, or '.' for root-level files. */
  dir: string;
  files: T[];
}

/**
 * Group skill bundle assets by their top-level directory. Single-level
 * grouping is the sweet spot for the skills UI — bundles almost never
 * nest beyond two levels in practice, so a recursive tree would be
 * ceremony without value. The returned groups are sorted alphabetically
 * by dir; files within each group are sorted by full path so the order
 * is stable across renders.
 */
export function groupAssetsByDir<T extends { path: string }>(
  assets: ReadonlyArray<T>,
): BundleAssetGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const asset of assets) {
    const slash = asset.path.indexOf('/');
    const bucket = slash === -1 ? '.' : asset.path.slice(0, slash);
    const arr = groups.get(bucket) ?? [];
    arr.push(asset);
    groups.set(bucket, arr);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => ({
      dir,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    }));
}
