import JSZip from 'jszip';

import {
  isValidSkillSlug,
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_FILES,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
  type SkillFrontmatter,
} from '@/lib/shared/schemas/skills';
import { parseSkillMd } from '@/lib/skills/parse';

export interface ParsedSkillBundleFile {
  /** Path relative to the bundle root, POSIX separators, no leading slash. */
  relPath: string;
  size: number;
}

export interface ParsedSkillBundle {
  /** The original File so we can re-send the raw bytes to `_storage`. */
  zipFile: File;
  /** Derived from the SKILL.md frontmatter `name` field. */
  slug: string;
  /** Full parsed SKILL.md frontmatter — preview surface needs license,
   * recommendedPackages, disableModelInvocation, etc. */
  meta: SkillFrontmatter;
  /** Asset entries (excludes SKILL.md). */
  assets: ParsedSkillBundleFile[];
  /** Total decompressed bundle size in bytes (SKILL.md + every asset). */
  totalBytes: number;
}

/** A refusal, as an i18n key in the `skills` namespace plus its params. */
export interface ParseError {
  key: string;
  params?: Record<string, string | number>;
}

export type ParseResult =
  | { success: true; data: ParsedSkillBundle }
  | { success: false; error: ParseError };

function refusal(
  key: string,
  params?: Record<string, string | number>,
): ParseResult {
  return { success: false, error: { key: `upload.errors.${key}`, params } };
}

/**
 * Validate and parse an uploaded skill bundle zip. Mirrors the server-side
 * checks in `convex/skills/bundle_zip.ts` — the server re-runs all of them,
 * so this is purely for UX feedback before submission.
 *
 * Accepts the common "single wrapper folder" shape browsers produce when a
 * user zips a folder: if every entry shares one top-level folder, that
 * folder is stripped.
 */
export async function parseSkillBundle(file: File): Promise<ParseResult> {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return refusal('notZip');
  }
  if (file.size > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
    return refusal('totalTooLarge', {
      max: formatMB(MAX_SKILL_BUNDLE_TOTAL_BYTES),
    });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (err) {
    return refusal('invalidZip', {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Drop OS-injected metadata (macOS `__MACOSX/`, `.DS_Store`, Windows
  // `Thumbs.db`) before any wrapper-folder detection. Without this, a macOS
  // Finder "Compress" zip leaves `__MACOSX/` as a sibling of the user's
  // folder; `detectSingleTopLevelFolder` then sees two roots and refuses to
  // strip, the user's SKILL.md ends up nested, and parsing fails with a
  // misleading "missing SKILL.md" error. Mirrored on the server in
  // `convex/skills/bundle_zip.ts:isOsMetadataEntry`.
  const rawEntries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (rawEntries.length === 0) {
    return refusal('emptyZip');
  }
  if (rawEntries.length > MAX_SKILL_BUNDLE_FILES) {
    return refusal('tooManyEntries', {
      count: rawEntries.length,
      max: MAX_SKILL_BUNDLE_FILES,
    });
  }

  const stripPrefix = detectSingleTopLevelFolder(rawEntries);

  let skillMdEntry: JSZip.JSZipObject | undefined;
  const assets: { relPath: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of rawEntries) {
    if (entry.dir) continue;
    const rel = stripPrefix ? name.slice(stripPrefix.length) : name;
    if (rel === '') continue;
    if (rel.includes('\0')) {
      return refusal('unsafePath', { path: rel });
    }
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      return refusal('absolutePath', { path: rel });
    }
    const segments = rel.split('/');
    for (const seg of segments) {
      if (seg === '' || seg === '..' || seg === '.') {
        return refusal('unsafePath', { path: rel });
      }
    }
    if (rel === 'SKILL.md') {
      skillMdEntry = entry;
      continue;
    }
    if (segments.some((s) => s.startsWith('.'))) continue;
    assets.push({ relPath: rel, entry });
  }

  if (!skillMdEntry) {
    return refusal('missingSkillMd');
  }

  const skillMdContent = await skillMdEntry.async('string');
  let meta;
  try {
    ({ meta } = parseSkillMd(skillMdContent, 'SKILL.md'));
  } catch (err) {
    return refusal('frontmatterRejected', {
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const slug = meta.name;
  if (!isValidSkillSlug(slug)) {
    return refusal('invalidSlug', { slug });
  }

  const skillMdBytes = new TextEncoder().encode(skillMdContent).length;
  if (skillMdBytes > MAX_SKILL_BUNDLE_FILE_BYTES) {
    return refusal('skillMdTooLarge', {
      max: formatKB(MAX_SKILL_BUNDLE_FILE_BYTES),
    });
  }
  let totalBytes = skillMdBytes;

  const assetMeta: ParsedSkillBundleFile[] = [];
  for (const { relPath, entry } of assets) {
    const buf = await entry.async('uint8array');
    if (buf.length > MAX_SKILL_BUNDLE_FILE_BYTES) {
      return refusal('assetTooLarge', {
        path: relPath,
        max: formatKB(MAX_SKILL_BUNDLE_FILE_BYTES),
      });
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      return refusal('totalTooLarge', {
        max: formatMB(MAX_SKILL_BUNDLE_TOTAL_BYTES),
      });
    }
    assetMeta.push({ relPath, size: buf.length });
  }

  assetMeta.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return {
    success: true,
    data: {
      zipFile: file,
      slug,
      meta,
      assets: assetMeta,
      totalBytes,
    },
  };
}

function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

function detectSingleTopLevelFolder(
  entries: [string, JSZip.JSZipObject][],
): string | null {
  let prefix: string | null = null;
  for (const [name] of entries) {
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

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
