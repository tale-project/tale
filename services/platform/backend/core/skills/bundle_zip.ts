'use node';

/**
 * Decoding an uploaded skill-bundle zip into the in-memory shape the write
 * path persists. Re-validates every constraint the client checked: SKILL.md
 * must exist at the bundle root, its frontmatter must parse, the slug must
 * validate, no zip-slip paths, per-file and total caps. The client's own
 * parse step is UX only — this module is the authoritative check.
 *
 * The caps are enforced BEFORE inflation, twice over. The central directory's
 * declared sizes gate first: DEFLATE runs past 1000:1 on repetitive input, so
 * a 32 KB upload can declare gigabytes, and materializing even one such entry
 * "to measure it" is the bomb going off (the process dies at the typed-array
 * ceiling long before any post-hoc length check). Then every entry inflates
 * through a size-limited sink, so a header that lies about its size is cut
 * off at the cap instead of trusted.
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

/**
 * The DECLARED uncompressed size of a loaded entry — the central directory's
 * word, readable before a single byte is inflated. JSZip keeps it on the
 * entry's internal `CompressedObject` (`_data.uncompressedSize`) for every
 * entry `loadAsync` produced with content; an entry declared empty is
 * normalized to a plain string and carries no such object, so it answers
 * `null`. Callers treat `null` as "declares nothing" and rely on the
 * size-limited sink for the actual bytes — the header is the cheap first
 * gate, never the only one.
 */
export function declaredUncompressedSize(
  entry: JSZip.JSZipObject,
): number | null {
  const data: unknown = Reflect.get(entry, '_data');
  if (data === null || typeof data !== 'object') return null;
  if (!('uncompressedSize' in data)) return null;
  const size: unknown = Reflect.get(data, 'uncompressedSize');
  return typeof size === 'number' && Number.isFinite(size) && size >= 0
    ? size
    : null;
}

interface Destroyable {
  destroy(): void;
}

function isDestroyable(value: object): value is Destroyable {
  return typeof Reflect.get(value, 'destroy') === 'function';
}

/**
 * Inflate one entry through a size-limited sink: chunks accumulate until
 * `cap`, then the stream is stopped and the entry refused — a header that
 * lies about its size (declares ten bytes, inflates to gigabytes) is cut off
 * within one inflate burst of the cap instead of being materialized whole.
 * (`entry.async()` buffers the entire output before JSZip's own length check
 * fires, which is exactly the allocation a bomb is after.)
 */
function inflateCapped(
  entry: JSZip.JSZipObject,
  cap: number,
  refusal: () => AppError,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const stream = entry.nodeStream('nodebuffer');
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      outcome();
    };
    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > cap) {
        settle(() => {
          // Stop pulling: once the adapter's buffer fills it pauses the
          // inflate worker, so no further chunk is produced.
          stream.pause();
          if (isDestroyable(stream)) stream.destroy();
          reject(refusal());
        });
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error: unknown) => settle(() => reject(error)));
    stream.on('end', () => settle(() => resolve(Buffer.concat(chunks))));
  });
}

function fileTooLarge(relPath: string, declared?: number): AppError {
  return new AppError({
    code: 'FILE_TOO_LARGE',
    message:
      declared === undefined
        ? `"${relPath}" exceeds per-file cap of ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`
        : `"${relPath}" declares ${declared} bytes (per-file cap ${MAX_SKILL_BUNDLE_FILE_BYTES})`,
  });
}

function bundleTooLarge(): AppError {
  return new AppError({
    code: 'BUNDLE_TOO_LARGE',
    message: `Decompressed bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes`,
  });
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

  // Declared sizes gate BEFORE any inflation — per entry and in total.
  let declaredTotal = 0;
  for (const { relPath, entry } of [
    { relPath: 'SKILL.md', entry: skillMdEntry },
    ...assetEntries,
  ]) {
    const declared = declaredUncompressedSize(entry) ?? 0;
    if (declared > MAX_SKILL_BUNDLE_FILE_BYTES) {
      throw fileTooLarge(relPath, declared);
    }
    declaredTotal += declared;
    if (declaredTotal > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      throw bundleTooLarge();
    }
  }

  const skillMdContent = (
    await inflateCapped(skillMdEntry, MAX_SKILL_BUNDLE_FILE_BYTES, () =>
      fileTooLarge('SKILL.md'),
    )
  ).toString('utf-8');
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
    throw fileTooLarge('SKILL.md');
  }
  totalBytes += skillMdBuf.length;
  files.push({ relPath: 'SKILL.md', content: skillMdBuf });

  for (const { relPath, entry } of assetEntries) {
    // The sink refuses at the cap, so the actual size can only be re-checked
    // for the running total here.
    const assetBuf = await inflateCapped(
      entry,
      MAX_SKILL_BUNDLE_FILE_BYTES,
      () => fileTooLarge(relPath),
    );
    totalBytes += assetBuf.length;
    if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      throw bundleTooLarge();
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
