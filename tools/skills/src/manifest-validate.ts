/**
 * Static validation of the skills manifest. Runs first in `skills:check` so a
 * malformed manifest fails with a named error before any disk diff.
 */

import { existsSync } from 'node:fs';
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
  }
}
