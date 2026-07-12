'use node';

/**
 * SCRIPT multi-file staging: collect an org SKILL's declared subtrees so a
 * workflow `run.script` step can stage code + same-package data/schema into the
 * sandbox, not just a single entry file.
 *
 * A `sandbox` script step may declare `useSkills: [{ slug, include }]`. For
 * each entry we read the org skill at `org/skills/<slug>/` (the SAME live source
 * AGENT skill staging reads — see `readSkillForExecution`; resolution never
 * falls back to the template, so a table edited in the org config is picked up
 * on the next run with no rebuild) and stage every file under each `include`
 * subpath to `/user/code/skills/<slug>/<include...>`. A thin frozen entry then
 * `sys.path`-inserts the skill root and imports its modules / reads its tables.
 *
 * `include` is an explicit allowlist (skill-root relative) so a step stages only
 * what it runs (`engine`, `mapping`, `schema`) and never a heavy `tests/` tree.
 * Every entry is path-guarded (no `..`, absolute, drive prefix, leading-dot, or
 * NUL segment) and realpath-checked to stay within the skill dir, so a planted
 * symlink or a crafted include can't escape. Hard caps bound the blast radius;
 * exceeding them FAILS the step loudly rather than silently truncating.
 */

import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { safeJoinWithinDir, verifyPathWithinBase } from '../../lib/file_io';
import { resolveSkillDir, validateSkillSlug } from '../../skills/file_utils';
import type { SessionStageFile } from './helpers/session_client';

export interface StageSkillSpec {
  slug: string;
  /** Skill-root-relative subpaths (file or dir) to stage. */
  include: string[];
}

/** Bound the staged set — a script step stages a focused subtree, not a repo.
 * Exceeding either cap fails the step (never a silent truncation). */
export const STAGE_SKILLS_MAX_FILES = 100;
export const STAGE_SKILLS_MAX_BYTES = 8 * 1024 * 1024;

/** The sandbox dir every staged skill lands under (relative to the session
 * workspace root; the entry runs with cwd `/user/code`). */
export const STAGED_SKILLS_SUBDIR = 'code/skills';

/**
 * Validate one `include` entry as a safe, skill-root-relative subpath. Mirrors
 * the asset-path guard in `skills/file_utils` (kept local so this stays a pure
 * check with no I/O). Returns an error string, or null when safe.
 */
export function validateStageInclude(inc: string): string | null {
  if (inc.length === 0 || inc.length > 200) {
    return 'must be 1..200 characters';
  }
  if (inc.includes('\0')) return 'must not contain NUL bytes';
  if (path.isAbsolute(inc)) return 'must be relative';
  if (/^[A-Za-z]:/.test(inc)) return 'must not contain a drive prefix';
  for (const seg of inc.split(/[\\/]+/)) {
    if (seg === '' || seg === '..') {
      return 'must not contain `..` or empty segments';
    }
    if (seg.startsWith('.')) return 'segments must not start with `.`';
  }
  return null;
}

/** Whether a directory entry name is workspace junk to skip while walking. */
function skipEntry(name: string): boolean {
  return (
    name.startsWith('.') || name === '__pycache__' || name.endsWith('.pyc')
  );
}

/** Recursively collect the plain files under `absDir`, tracking each file's
 * path relative to the skill root (`relBase` seeds it with the include prefix).
 * Skips dotfiles, `__pycache__`, `*.pyc`, and symlinks (never followed). */
async function walkFiles(
  absDir: string,
  relBase: string,
  out: Array<{ abs: string; rel: string }>,
): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipEntry(entry.name)) continue;
    const abs = path.join(absDir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const info = await lstat(abs);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      await walkFiles(abs, rel, out);
      continue;
    }
    if (info.isFile()) out.push({ abs, rel });
  }
}

/**
 * Resolve + walk every requested skill subtree into staged files (inline
 * base64, like AGENT skill staging). Throws with a clear message when a slug is
 * invalid, an include is unsafe / missing, or the caps are exceeded — the
 * caller fails the step before reserving a sandbox slot.
 */
export async function collectStageSkillFiles(
  orgSlug: string,
  useSkills: readonly StageSkillSpec[],
  caps: { maxFiles: number; maxBytes: number } = {
    maxFiles: STAGE_SKILLS_MAX_FILES,
    maxBytes: STAGE_SKILLS_MAX_BYTES,
  },
): Promise<SessionStageFile[]> {
  const files: SessionStageFile[] = [];
  let totalBytes = 0;

  for (const spec of useSkills) {
    if (!validateSkillSlug(spec.slug)) {
      throw new Error(`useSkills: invalid skill slug "${spec.slug}"`);
    }
    if (spec.include.length === 0) {
      throw new Error(`useSkills "${spec.slug}": include must be non-empty`);
    }
    // resolveSkillDir re-validates the slug + lexically joins within the org
    // skills root; verifyPathWithinBase below adds the realpath (symlink) check.
    const skillDir = resolveSkillDir(orgSlug, spec.slug);

    for (const inc of spec.include) {
      const bad = validateStageInclude(inc);
      if (bad) {
        throw new Error(`useSkills "${spec.slug}" include "${inc}": ${bad}`);
      }
      const incAbs = safeJoinWithinDir(skillDir, inc);
      const info = await lstat(incAbs).catch(() => null);
      if (!info || info.isSymbolicLink()) {
        throw new Error(`useSkills "${spec.slug}" include "${inc}" not found`);
      }
      await verifyPathWithinBase(incAbs, skillDir);

      const collected: Array<{ abs: string; rel: string }> = [];
      if (info.isDirectory()) {
        await walkFiles(incAbs, inc, collected);
      } else if (info.isFile()) {
        collected.push({ abs: incAbs, rel: inc });
      }

      for (const file of collected) {
        const buf = await readFile(file.abs);
        totalBytes += buf.length;
        if (files.length + 1 > caps.maxFiles) {
          throw new Error(
            `useSkills exceeds the ${caps.maxFiles}-file cap (skill "${spec.slug}")`,
          );
        }
        if (totalBytes > caps.maxBytes) {
          throw new Error(
            `useSkills exceeds the ${caps.maxBytes}-byte cap (skill "${spec.slug}")`,
          );
        }
        files.push({
          path: `${STAGED_SKILLS_SUBDIR}/${spec.slug}/${file.rel}`,
          contentBase64: buf.toString('base64'),
        });
      }
    }
  }

  return files;
}
