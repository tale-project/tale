'use node';

/**
 * Decoding an uploaded skill-bundle zip into the in-memory shape the write
 * path persists. Re-validates every constraint the client checked: SKILL.md
 * must exist at the bundle root, its frontmatter must parse, the slug must
 * validate, no zip-slip paths, per-file and total caps. The client's own
 * parse step is UX only — this module is the authoritative check.
 *
 * Accepts the common "one wrapper folder" shape browsers and folder picks
 * produce when a user zips a directory: if every entry shares a single
 * top-level folder, that folder is stripped before further processing.
 */

import JSZip from 'jszip';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_FILES,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
  isValidSkillSlug,
  type SkillFrontmatter,
} from '../../../lib/shared/schemas/skills';
import { parseSkillMd } from '../../../lib/skills/parse';

export interface ParsedBundleFile {
  /** Path relative to the bundle root (no leading slash, POSIX separators). */
  relPath: string;
  content: Buffer;
}

export interface ParsedBundle {
  slug: string;
  meta: SkillFrontmatter;
  /** The SKILL.md markdown body. */
  body: string;
  /** Includes SKILL.md as the first entry. */
  files: ParsedBundleFile[];
  /** Total bytes of the bundle (SKILL.md + all assets). */
  totalBytes: number;
}

/**
 * Drop OS-injected metadata entries that would otherwise pollute the
 * bundle. Mirrored on the client in `parse-skill-bundle.ts`. macOS Finder's
 * "Compress" produces a sibling `__MACOSX/` tree alongside the user's
 * folder; if it survived to `detectSingleTopLevelFolder` it would defeat
 * the wrapper-strip and the user's `myskill/SKILL.md` would look nested —
 * failing with a misleading "missing SKILL.md".
 */
export function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

export function detectSingleTopLevelFolder(
  entries: [string, JSZip.JSZipObject][],
): string | null {
  let prefix: string | null = null;
  for (const [name] of entries) {
    if (name === '') continue;
    const slash = name.indexOf('/');
    if (slash === -1) return null; // a root-level file disqualifies stripping
    const top = name.slice(0, slash + 1);
    if (prefix === null) {
      prefix = top;
    } else if (prefix !== top) {
      return null;
    }
  }
  return prefix;
}

/** Decode and validate one uploaded zip. Throws `AppError` on refusal. */
export async function parseSkillBundleZip(buf: Buffer): Promise<ParsedBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    throw new AppError({
      code: 'INVALID_BUNDLE',
      message: `Not a valid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const rawEntries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (rawEntries.length === 0) {
    throw new AppError({
      code: 'INVALID_BUNDLE',
      message: 'Zip is empty',
    });
  }
  if (rawEntries.length > MAX_SKILL_BUNDLE_FILES) {
    throw new AppError({
      code: 'INVALID_BUNDLE',
      message: `Bundle contains ${rawEntries.length} entries (max ${MAX_SKILL_BUNDLE_FILES})`,
    });
  }

  const stripPrefix = detectSingleTopLevelFolder(rawEntries);

  let skillMdEntry: JSZip.JSZipObject | undefined;
  const assetEntries: { relPath: string; entry: JSZip.JSZipObject }[] = [];

  for (const [name, entry] of rawEntries) {
    if (entry.dir) continue;
    const rel = stripPrefix ? name.slice(stripPrefix.length) : name;
    if (rel === '') continue;
    if (rel.includes('\0')) {
      throw new AppError({
        code: 'INVALID_BUNDLE',
        message: `Bundle entry path contains NUL byte`,
      });
    }
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      throw new AppError({
        code: 'INVALID_BUNDLE',
        message: `Bundle entry uses absolute path: ${rel}`,
      });
    }
    const segments = rel.split('/');
    for (const seg of segments) {
      if (seg === '' || seg === '..' || seg === '.') {
        throw new AppError({
          code: 'INVALID_BUNDLE',
          message: `Bundle entry path is unsafe: ${rel}`,
        });
      }
    }
    if (rel === 'SKILL.md') {
      skillMdEntry = entry;
      continue;
    }
    // Skip dotfiles silently (matches the bundle walk's listing behavior).
    if (segments.some((s) => s.startsWith('.'))) continue;
    assetEntries.push({ relPath: rel, entry });
  }

  if (!skillMdEntry) {
    throw new AppError({
      code: 'MISSING_SKILL_MD',
      message: 'Bundle is missing SKILL.md at the root',
    });
  }

  const skillMdContent = await skillMdEntry.async('string');
  let meta: SkillFrontmatter;
  let body: string;
  try {
    ({ meta, body } = parseSkillMd(skillMdContent, 'SKILL.md'));
  } catch (err) {
    throw new AppError({
      code: 'INVALID_SKILL_MD',
      message: `SKILL.md frontmatter rejected: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const slug = meta.name;
  if (!isValidSkillSlug(slug)) {
    throw new AppError({
      code: 'INVALID_SKILL_SLUG',
      message: `Frontmatter name "${slug}" is not a valid skill slug`,
    });
  }

  const files: ParsedBundleFile[] = [];
  let totalBytes = 0;
  const skillMdBuf = Buffer.from(skillMdContent, 'utf-8');
  if (skillMdBuf.length > MAX_SKILL_BUNDLE_FILE_BYTES) {
    throw new AppError({
      code: 'FILE_TOO_LARGE',
      message: `SKILL.md exceeds per-file cap of ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
    });
  }
  totalBytes += skillMdBuf.length;
  files.push({ relPath: 'SKILL.md', content: skillMdBuf });

  for (const { relPath, entry } of assetEntries) {
    const assetBuf = Buffer.from(await entry.async('uint8array'));
    if (assetBuf.length > MAX_SKILL_BUNDLE_FILE_BYTES) {
      throw new AppError({
        code: 'FILE_TOO_LARGE',
        message: `Asset "${relPath}" exceeds per-file cap of ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
      });
    }
    totalBytes += assetBuf.length;
    if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      throw new AppError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Decompressed bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }
    files.push({ relPath, content: assetBuf });
  }

  return {
    slug,
    meta,
    body,
    files,
    totalBytes,
  };
}
