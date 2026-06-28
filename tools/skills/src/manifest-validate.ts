/**
 * Static validation of the skills manifest. Runs first in `skills:check` so a
 * malformed manifest fails with a named error before any disk diff.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SkillManifestEntry, SkillTarget } from './manifest';

/**
 * Kebab-case skill name. Duplicated from the platform's canonical skill-slug
 * pattern (`services/platform/lib/shared/schemas/`) rather than cross-importing
 * across the workspace boundary — a one-line regex is not worth a dependency on
 * `@tale/platform` internals.
 */
const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const VALID_TARGETS: ReadonlySet<SkillTarget> = new Set<SkillTarget>([
  'claude',
  'builtin',
]);

/**
 * Names of the hand-authored coding-guide skills in `.claude/skills/` at this
 * system's introduction. A `claude`-target manifest skill may not reuse one of
 * these: the sync would overwrite (and, on stale-file deletion, damage) the
 * hand-authored guide. Migrating a guide into `skills/` on purpose means
 * consciously removing its name from this list.
 */
export const RESERVED_CLAUDE_NAMES: ReadonlySet<string> = new Set([
  'auth-schema',
  'bash',
  'browser-qa',
  'clean-code',
  'convex',
  'convex-migrations',
  'debug',
  'definition-of-done',
  'docker',
  'docs',
  'docs-check',
  'engineering-approach',
  'git',
  'handoff',
  'performance',
  'plan',
  'python',
  'react',
  'release',
  'review',
  'security',
  'ship',
  'testing',
  'translation',
  'typescript',
  'ui-components',
  'verify',
  'write-skill',
]);

/**
 * Validate the manifest against a repo root. Throws an Error naming the first
 * problem (so CI fails fast). Checks: kebab-case name, ≥1 valid non-duplicate
 * target, no duplicate skill names, a real `skills/<name>/SKILL.md`, and no
 * reserved `claude` collision.
 */
export function validateManifest(
  manifest: readonly SkillManifestEntry[],
  repoRoot: string,
): void {
  const seenNames = new Set<string>();

  for (const { name, targets } of manifest) {
    if (!SKILL_NAME_REGEX.test(name)) {
      throw new Error(
        `skills manifest: invalid skill name "${name}" (must be kebab-case)`,
      );
    }
    if (seenNames.has(name)) {
      throw new Error(`skills manifest: duplicate skill name "${name}"`);
    }
    seenNames.add(name);

    if (targets.length === 0) {
      throw new Error(`skills manifest: skill "${name}" has no targets`);
    }
    const targetSet = new Set<SkillTarget>();
    for (const target of targets) {
      if (!VALID_TARGETS.has(target)) {
        throw new Error(
          `skills manifest: skill "${name}" has invalid target "${target}"`,
        );
      }
      if (targetSet.has(target)) {
        throw new Error(
          `skills manifest: skill "${name}" lists target "${target}" twice`,
        );
      }
      targetSet.add(target);
    }

    if (targetSet.has('claude') && RESERVED_CLAUDE_NAMES.has(name)) {
      throw new Error(
        `skills manifest: skill "${name}" targets 'claude' but collides with the ` +
          `hand-authored .claude/skills/${name} guide. Rename the skill, or — if you ` +
          `are deliberately migrating that guide — remove "${name}" from RESERVED_CLAUDE_NAMES.`,
      );
    }

    const skillMd = join(repoRoot, 'skills', name, 'SKILL.md');
    if (!existsSync(skillMd)) {
      throw new Error(
        `skills manifest: skill "${name}" has no skills/${name}/SKILL.md`,
      );
    }

    // The SKILL.md `name` MUST equal the directory name exactly. The name is the
    // skill's identity everywhere it ships, so a repo/org skill of the same name
    // (`.claude/skills/pptx`, or an org-uploaded `pptx`) overrides the builtin
    // (`builtin-configs/skills/pptx`) by an exact-name match — at sandbox-staging
    // time and at chat upload-overwrite time alike. A renamed or prefixed builtin
    // would silently dodge that precedence, so it is a hard error.
    const frontmatterName = readSkillName(readFileSync(skillMd, 'utf8'));
    if (frontmatterName !== name) {
      throw new Error(
        `skills manifest: skills/${name}/SKILL.md frontmatter name is ` +
          `${frontmatterName === null ? 'missing' : `"${frontmatterName}"`}, but it must ` +
          `exactly equal the directory name "${name}" — the skill's identity for ` +
          `repo/org-over-builtin precedence.`,
      );
    }
  }
}

/** Extract the frontmatter `name:` value from a SKILL.md (null if absent). */
function readSkillName(md: string): string | null {
  if (!md.startsWith('---')) return null;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return null;
  for (const line of md.slice(3, end).split('\n')) {
    const match = /^name:\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}
