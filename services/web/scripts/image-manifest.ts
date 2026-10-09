import type { ImageManifestEntry } from '../app/generated/image-manifest';

/** Compact standard asset URLs, while keeping any custom entries intact. */
export function imageManifestExpression(
  entries: readonly ImageManifestEntry[],
): string {
  const rows = entries.map((entry) => {
    const standard = Object.entries(entry.variants).every(
      ([format, variants]) =>
        Object.entries(variants).every(
          ([width, url]) =>
            url === `/marketing/optimized/${entry.id}-${width}.${format}`,
        ),
    );
    if (!standard) return JSON.stringify(entry);
    const args = [
      entry.id,
      entry.width,
      entry.height,
      entry.blurDataURL,
      Object.keys(entry.variants.avif).map(Number),
      Object.keys(entry.variants.webp).map(Number),
    ];
    return `imageEntry(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;
  });
  return `[\n${rows.join(',\n')}\n]`;
}

/** Keep unselected assets when a command regenerates only part of the library. */
export function mergeImageManifest(
  current: readonly ImageManifestEntry[],
  incoming: readonly ImageManifestEntry[],
  replaceGroups: readonly string[] = [],
): ImageManifestEntry[] {
  const selected = new Set(incoming.map(({ id }) => id));
  const retained = current.filter(
    ({ id }) =>
      !selected.has(id) &&
      !replaceGroups.some(
        (group) => id === group || id.startsWith(`${group}-`),
      ),
  );
  return [...retained, ...incoming].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
}
