/**
 * Which skills get staged into a sandbox workspace.
 *
 * When Tale runs an external external agent in a sandbox it copies the
 * organization's skills into the agent's user-level skill directory. The
 * repository checked out in that workspace may ship skills of its own at the
 * project level. The repository is authoritative: on an exact slug collision
 * the checked-out skill stands and Tale withholds its copy, so the agent
 * never loads two bundles claiming the same name and a repository can always
 * override what the platform would otherwise teach it.
 *
 * Slug comparison is exact — a skill's slug IS its identity, and both sides
 * validate against the same kebab-case shape, so there is no case or
 * whitespace folding to do.
 *
 * Pure: a filter over two name sets. Discovering what the repository ships
 * and performing the copy belong to the sandbox layer.
 */

export interface SkillStagingPlan<T> {
  /** Skills Tale stages, in the order they were offered. */
  readonly staged: readonly T[];
  /** Slugs Tale withheld because the repository already provides them. */
  readonly superseded: readonly string[];
}

/**
 * Plan the staging of `taleSkills` against the slugs a checked-out repository
 * already provides. `slugOf` reads a skill's slug so the plan works on
 * whatever shape the caller carries (a resolved bundle, a staging descriptor).
 */
export function planSkillStaging<T>(
  taleSkills: readonly T[],
  slugOf: (skill: T) => string,
  repoSkillSlugs: Iterable<string>,
): SkillStagingPlan<T> {
  const repoSlugs = new Set(repoSkillSlugs);
  const staged: T[] = [];
  const superseded: string[] = [];

  for (const skill of taleSkills) {
    const slug = slugOf(skill);
    if (repoSlugs.has(slug)) {
      superseded.push(slug);
    } else {
      staged.push(skill);
    }
  }
  return { staged, superseded };
}
