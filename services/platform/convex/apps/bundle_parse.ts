/**
 * Decode + validate an uploaded APP bundle zip into the in-memory shape the
 * upload action writes to disk. Pure (operates on a `Uint8Array`, no I/O), so
 * the `'use node'` action and the unit test share one authoritative validator.
 * The client's `parse-app-bundle.ts` re-runs the same checks for UX only.
 *
 * Bundle shape: a SINGLE top-level folder whose NAME is the app slug, with
 * `app.json` (the manifest) at its root — exactly the layout a user gets by
 * zipping their `my-app/` directory, and what the folder-picker path builds
 * client-side. Everything else (views/, messages/, agents/, workflows/,
 * scripts/, integrations/) is carried verbatim under the app dir.
 */

import { ConvexError } from 'convex/values';
import JSZip from 'jszip';

import {
  type AppManifest,
  APP_MANIFEST_FILENAME,
  appManifestSchema,
  isValidAppSlug,
  MAX_APP_BUNDLE_ENTRIES,
  MAX_APP_BUNDLE_FILE_BYTES,
  MAX_APP_BUNDLE_TOTAL_BYTES,
} from '../../lib/shared/schemas/apps';

export interface ParsedAppBundleFile {
  /** Path relative to the app dir (no leading slash, POSIX separators). */
  relPath: string;
  content: Uint8Array;
}

export interface ParsedAppBundle {
  /** Derived from the bundle's single top-level folder name. */
  slug: string;
  manifest: AppManifest;
  /** Includes `app.json` as the first entry. */
  files: ParsedAppBundleFile[];
  /** Total decompressed bytes (manifest + every asset). */
  totalBytes: number;
}

/**
 * Drop OS-injected metadata entries that would otherwise pollute the bundle or
 * defeat the wrapper-folder detection. Mirrored on the client in
 * `parse-app-bundle.ts`.
 */
function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

/**
 * The single shared top-level folder of every entry, with its trailing slash
 * (e.g. `my-app/`), or null when entries don't share exactly one — a root-level
 * file, or two different top folders. An app bundle REQUIRES one: its name is
 * the slug.
 */
function detectSingleTopLevelFolder(names: string[]): string | null {
  let prefix: string | null = null;
  for (const name of names) {
    if (name === '') continue;
    const slash = name.indexOf('/');
    if (slash === -1) return null; // a root-level file disqualifies
    const top = name.slice(0, slash + 1);
    if (prefix === null) {
      prefix = top;
    } else if (prefix !== top) {
      return null;
    }
  }
  return prefix;
}

export async function parseAppBundleZip(
  bytes: Uint8Array,
): Promise<ParsedAppBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: `Not a valid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const rawEntries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (rawEntries.length === 0) {
    throw new ConvexError({ code: 'INVALID_BUNDLE', message: 'Zip is empty' });
  }
  if (rawEntries.length > MAX_APP_BUNDLE_ENTRIES) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: `Bundle contains ${rawEntries.length} entries (max ${MAX_APP_BUNDLE_ENTRIES})`,
    });
  }

  const stripPrefix = detectSingleTopLevelFolder(rawEntries.map(([n]) => n));
  if (!stripPrefix) {
    throw new ConvexError({
      code: 'MISSING_WRAPPER_FOLDER',
      message:
        'Bundle must contain a single top-level folder named after the app (its name becomes the app slug).',
    });
  }
  const slug = stripPrefix.slice(0, -1); // strip trailing '/'
  if (!isValidAppSlug(slug)) {
    throw new ConvexError({
      code: 'INVALID_SLUG',
      message: `Folder name "${slug}" is not a valid app slug (lowercase letters, digits and single hyphens; ≤64 chars).`,
    });
  }

  let manifestEntry: JSZip.JSZipObject | undefined;
  const assetEntries: { relPath: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of rawEntries) {
    if (entry.dir) continue;
    const rel = name.slice(stripPrefix.length);
    if (rel === '') continue;
    if (rel.includes('\0')) {
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message: 'Bundle entry path contains NUL byte',
      });
    }
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message: `Bundle entry uses absolute path: ${rel}`,
      });
    }
    const segments = rel.split('/');
    for (const seg of segments) {
      if (seg === '' || seg === '..' || seg === '.') {
        throw new ConvexError({
          code: 'INVALID_BUNDLE',
          message: `Bundle entry path is unsafe: ${rel}`,
        });
      }
    }
    if (rel === APP_MANIFEST_FILENAME) {
      manifestEntry = entry;
      continue;
    }
    // Skip dotfiles silently (matches the on-disk listing's behaviour).
    if (segments.some((s) => s.startsWith('.'))) continue;
    assetEntries.push({ relPath: rel, entry });
  }

  if (!manifestEntry) {
    throw new ConvexError({
      code: 'MISSING_MANIFEST',
      message: `Bundle is missing ${APP_MANIFEST_FILENAME} at the app folder root`,
    });
  }

  const manifestText = await manifestEntry.async('string');
  let manifest: AppManifest;
  try {
    manifest = appManifestSchema.parse(JSON.parse(manifestText));
  } catch (err) {
    throw new ConvexError({
      code: 'INVALID_MANIFEST',
      message: `${APP_MANIFEST_FILENAME} rejected: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const files: ParsedAppBundleFile[] = [];
  const manifestBytes = new TextEncoder().encode(manifestText);
  if (manifestBytes.length > MAX_APP_BUNDLE_FILE_BYTES) {
    throw new ConvexError({
      code: 'FILE_TOO_LARGE',
      message: `${APP_MANIFEST_FILENAME} exceeds per-file cap of ${MAX_APP_BUNDLE_FILE_BYTES} bytes`,
    });
  }
  let totalBytes = manifestBytes.length;
  files.push({ relPath: APP_MANIFEST_FILENAME, content: manifestBytes });

  for (const { relPath, entry } of assetEntries) {
    const content = await entry.async('uint8array');
    if (content.length > MAX_APP_BUNDLE_FILE_BYTES) {
      throw new ConvexError({
        code: 'FILE_TOO_LARGE',
        message: `Asset "${relPath}" exceeds per-file cap of ${MAX_APP_BUNDLE_FILE_BYTES} bytes`,
      });
    }
    totalBytes += content.length;
    if (totalBytes > MAX_APP_BUNDLE_TOTAL_BYTES) {
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Decompressed bundle exceeds ${MAX_APP_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }
    files.push({ relPath, content });
  }

  return { slug, manifest, files, totalBytes };
}
