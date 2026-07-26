'use node';

/**
 * On-disk plumbing for the `skills` config domain.
 *
 * Every organization keeps its skills at
 * `${TALE_CONFIG_DIR}/<orgSlug>/skills/<slug>/`, one directory per bundle
 * with a `SKILL.md` at its root and optional small assets beside it. The
 * directory is the whole model: there is no skill row, no sharing table and
 * no per-org catalog index — listing an org's skills means reading its own
 * directory, which is what makes the domain tenant-isolated by construction.
 *
 * Edits keep a trail under `<orgSlug>/skills/.history/<slug>/`, the same
 * mechanism every other file-based domain uses. It sits at the domain root
 * rather than inside the bundle so a skill's own directory stays exactly what
 * gets copied into a sandbox.
 *
 * Path handling is defensive throughout: the org slug and the skill slug are
 * validated before they are joined, joins go through the shared traversal
 * guard, reads refuse symlinks, and a bundle directory is realpath-checked
 * against the domain root so a planted link cannot reach outside the tree.
 */

import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  isValidSkillSlug,
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_FILES,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
  MAX_SKILL_MD_BYTES,
} from '../../lib/shared/schemas/skills';
import type { SkillBundleReader } from '../../lib/skills/listing';
import {
  atomicWrite,
  atomicWriteBuffer,
  errnoCode,
  generateHistoryTimestamp,
  getConfigRoot,
  handleDirReadError,
  pruneHistory,
  readdirSafe,
  readJsonFile,
  removeDirSafe,
  safeJoinWithinDir,
  validateOrgSlug,
  verifyPathWithinBase,
} from '../lib/file_io';

/** The config-domain name — the directory name inside an org's config tree. */
export const SKILLS_CONFIG_DOMAIN = 'skills';

/** The one file every skill bundle must have. */
export const SKILL_DOCUMENT_NAME = 'SKILL.md';

/** How many superseded `SKILL.md` versions to keep per bundle. */
const MAX_HISTORY_ENTRIES = 20;

/** `<orgSlug>/skills/` — the org's skill domain directory. */
export function resolveSkillsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(
    getConfigRoot(SKILLS_CONFIG_DOMAIN),
    orgSlug,
    SKILLS_CONFIG_DOMAIN,
  );
}

/** `<orgSlug>/skills/<slug>/` — one skill bundle. */
export function resolveSkillDir(orgSlug: string, slug: string): string {
  if (!isValidSkillSlug(slug)) {
    throw new Error(`Invalid skill slug: ${slug}`);
  }
  return safeJoinWithinDir(resolveSkillsDir(orgSlug), slug);
}

/** `<orgSlug>/skills/<slug>/SKILL.md`. */
export function resolveSkillMdPath(orgSlug: string, slug: string): string {
  return safeJoinWithinDir(resolveSkillDir(orgSlug, slug), SKILL_DOCUMENT_NAME);
}

/** `<orgSlug>/skills/.history/<slug>/` — superseded versions of one bundle. */
export function resolveSkillHistoryDir(orgSlug: string, slug: string): string {
  if (!isValidSkillSlug(slug)) {
    throw new Error(`Invalid skill slug: ${slug}`);
  }
  return safeJoinWithinDir(
    safeJoinWithinDir(resolveSkillsDir(orgSlug), '.history'),
    slug,
  );
}

/**
 * The bundle slugs present for an org, unsorted. A missing domain directory
 * is an empty library, not an error — the directory is created on demand when
 * the org authors or imports its first skill. Entries that are not directories
 * or whose name is not a valid slug are ignored, which also skips the
 * `.history/` trail and any editor leftovers.
 */
export async function listSkillSlugs(orgSlug: string): Promise<string[]> {
  const skillsDir = resolveSkillsDir(orgSlug);
  const entries = await readdirSafe(skillsDir);
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!isValidSkillSlug(entry)) continue;
    try {
      const stats = await lstat(path.join(skillsDir, entry));
      if (stats.isDirectory()) slugs.push(entry);
    } catch (err) {
      handleDirReadError(err, `listSkillSlugs(${orgSlug})`);
    }
  }
  return slugs;
}

/**
 * The raw `SKILL.md` text of one bundle, or `null` when there is none. A
 * symlinked, oversized or unreadable document throws — silently treating one
 * as absent would hide a broken bundle from the operator who has to fix it.
 */
export async function readSkillMdText(
  orgSlug: string,
  slug: string,
): Promise<string | null> {
  const skillDir = resolveSkillDir(orgSlug, slug);
  const filePath = resolveSkillMdPath(orgSlug, slug);

  // The O_NOFOLLOW read below only protects the final path component, so the
  // bundle directory is checked here: a link planted in place of it would
  // otherwise be followed straight out of the org's tree.
  let bundleStats;
  try {
    bundleStats = await lstat(skillDir);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return null;
    throw err;
  }
  if (bundleStats.isSymbolicLink()) {
    throw new Error(`${skillDir}: skill bundle directory is a symlink`);
  }
  // Belt and braces once the directory is known to exist: realpath it and
  // confirm it still lands inside the domain.
  await verifyPathWithinBase(filePath, resolveSkillsDir(orgSlug));

  const result = await readJsonFile(
    filePath,
    MAX_SKILL_MD_BYTES,
    (content) => content,
  );
  if (result.ok) return result.data;
  if (result.error === 'not_found') return null;
  throw new Error(`${filePath}: ${result.message}`);
}

/** One file of a skill bundle: its bundle-relative POSIX path plus bytes. */
export interface SkillBundleFileContent {
  readonly path: string;
  readonly contentBase64: string;
}

/**
 * Directory names the bundle walk never descends into: build/dependency
 * trees and dot-entries are tooling residue around the bundle's source (the
 * shipped visual-aspect-analyzer carries `.turbo/`, an org-authored TS skill
 * may grow `node_modules/`), not knowledge the skill teaches. Dependencies
 * are the sandbox image's job, never staged bytes.
 */
const BUNDLE_WALK_EXCLUDED_DIRS = new Set(['node_modules', '__pycache__']);

function isBundleWalkExcluded(name: string): boolean {
  return name.startsWith('.') || BUNDLE_WALK_EXCLUDED_DIRS.has(name);
}

/**
 * Every file of one bundle, base64-encoded and sorted by path, for staging
 * into a sandbox session — `SKILL.md` verbatim (frontmatter included) plus
 * its assets, which is what makes the staged copy the bundle "exactly as it
 * is on disk". Returns `null` when the org has no such bundle.
 *
 * Same defensive posture as {@link readSkillMdText}: a symlink anywhere in
 * the bundle throws rather than being skipped, and the walk refuses bundles
 * over the staging caps — an operator has to see a broken or mis-imported
 * bundle, not a silently thinned copy of it.
 */
export async function readSkillBundleFiles(
  orgSlug: string,
  slug: string,
): Promise<SkillBundleFileContent[] | null> {
  const skillDir = resolveSkillDir(orgSlug, slug);

  let bundleStats;
  try {
    bundleStats = await lstat(skillDir);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return null;
    throw err;
  }
  if (bundleStats.isSymbolicLink()) {
    throw new Error(`${skillDir}: skill bundle directory is a symlink`);
  }
  await verifyPathWithinBase(skillDir, resolveSkillsDir(orgSlug));

  const files: SkillBundleFileContent[] = [];
  let totalBytes = 0;

  async function walk(dir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isBundleWalkExcluded(entry.name)) continue;
      const absPath = path.join(dir, entry.name);
      const relPath =
        relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`${absPath}: skill bundle contains a symlink`);
      }
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
        continue;
      }
      if (!entry.isFile()) continue;

      if (files.length >= MAX_SKILL_BUNDLE_FILES) {
        throw new Error(
          `${skillDir}: bundle exceeds ${MAX_SKILL_BUNDLE_FILES} files`,
        );
      }
      const content = await readFile(absPath);
      if (content.byteLength > MAX_SKILL_BUNDLE_FILE_BYTES) {
        throw new Error(
          `${absPath}: bundle file exceeds ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
        );
      }
      totalBytes += content.byteLength;
      if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
        throw new Error(
          `${skillDir}: bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes in total`,
        );
      }
      files.push({ path: relPath, contentBase64: content.toString('base64') });
    }
  }

  await walk(skillDir, '');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

/**
 * A {@link SkillBundleReader} bound to ONE organization. Nothing downstream
 * can widen it to another org: the slug is captured here and every path is
 * resolved from it.
 */
export function createOrgSkillReader(orgSlug: string): SkillBundleReader {
  return {
    listSlugs: () => listSkillSlugs(orgSlug),
    readSkillMd: (slug) => readSkillMdText(orgSlug, slug),
    describe: (slug) => resolveSkillMdPath(orgSlug, slug),
  };
}

/**
 * Write a bundle's `SKILL.md`, keeping the superseded version in the domain's
 * history trail. The write itself is atomic, so a reader never observes a
 * half-written document.
 */
export async function writeSkillMdText(
  orgSlug: string,
  slug: string,
  content: string,
): Promise<void> {
  const filePath = resolveSkillMdPath(orgSlug, slug);
  const current = await readSkillMdText(orgSlug, slug);
  if (current !== null) {
    const historyDir = resolveSkillHistoryDir(orgSlug, slug);
    await atomicWrite(
      path.join(historyDir, `${generateHistoryTimestamp()}.md`),
      current,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  }
  await atomicWrite(filePath, content);
}

function validateAssetRelPath(relPath: string): void {
  if (relPath.length === 0 || relPath.length > 200) {
    throw new Error('Asset path must be 1..200 characters');
  }
  if (relPath.includes('\0')) {
    throw new Error('Asset path must not contain NUL bytes');
  }
  if (path.isAbsolute(relPath)) {
    throw new Error('Asset path must be relative');
  }
  // Reject Windows drive prefixes even on POSIX (defense-in-depth).
  if (/^[A-Za-z]:/.test(relPath)) {
    throw new Error('Asset path must not contain a drive prefix');
  }
  // Split on SINGLE separators so `a//b` surfaces its empty segment instead
  // of being silently collapsed to `a/b`.
  const segments = relPath.split(/[\\/]/);
  for (const seg of segments) {
    if (seg === '' || seg === '..') {
      throw new Error('Asset path must not contain `..` or empty segments');
    }
    if (seg.startsWith('.')) {
      throw new Error('Asset path segments must not start with `.`');
    }
  }
}

/**
 * Resolve a bundle-relative asset path to its absolute location, refusing
 * traversal and the `SKILL.md` slot itself — the document has its own reader
 * and writer, and letting an asset path address it would bypass both the
 * history trail and the frontmatter validation. The lockout is case-folded:
 * on a case-insensitive filesystem `skill.md` is the same inode.
 */
export function resolveSkillAssetPath(
  orgSlug: string,
  slug: string,
  relPath: string,
): string {
  validateAssetRelPath(relPath);
  const skillDir = resolveSkillDir(orgSlug, slug);
  const resolved = safeJoinWithinDir(skillDir, relPath);
  if (
    path.dirname(resolved) === path.resolve(skillDir) &&
    path.basename(resolved).toLowerCase() === 'skill.md'
  ) {
    throw new Error(
      'SKILL.md is not addressable as an asset; use the skill markdown reader/writer instead',
    );
  }
  return resolved;
}

/**
 * Safe variant of {@link resolveSkillAssetPath} that also realpath-checks the
 * resolution. Use it on every READ of a bundle file so a symlink planted as
 * an intermediate directory cannot escape the skill root. (Writes go through
 * {@link writeSkillBundleFiles}, which owns the whole directory.)
 */
export async function resolveSkillAssetPathChecked(
  orgSlug: string,
  slug: string,
  relPath: string,
): Promise<string> {
  const resolved = resolveSkillAssetPath(orgSlug, slug, relPath);
  await verifyPathWithinBase(resolved, resolveSkillDir(orgSlug, slug));
  return resolved;
}

/** One bundle asset as the listing reports it — path and size only. */
export interface SkillBundleAsset {
  readonly path: string;
  readonly size: number;
}

export interface SkillBundleAssetListing {
  /** Sorted by path; `SKILL.md` excluded (reported via {@link skillMdBytes}). */
  readonly assets: SkillBundleAsset[];
  readonly skillMdBytes: number;
}

/**
 * Stat-only twin of {@link readSkillBundleFiles} for the detail page's file
 * tree: every file's path and size without reading a byte of content. Same
 * exclusions and symlink refusals as the content walk, so the tree never
 * lists a file the staging read would refuse. Returns `null` when the org
 * has no such bundle.
 */
export async function listSkillBundleAssets(
  orgSlug: string,
  slug: string,
): Promise<SkillBundleAssetListing | null> {
  const skillDir = resolveSkillDir(orgSlug, slug);

  let bundleStats;
  try {
    bundleStats = await lstat(skillDir);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return null;
    throw err;
  }
  if (bundleStats.isSymbolicLink()) {
    throw new Error(`${skillDir}: skill bundle directory is a symlink`);
  }
  await verifyPathWithinBase(skillDir, resolveSkillsDir(orgSlug));

  const assets: SkillBundleAsset[] = [];
  let skillMdBytes = 0;

  async function walk(dir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isBundleWalkExcluded(entry.name)) continue;
      const absPath = path.join(dir, entry.name);
      const relPath =
        relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`${absPath}: skill bundle contains a symlink`);
      }
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = await stat(absPath);
      if (relPath === SKILL_DOCUMENT_NAME) {
        skillMdBytes = stats.size;
        continue;
      }
      assets.push({ path: relPath, size: stats.size });
    }
  }

  await walk(skillDir, '');
  assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { assets, skillMdBytes };
}

/** One file of a bundle write: bundle-relative POSIX path plus bytes. */
export interface SkillBundleWriteFile {
  readonly path: string;
  readonly content: Uint8Array;
}

/**
 * Replace a skill bundle with exactly the given files — the fan-out writer
 * behind the package upload.
 *
 * Replace, not merge: the superseded `SKILL.md` goes into the domain history
 * trail first, then the bundle directory is removed whole, so an asset the
 * new bundle no longer carries does not linger and poison the next staging
 * read. `SKILL.md` is written LAST — the listing treats a directory without
 * one as not-a-skill, so the bundle is never observable half-written.
 */
export async function writeSkillBundleFiles(
  orgSlug: string,
  slug: string,
  files: readonly SkillBundleWriteFile[],
): Promise<void> {
  const skillMd = files.find((file) => file.path === SKILL_DOCUMENT_NAME);
  if (skillMd === undefined) {
    throw new Error(`skill "${slug}": a bundle write must carry SKILL.md`);
  }
  if (files.length > MAX_SKILL_BUNDLE_FILES) {
    throw new Error(
      `skill "${slug}": bundle exceeds ${MAX_SKILL_BUNDLE_FILES} files`,
    );
  }
  let totalBytes = 0;
  const assetWrites: { resolved: string; content: Uint8Array }[] = [];
  for (const file of files) {
    if (file.content.byteLength > MAX_SKILL_BUNDLE_FILE_BYTES) {
      throw new Error(
        `skill "${slug}": ${file.path} exceeds ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
      );
    }
    totalBytes += file.content.byteLength;
    if (file.path === SKILL_DOCUMENT_NAME) continue;
    // Resolving up front also validates the path — traversal, dotfiles and
    // the case-folded SKILL.md slot all refuse before anything is touched.
    assetWrites.push({
      resolved: resolveSkillAssetPath(orgSlug, slug, file.path),
      content: file.content,
    });
  }
  if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
    throw new Error(
      `skill "${slug}": bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes in total`,
    );
  }

  const current = await readSkillMdText(orgSlug, slug);
  if (current !== null) {
    const historyDir = resolveSkillHistoryDir(orgSlug, slug);
    await atomicWrite(
      path.join(historyDir, `${generateHistoryTimestamp()}.md`),
      current,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  }

  // History (outside the bundle dir) survives; stale assets do not.
  await removeDirSafe(resolveSkillDir(orgSlug, slug));

  for (const write of assetWrites) {
    await atomicWriteBuffer(write.resolved, Buffer.from(write.content));
  }
  await atomicWrite(
    resolveSkillMdPath(orgSlug, slug),
    new TextDecoder().decode(skillMd.content),
  );
}

/**
 * Remove a skill bundle and its history trail. Returns true when a bundle
 * directory was actually removed, so a caller can tell a delete from a no-op.
 */
export async function removeSkillBundle(
  orgSlug: string,
  slug: string,
): Promise<boolean> {
  const removed = await removeDirSafe(resolveSkillDir(orgSlug, slug));
  await removeDirSafe(resolveSkillHistoryDir(orgSlug, slug));
  return removed;
}
