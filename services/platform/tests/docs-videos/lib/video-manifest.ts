/**
 * The generated manifest for `services/docs/public/videos/` — the videos
 * counterpart of the images manifest `capture.ts` upserts. Same doctrine:
 * committed, generated, diff-quiet (stable sort, no timestamps), and the docs
 * test suite (`services/docs/tests/videos.test.ts`) fails any on-disk asset
 * that is not declared here.
 *
 * The merge core is pure (injected `fileExists`) so the vitest server project
 * covers pruning/ordering without touching the filesystem.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type VideoAssetKind = 'video' | 'captions' | 'poster';

export interface VideoManifestEntry {
  /** Site-relative path, e.g. `videos/tutorials/ep1-welcome.en.mp4`. */
  readonly file: string;
  readonly episode: string;
  readonly locale: string;
  readonly kind: VideoAssetKind;
  /** Video/captions runtime — poster entries omit it. */
  readonly durationSec?: number;
  /** Encoded pixel dimensions — video and poster entries carry them. */
  readonly width?: number;
  readonly height?: number;
}

/**
 * Merge freshly produced entries over the existing manifest: incoming wins by
 * `file`, entries whose asset vanished are pruned, order is stable by `file`.
 */
export function mergeManifestEntries(
  existing: readonly VideoManifestEntry[],
  incoming: readonly VideoManifestEntry[],
  fileExists: (file: string) => boolean,
): readonly VideoManifestEntry[] {
  const byFile = new Map(existing.map((entry) => [entry.file, entry]));
  for (const entry of incoming) byFile.set(entry.file, entry);
  return [...byFile.values()]
    .filter((entry) => fileExists(entry.file))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Read-merge-write the manifest at `<publicRoot>/videos/manifest.json`.
 * `publicRoot` is `services/docs/public`; entry `file` paths are relative to
 * it (mirrors how docs pages reference `/videos/…`).
 */
export function upsertVideoManifest(
  publicRoot: string,
  entries: readonly VideoManifestEntry[],
): void {
  const manifestPath = path.join(publicRoot, 'videos', 'manifest.json');
  let existing: VideoManifestEntry[] = [];
  if (existsSync(manifestPath)) {
    try {
      existing = (
        JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          entries: VideoManifestEntry[];
        }
      ).entries;
    } catch (error) {
      console.warn('Rewriting unreadable videos manifest:', error);
    }
  }
  const merged = mergeManifestEntries(existing, entries, (file) =>
    existsSync(path.join(publicRoot, file)),
  );
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ entries: merged }, null, 2)}\n`,
  );
}
