import JSZip from 'jszip';

import {
  type AppManifest,
  APP_MANIFEST_FILENAME,
  appManifestSchema,
  isValidAppSlug,
  MAX_APP_BUNDLE_ENTRIES,
  MAX_APP_BUNDLE_FILE_BYTES,
  MAX_APP_BUNDLE_TOTAL_BYTES,
} from '@/lib/shared/schemas/apps';

export interface ParsedAppBundleFile {
  /** Path relative to the app dir, POSIX separators, no leading slash. */
  relPath: string;
  size: number;
}

export interface ParsedAppBundle {
  /** The zip bytes to re-send to `_storage` (built from the folder if needed). */
  zipFile: File;
  /** Derived from the bundle's single top-level folder name. */
  slug: string;
  manifest: AppManifest;
  /** Asset entries (excludes `app.json`). */
  assets: ParsedAppBundleFile[];
  /** Total decompressed bytes (`app.json` + every asset). */
  totalBytes: number;
}

export type ParseResult =
  | { success: true; data: ParsedAppBundle }
  | { success: false; error: string };

function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

function detectSingleTopLevelFolder(names: string[]): string | null {
  let prefix: string | null = null;
  for (const name of names) {
    if (name === '') continue;
    const slash = name.indexOf('/');
    if (slash === -1) return null;
    const top = name.slice(0, slash + 1);
    if (prefix === null) {
      prefix = top;
    } else if (prefix !== top) {
      return null;
    }
  }
  return prefix;
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Validate + parse an app bundle zip. Mirrors the server's
 * `convex/apps/bundle_parse.ts` — the server re-runs every check, so this is
 * purely UX feedback before submission. The bundle must contain a SINGLE
 * top-level folder (its name becomes the app slug) with `app.json` at its root.
 */
export async function parseAppBundle(file: File): Promise<ParseResult> {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return { success: false, error: 'Bundle must be a .zip file.' };
  }
  if (file.size > MAX_APP_BUNDLE_TOTAL_BYTES) {
    return {
      success: false,
      error: `Bundle is larger than ${formatMB(MAX_APP_BUNDLE_TOTAL_BYTES)}.`,
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (err) {
    return {
      success: false,
      error: `Not a valid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rawEntries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (rawEntries.length === 0) {
    return { success: false, error: 'Zip is empty.' };
  }
  if (rawEntries.length > MAX_APP_BUNDLE_ENTRIES) {
    return {
      success: false,
      error: `Bundle has ${rawEntries.length} entries (max ${MAX_APP_BUNDLE_ENTRIES}).`,
    };
  }

  const stripPrefix = detectSingleTopLevelFolder(rawEntries.map(([n]) => n));
  if (!stripPrefix) {
    return {
      success: false,
      error:
        'Bundle must contain a single top-level folder named after the app.',
    };
  }
  const slug = stripPrefix.slice(0, -1);
  if (!isValidAppSlug(slug)) {
    return {
      success: false,
      error: `Folder name "${slug}" is not a valid app slug (lowercase letters, digits and single hyphens; ≤64 chars).`,
    };
  }

  let manifestEntry: JSZip.JSZipObject | undefined;
  const assets: { relPath: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of rawEntries) {
    if (entry.dir) continue;
    const rel = name.slice(stripPrefix.length);
    if (rel === '') continue;
    if (rel.includes('\0') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      return { success: false, error: `Entry uses an unsafe path: ${rel}` };
    }
    const segments = rel.split('/');
    if (segments.some((s) => s === '' || s === '..' || s === '.')) {
      return { success: false, error: `Entry path is unsafe: ${rel}` };
    }
    if (rel === APP_MANIFEST_FILENAME) {
      manifestEntry = entry;
      continue;
    }
    if (segments.some((s) => s.startsWith('.'))) continue;
    assets.push({ relPath: rel, entry });
  }

  if (!manifestEntry) {
    return {
      success: false,
      error: `Bundle is missing ${APP_MANIFEST_FILENAME} at the app folder root.`,
    };
  }

  const manifestText = await manifestEntry.async('string');
  let manifest: AppManifest;
  try {
    manifest = appManifestSchema.parse(JSON.parse(manifestText));
  } catch (err) {
    return {
      success: false,
      error: `${APP_MANIFEST_FILENAME} rejected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const manifestBytes = new TextEncoder().encode(manifestText).length;
  if (manifestBytes > MAX_APP_BUNDLE_FILE_BYTES) {
    return {
      success: false,
      error: `${APP_MANIFEST_FILENAME} exceeds per-file cap of ${formatKB(MAX_APP_BUNDLE_FILE_BYTES)}.`,
    };
  }
  let totalBytes = manifestBytes;

  const assetMeta: ParsedAppBundleFile[] = [];
  for (const { relPath, entry } of assets) {
    const buf = await entry.async('uint8array');
    if (buf.length > MAX_APP_BUNDLE_FILE_BYTES) {
      return {
        success: false,
        error: `Asset "${relPath}" exceeds per-file cap of ${formatKB(MAX_APP_BUNDLE_FILE_BYTES)}.`,
      };
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_APP_BUNDLE_TOTAL_BYTES) {
      return {
        success: false,
        error: `Decompressed bundle exceeds ${formatMB(MAX_APP_BUNDLE_TOTAL_BYTES)}.`,
      };
    }
    assetMeta.push({ relPath, size: buf.length });
  }

  assetMeta.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // Mirror the server's manifest↔file consistency check (bundle_parse.ts) so a
  // malformed app is caught here instead of failing install with a cryptic
  // ENOENT. App workflows must be declared `<slug>/<name>` and carried at
  // `workflows/<slug>/<name>.json`; agents are bare names at `agents/<name>.json`.
  const present = new Set(assetMeta.map((a) => a.relPath));
  for (const wf of manifest.workflows ?? []) {
    if (!wf.startsWith(`${slug}/`)) {
      const name = wf.includes('/') ? wf.slice(wf.indexOf('/') + 1) : wf;
      return {
        success: false,
        error: `Workflow "${wf}" must be declared as "${slug}/${name}" and live at workflows/${slug}/${name}.json — app workflows are scoped to the app.`,
      };
    }
    if (!present.has(`workflows/${wf}.json`)) {
      return {
        success: false,
        error: `Declared workflow "${wf}" has no file at workflows/${wf}.json in the bundle.`,
      };
    }
  }
  for (const agent of manifest.agents ?? []) {
    if (!present.has(`agents/${agent}.json`)) {
      return {
        success: false,
        error: `Declared agent "${agent}" has no file at agents/${agent}.json in the bundle.`,
      };
    }
  }

  return {
    success: true,
    data: { zipFile: file, slug, manifest, assets: assetMeta, totalBytes },
  };
}

/**
 * Parse a directory the user picked via a `webkitdirectory` input. Each file's
 * `webkitRelativePath` already carries the selected folder as its first segment
 * (`my-app/app.json`), so we zip them verbatim into a single-wrapper-folder
 * bundle and run it through {@link parseAppBundle} — one validation path, and
 * the resulting `zipFile` is what gets uploaded.
 */
export async function parseAppFolder(files: File[]): Promise<ParseResult> {
  const usable = files.filter((f) => {
    const rel = relPathOf(f);
    return rel !== '' && !isOsMetadataEntry(rel);
  });
  if (usable.length === 0) {
    return { success: false, error: 'The selected folder is empty.' };
  }

  const topFolder = detectSingleTopLevelFolder(usable.map(relPathOf));
  if (!topFolder) {
    return {
      success: false,
      error: 'Select a single app folder (it must contain app.json).',
    };
  }

  const zip = new JSZip();
  for (const file of usable) {
    zip.file(relPathOf(file), await file.arrayBuffer());
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  });
  const slug = topFolder.slice(0, -1);
  const zipFile = new File([blob], `${slug}.zip`, { type: 'application/zip' });
  return parseAppBundle(zipFile);
}

/** A `webkitdirectory` File exposes its in-folder path here; fall back to name. */
function relPathOf(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}
