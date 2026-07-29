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

import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import {
  isSkillBundleExcludedSegment,
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
 * Resolve one bundle's directory for reading: `null` when the org has no
 * such bundle, a symlink-refusing, realpath-verified path otherwise.
 */
async function resolveExistingBundleDir(
  orgSlug: string,
  slug: string,
): Promise<string | null> {
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
  return skillDir;
}

/**
 * Walk one bundle's files depth-first, refusing symlinks anywhere and
 * skipping the shared excluded segments — build/dependency residue and
 * dot-entries are tooling leftovers around the bundle's source (the shipped
 * visual-aspect-analyzer carries `.turbo/`, an org-authored TS skill may
 * grow `node_modules/`), not knowledge the skill teaches; dependencies are
 * the sandbox image's job, never staged bytes. `visitFile` receives each
 * regular file's absolute path and bundle-relative POSIX path.
 */
async function walkBundleFiles(
  skillDir: string,
  visitFile: (absPath: string, relPath: string) => Promise<void>,
): Promise<void> {
  async function walk(dir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isSkillBundleExcludedSegment(entry.name)) continue;
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
      await visitFile(absPath, relPath);
    }
  }
  await walk(skillDir, '');
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
  const skillDir = await resolveExistingBundleDir(orgSlug, slug);
  if (skillDir === null) return null;

  const files: SkillBundleFileContent[] = [];
  let totalBytes = 0;

  await walkBundleFiles(skillDir, async (absPath, relPath) => {
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
  });

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

/** One file of a bundle named without its bytes. */
export interface SkillBundleFileEntry {
  readonly path: string;
  readonly size: number;
}

/**
 * The names and sizes of one bundle's files, sorted by path, for showing a
 * bundle's contents without reading a byte of them. Returns `null` when the
 * org has no such bundle. Applies the same exclusion and symlink rules as
 * {@link readSkillBundleFiles}, so it lists exactly what staging would ship.
 */
export async function listSkillBundleFileEntries(
  orgSlug: string,
  slug: string,
): Promise<SkillBundleFileEntry[] | null> {
  const skillDir = await resolveExistingBundleDir(orgSlug, slug);
  if (skillDir === null) return null;

  const entries: Array<{ path: string; size: number }> = [];
  await walkBundleFiles(skillDir, async (absPath, relPath) => {
    if (entries.length >= MAX_SKILL_BUNDLE_FILES) {
      throw new Error(
        `${skillDir}: bundle exceeds ${MAX_SKILL_BUNDLE_FILES} files`,
      );
    }
    const stats = await lstat(absPath);
    entries.push({ path: relPath, size: stats.size });
  });

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/**
 * True when `relPath` names a file the bundle walk could have produced: a
 * relative POSIX path whose segments are plain names — no traversal, no
 * dot-entries, none of the excluded directories.
 */
function isSafeBundleRelPath(relPath: string): boolean {
  if (relPath.length === 0 || relPath.includes('\0')) return false;
  if (relPath.includes('\\') || relPath.startsWith('/')) return false;
  const segments = relPath.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      !isSkillBundleExcludedSegment(segment),
  );
}

/**
 * One named file of a bundle, base64-encoded, or `null` when the bundle or
 * the file does not exist. A path the walk would never produce reads as
 * absent rather than throwing — the file tree is the only legitimate source
 * of paths, so anything else is a probe, not a mistake to explain.
 */
export async function readSkillBundleAsset(
  orgSlug: string,
  slug: string,
  relPath: string,
): Promise<SkillBundleFileContent | null> {
  if (!isSafeBundleRelPath(relPath)) return null;
  const skillDir = await resolveExistingBundleDir(orgSlug, slug);
  if (skillDir === null) return null;

  const filePath = safeJoinWithinDir(skillDir, relPath);
  let stats;
  try {
    stats = await lstat(filePath);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return null;
    throw err;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`${filePath}: skill bundle contains a symlink`);
  }
  if (!stats.isFile()) return null;
  if (stats.size > MAX_SKILL_BUNDLE_FILE_BYTES) {
    throw new Error(
      `${filePath}: bundle file exceeds ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
    );
  }
  await verifyPathWithinBase(filePath, skillDir);
  const content = await readFile(filePath);
  return { path: relPath, contentBase64: content.toString('base64') };
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

/** One file of a bundle about to be written. */
export interface SkillBundleFileWrite {
  /** Bundle-relative POSIX path, already validated by the zip parser. */
  readonly path: string;
  readonly content: Buffer;
}

/**
 * Write a WHOLE bundle — `SKILL.md` plus assets — replacing whatever the
 * slug currently holds.
 *
 * The write is a stage-then-rename swap: files land in a
 * `<slug>.staging-<8hex>` sibling first (the dot fails the slug shape, so
 * {@link listSkillSlugs} structurally never lists a half-written bundle),
 * then the current bundle moves aside and the staging directory takes its
 * name — with the aside-move rolled back if the commit rename fails, so the
 * previous bundle survives every failure before the commit point.
 *
 * The superseded `SKILL.md` is snapshotted into the domain's history trail
 * like every editor save; assets are not historied (size), which the
 * history viewer's contract already states.
 *
 * Callers serialize concurrent writes per (org, slug) themselves — the
 * upload action holds its claim-row lock around this call.
 */
export async function writeSkillBundleFiles(
  orgSlug: string,
  slug: string,
  files: readonly SkillBundleFileWrite[],
): Promise<void> {
  const bundleDir = resolveSkillDir(orgSlug, slug);
  const skillsRoot = resolveSkillsDir(orgSlug);
  await mkdir(skillsRoot, { recursive: true });

  // Snapshot the current SKILL.md before it is replaced. A bundle whose
  // document is unreadable (malformed is fine — unreadable means symlinked
  // or oversized) just skips the snapshot: the upload is the repair.
  let current: string | null = null;
  try {
    current = await readSkillMdText(orgSlug, slug);
  } catch (err) {
    console.warn(
      `[skills] ${orgSlug}/${slug}: skipping history snapshot of unreadable SKILL.md:`,
      err instanceof Error ? err.message : err,
    );
  }
  if (current !== null) {
    const historyDir = resolveSkillHistoryDir(orgSlug, slug);
    await atomicWrite(
      path.join(historyDir, `${generateHistoryTimestamp()}.md`),
      current,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  }

  const stagingDir = `${bundleDir}.staging-${randomUUID().slice(0, 8)}`;
  const replacingDir = `${bundleDir}.replacing-${randomUUID().slice(0, 8)}`;

  try {
    // Realpath the staging root once so every per-file check compares
    // like against like (macOS tmp trees sit behind a `/var → /private/var`
    // symlink, where a mixed resolved/unresolved comparison always fails).
    await mkdir(stagingDir, { recursive: true });
    const realStagingDir = await realpath(stagingDir);
    for (const file of files) {
      if (!isSafeBundleRelPath(file.path)) {
        throw new Error(`unsafe bundle path: ${file.path}`);
      }
      const dest = path.join(realStagingDir, file.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await verifyPathWithinBase(dest, realStagingDir);
      await atomicWriteBuffer(dest, file.content);
    }

    // Atomic swap. Once `bundleDir → replacingDir` succeeds, the old bundle
    // is preserved; the next rename is the commit point.
    let hadExisting = true;
    try {
      await rename(bundleDir, replacingDir);
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') throw err;
      hadExisting = false;
    }
    try {
      await rename(stagingDir, bundleDir);
    } catch (err) {
      // Roll back the aside-move so the user still has the old content.
      // Best-effort: log and rethrow.
      if (hadExisting) {
        await rename(replacingDir, bundleDir).catch((rollbackErr) => {
          console.error(
            '[skills] failed to roll back previous bundle:',
            rollbackErr,
          );
        });
      }
      throw err;
    }
    if (hadExisting) {
      await rm(replacingDir, { recursive: true, force: true }).catch((err) => {
        // Data is safe at this point; an orphaned `.replacing-*` is a leak
        // for ops to clean up, not a correctness issue.
        console.warn(
          '[skills] failed to remove replaced bundle dir; leaving for manual cleanup:',
          err,
        );
      });
    }
  } catch (err) {
    // Pre-commit failure path: clean up staging, surface the error.
    await rm(stagingDir, { recursive: true, force: true }).catch(
      (cleanupErr) => {
        console.warn('[skills] staging cleanup failed:', cleanupErr);
      },
    );
    throw err;
  }
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
