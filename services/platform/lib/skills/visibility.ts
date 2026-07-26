/**
 * Who may see a skill, who may change it, and which surface may equip it.
 *
 * The whole sharing model lives in three frontmatter fields. `visibility:
 * private` means the bundle belongs to one member — nobody else in the org
 * sees it in a listing, reaches it from an agent turn, or can edit it.
 * `visibility: team` shares it with the teams listed in `teams`.
 * `visibility: org` means the whole organization sees it. "Sharing" is
 * therefore an ordinary edit of the file: change `visibility` (and `teams`).
 * There is no share table, no grant row and no per-viewer rendering path.
 *
 * A skill is not always read on behalf of a person. The viewer is a
 * discriminated union of the three identities that ask for skills:
 *
 * - `user` — a member browsing, chatting, or calling the API. Sees org
 *   skills, team skills of teams they belong to, and their own.
 * - `project` — a project's own equipment (its agents, its pinned
 *   automations). A project's identity is its teams: it sees org skills plus
 *   team skills shared with any of its teams. An org-wide project (no teams)
 *   sees org skills only — staging a team skill there would hand team
 *   knowledge to every member the moment anyone runs the agent. A project
 *   never sees a private skill: a project is not a person.
 * - `org` — org-level machinery with no narrower identity (org-wide
 *   automations). Sees org skills only.
 *
 * Cross-organization isolation is NOT this module's job and is not
 * expressible here: a skill only ever exists inside one org's config tree, so
 * a reader that resolves the wrong org's directory is the only way to leak
 * one. Callers resolve the directory from a membership-verified org.
 *
 * Pure: no filesystem, no Convex.
 */

import type { SkillUsageMode, SkillVisibility } from '../shared/schemas/skills';
import { DEFAULT_SKILL_USAGE_MODE } from '../shared/schemas/skills';

/** The fields of a skill that decide who may see or change it. */
export interface SkillAccessSubject {
  readonly visibility: SkillVisibility;
  /** Team ids a `team` skill is shared with; absent on other visibilities. */
  readonly teams?: readonly string[];
  readonly owner?: string;
}

/** A member asking for a skill, already verified as an org member. */
export interface UserSkillViewer {
  readonly kind: 'user';
  /** The member's user id, matched against a skill's `owner`. */
  readonly userId: string;
  /**
   * Ids of every team the member belongs to. Mutable array type (not
   * `readonly string[]`) because the same shape crosses Convex validators,
   * which cannot express readonly arrays.
   */
  readonly teamIds: string[];
  /**
   * True when the member may administer the org's shared configuration.
   * Team- and org-visible skills are shared configuration, so an
   * administrator sees and edits them all; private skills stay the owner's
   * alone even from an administrator's seat.
   */
  readonly isOrgAdmin: boolean;
}

/** A project's own equipment asking for a skill. */
export interface ProjectSkillViewer {
  readonly kind: 'project';
  /** The project's owning + shared team ids; empty = org-wide project. */
  readonly teamIds: string[];
}

/** Org-level machinery with no narrower identity. */
export interface OrgSkillViewer {
  readonly kind: 'org';
}

export type SkillViewer = UserSkillViewer | ProjectSkillViewer | OrgSkillViewer;

/** The product surface asking for a skill; `any` is a management surface. */
export type SkillSurface = 'chat' | 'agent' | 'any';

function teamsOverlap(
  skillTeams: readonly string[] | undefined,
  viewerTeamIds: readonly string[],
): boolean {
  if (skillTeams === undefined || skillTeams.length === 0) return false;
  if (viewerTeamIds.length === 0) return false;
  const viewerSet = new Set(viewerTeamIds);
  return skillTeams.some((teamId) => viewerSet.has(teamId));
}

/** True when `viewer` may read `skill` and see it in a listing. */
export function canViewSkill(
  skill: SkillAccessSubject,
  viewer: SkillViewer,
): boolean {
  if (skill.visibility === 'org') return true;
  if (skill.visibility === 'team') {
    if (viewer.kind === 'org') return false;
    if (viewer.kind === 'project') {
      return teamsOverlap(skill.teams, viewer.teamIds);
    }
    if (viewer.isOrgAdmin) return true;
    if (skill.owner !== undefined && skill.owner === viewer.userId) {
      return true;
    }
    return teamsOverlap(skill.teams, viewer.teamIds);
  }
  return (
    viewer.kind === 'user' &&
    skill.owner !== undefined &&
    skill.owner === viewer.userId
  );
}

/**
 * True when `viewer` may edit, reshare, or delete `skill`. Only a person
 * edits: the owner always may, and an administrator may for team- and
 * org-visible skills, so a member who leaves cannot strand shared knowledge.
 */
export function canEditSkill(
  skill: SkillAccessSubject,
  viewer: SkillViewer,
): boolean {
  if (viewer.kind !== 'user') return false;
  if (skill.owner !== undefined && skill.owner === viewer.userId) return true;
  return skill.visibility !== 'private' && viewer.isOrgAdmin;
}

/** Keep only the skills `viewer` may see, preserving the input order. */
export function filterVisibleSkills<T extends SkillAccessSubject>(
  skills: readonly T[],
  viewer: SkillViewer,
): T[] {
  return skills.filter((skill) => canViewSkill(skill, viewer));
}

/**
 * True when a skill whose frontmatter declares `usageMode` may be equipped
 * from `surface`. An absent mode reads as {@link DEFAULT_SKILL_USAGE_MODE}.
 */
export function matchesSkillSurface(
  subject: { readonly usageMode?: SkillUsageMode },
  surface: SkillSurface,
): boolean {
  if (surface === 'any') return true;
  const mode = subject.usageMode ?? DEFAULT_SKILL_USAGE_MODE;
  return mode === 'all' || mode === surface;
}
