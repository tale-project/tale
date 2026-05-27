'use node';

/**
 * Skill file utilities.
 *
 * Pure helpers for resolving paths, validating slugs/asset paths, and
 * reading/serializing SKILL.md content. Mirrors the pattern in
 * agents/file_utils.ts and integrations/file_utils.ts but uses Markdown +
 * YAML frontmatter as the wire format (per agentskills.io spec).
 *
 * Org isolation: every org's skills live under
 * `${TALE_CONFIG_DIR}/<orgSlug>/skills/` — uniform org-first layout. Every
 * resolver applies a path-traversal guard plus a `verifyPathWithinBase`
 * realpath check so symlinks planted in the bundle cannot escape the
 * skill's directory.
 */

import { constants, lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import {
  parseSkillMd,
  frontmatterToRaw,
  MAX_SKILL_BUNDLE_ENTRIES,
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
  RESERVED_SKILL_NAMES,
  SKILL_NAME_REGEX,
  type SkillFrontmatter,
} from '../../lib/shared/schemas/skills';
import { sha256, validateOrgSlug, verifyPathWithinBase } from '../lib/file_io';

/**
 * Names reserved by the SKILL.md frontmatter schema. Duplicated here so
 * `validateSkillSlug` enforces the same set at action-arg boundaries (where
 * the SKILL.md isn't read yet, but the slug is used to resolve paths).
 */
// Re-import the canonical reserved-name set from the shared schema so
// the runtime's lookup table cannot drift from what `parseSkillMd`
// refuses. Earlier this file maintained a near-identical local Set with
// an apologetic comment; that's the wrong dedup tradeoff.
const RESERVED_SKILL_SLUGS = RESERVED_SKILL_NAMES;

export { sha256, parseSkillMd };
export type { SkillFrontmatter };

/**
 * Skill slug — re-exported via the schemas module so a single source of
 * truth governs every validation site (runtime, frontend, schema). The
 * local alias keeps existing call sites unchanged.
 */
const SKILL_SLUG_REGEX = SKILL_NAME_REGEX;
const MAX_SLUG_LENGTH = 64;

/**
 * Canonical bundle subdirectories per agentskills.io spec. Skills may store
 * assets under any of these (or directly in the skill root) — the runtime
 * does not enforce a specific layout, this constant just documents intent.
 */
export const SKILL_BUNDLE_SUBDIRS = [
  'scripts',
  'references',
  'assets',
] as const;

// Bundle-size constants live in `lib/shared/schemas/skills.ts` so both the
// browser-side zip parser and the server-side action enforce identical caps
// without the browser having to pull in any Node-only modules from here.
export {
  MAX_SKILL_BUNDLE_ENTRIES,
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
};

export type SkillReadResult =
  | {
      ok: true;
      meta: SkillFrontmatter;
      body: string;
      versionHash: string;
    }
  | {
      ok: false;
      error: 'not_found' | 'corrupted' | 'symlink' | 'inaccessible';
      message: string;
    };

export function validateSkillSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return false;
  if (!SKILL_SLUG_REGEX.test(slug)) return false;
  if (RESERVED_SKILL_SLUGS.has(slug)) return false;
  return true;
}

function getConfigRoot(): string {
  const configDir = process.env.TALE_CONFIG_DIR;
  if (configDir) return configDir;
  throw new Error(
    'TALE_CONFIG_DIR environment variable is not set. ' +
      'Set it to the root config directory ' +
      '(e.g., TALE_CONFIG_DIR=/path/to/tale/examples).',
  );
}

/**
 * Resolve the skills directory for an organization. Org-first:
 * `${TALE_CONFIG_DIR}/<orgSlug>/skills/`.
 */
export function resolveSkillsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot(), orgSlug, 'skills');
}

export function resolveSkillDir(orgSlug: string, slug: string): string {
  if (!validateSkillSlug(slug)) {
    throw new Error(`Invalid skill slug: ${slug}`);
  }
  const dir = resolveSkillsDir(orgSlug);
  const resolved = path.resolve(dir, slug);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${slug}`);
  }
  return resolved;
}

export function resolveSkillMdPath(orgSlug: string, slug: string): string {
  return path.join(resolveSkillDir(orgSlug, slug), 'SKILL.md');
}

/**
 * Resolve a bundle-asset path, guarding against every flavor of traversal:
 * absolute paths, `..` segments, leading-`.` segments, Windows drive
 * letters, NUL bytes, oversized paths. The caller MUST `await
 * verifyPathWithinBase(resolved, skillDir)` before any I/O — see
 * {@link resolveSkillAssetPathChecked} for the safe variant.
 */
export function resolveSkillAssetPath(
  orgSlug: string,
  slug: string,
  relPath: string,
): string {
  validateAssetRelPath(relPath);
  const skillDir = resolveSkillDir(orgSlug, slug);
  const resolved = path.resolve(skillDir, relPath);
  const expectedPrefix = path.resolve(skillDir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${relPath}`);
  }
  // Case-fold the SKILL.md lockout — on case-insensitive filesystems (macOS
  // default, Windows) `skill.md` resolves to the same inode as `SKILL.md`
  // but a literal `===` compare would miss it.
  const finalSegment = path.basename(resolved);
  if (
    path.dirname(resolved) === expectedPrefix &&
    finalSegment.toLowerCase() === 'skill.md'
  ) {
    throw new Error(
      'SKILL.md is not editable via the asset path; use the skill markdown writer instead',
    );
  }
  return resolved;
}

/**
 * Safe variant of {@link resolveSkillAssetPath} that also realpath-checks
 * the parent directory after resolution. Use this on every read/write of a
 * bundle file so a symlink planted as an intermediate directory cannot
 * escape the skill root.
 */
export async function resolveSkillAssetPathChecked(
  orgSlug: string,
  slug: string,
  relPath: string,
): Promise<string> {
  const skillDir = resolveSkillDir(orgSlug, slug);
  const resolved = resolveSkillAssetPath(orgSlug, slug, relPath);
  await verifyPathWithinBase(resolved, skillDir);
  return resolved;
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
  const segments = relPath.split(/[\\/]+/);
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
 * Read a `SKILL.md`, returning the parsed frontmatter + body + content
 * hash. Mirrors the symlink/size/encoding protections of
 * `readJsonFile` but for the markdown shape — and computes
 * `versionHash = sha256(SKILL.md content)` so the runtime snapshot can
 * detect skill drift between bind time and execution time.
 */
export async function readSkillMd(
  orgSlug: string,
  slug: string,
): Promise<SkillReadResult> {
  const skillDir = resolveSkillDir(orgSlug, slug);
  const filePath = resolveSkillMdPath(orgSlug, slug);
  try {
    // Realpath-check the slug directory: defends against a symlink planted
    // at <base>/<slug> that points outside the skills tree. `O_NOFOLLOW`
    // below only protects the final component, not intermediate dirs.
    try {
      await verifyPathWithinBase(skillDir, resolveSkillsDir(orgSlug));
    } catch (err) {
      return {
        ok: false,
        error: 'symlink',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // lstat (not stat) so a symlink at SKILL.md itself surfaces as a
    // symlink check rather than dereferencing through to the target's size.
    const lst = await lstat(filePath).catch((err) => {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        console.warn('[readSkillMd] lstat failed:', filePath, err);
      }
      return null;
    });
    if (lst === null) {
      return { ok: false, error: 'not_found', message: `SKILL.md not found` };
    }
    if (lst.isSymbolicLink()) {
      return {
        ok: false,
        error: 'symlink',
        message: 'SKILL.md is a symlink (rejected)',
      };
    }
    let content: string;
    try {
      const fd = await open(
        filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        content = await fd.readFile('utf-8');
      } finally {
        await fd.close();
      }
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? err.code : undefined;
      if (code === 'ELOOP' || code === 'EMLINK') {
        return {
          ok: false,
          error: 'symlink',
          message: 'SKILL.md is a symlink (rejected)',
        };
      }
      if (code === 'ENOENT') {
        return { ok: false, error: 'not_found', message: 'SKILL.md not found' };
      }
      return {
        ok: false,
        error: 'inaccessible',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const { meta, body } = parseSkillMd(content);
      return {
        ok: true,
        meta,
        body,
        versionHash: sha256(content),
      };
    } catch (err) {
      return {
        ok: false,
        error: 'corrupted',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: 'inaccessible',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Serialize a frontmatter + body pair back into the on-disk SKILL.md
 * format. Round-trips unknown community fields exactly as parsed.
 */
export function serializeSkillMd(meta: SkillFrontmatter, body: string): string {
  const raw = frontmatterToRaw(meta);
  const yamlText = stringifyYaml(raw, {
    lineWidth: 100,
    minContentWidth: 20,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });
  const sep = body.startsWith('\n') ? '' : '\n';
  return `---\n${yamlText}---${sep}${body.endsWith('\n') ? body : body + '\n'}`;
}
