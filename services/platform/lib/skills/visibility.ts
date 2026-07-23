/**
 * Who may see and who may change a skill.
 *
 * The whole sharing model lives in two frontmatter fields. `visibility:
 * private` means the bundle belongs to one member — nobody else in the org
 * sees it in a listing, reaches it from an agent turn, or can edit it.
 * `visibility: org` means the whole organization sees it. "Sharing" is
 * therefore an ordinary edit of the file: flip `private` → `org`. There is no
 * share table, no grant row and no per-viewer rendering path.
 *
 * Cross-organization isolation is NOT this module's job and is not
 * expressible here: a skill only ever exists inside one org's config tree, so
 * a reader that resolves the wrong org's directory is the only way to leak
 * one. Callers resolve the directory from a membership-verified org.
 *
 * Pure: no filesystem, no Convex.
 */

import type { SkillVisibility } from '../shared/schemas/skills';

/** The fields of a skill that decide who may see or change it. */
export interface SkillAccessSubject {
  readonly visibility: SkillVisibility;
  readonly owner?: string;
}

/** The member asking for a skill, already verified as an org member. */
export interface SkillViewer {
  /** The member's user id, matched against a private skill's `owner`. */
  readonly userId: string;
  /**
   * True when the member may administer the org's shared configuration.
   * Org-visible skills are org configuration, so only an administrator edits
   * one; every member may still read it.
   */
  readonly isOrgAdmin?: boolean;
}

/** True when `viewer` may read `skill` and see it in a listing. */
export function canViewSkill(
  skill: SkillAccessSubject,
  viewer: SkillViewer,
): boolean {
  if (skill.visibility === 'org') return true;
  return skill.owner !== undefined && skill.owner === viewer.userId;
}

/**
 * True when `viewer` may edit, rename the visibility of, or delete `skill`.
 * An owner always may. An org-visible skill additionally answers to org
 * administrators, so a member who leaves cannot strand shared knowledge.
 */
export function canEditSkill(
  skill: SkillAccessSubject,
  viewer: SkillViewer,
): boolean {
  if (skill.owner !== undefined && skill.owner === viewer.userId) return true;
  return skill.visibility === 'org' && viewer.isOrgAdmin === true;
}

/** Keep only the skills `viewer` may see, preserving the input order. */
export function filterVisibleSkills<T extends SkillAccessSubject>(
  skills: readonly T[],
  viewer: SkillViewer,
): T[] {
  return skills.filter((skill) => canViewSkill(skill, viewer));
}
