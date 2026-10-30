import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';

import type { SkillSharingValue } from '../components/skill-visibility-field';
import { useOrgReservedReason } from './use-org-reserved-reason';

export interface SkillAudience {
  /** Whom the skill is for: the member's pick, else the default. */
  readonly sharing: SkillSharingValue;
  /** Why the organization withholds the Organization audience from the
   * member, when it does. */
  readonly orgReservedReason: string | undefined;
  /** The member has nowhere to share the skill: the organization reserves
   * sharing with everyone, and the teams read answered that they are in
   * none. */
  readonly noAudience: boolean;
  /** The audience cannot be sent as it stands: Teams with none picked, or
   * Organization while it is withheld. */
  readonly audienceMissing: boolean;
}

/**
 * Whom a new skill is for, as the blank-skill form and the upload preview
 * ask it — one rule for both. Until the member picks one (`picked`), the
 * default follows what the organization lets them publish, which may still
 * be loading:
 *
 * - a blank skill (no `declared` audience) starts on Organization while the
 *   member may publish to it, and on Teams, none picked yet, where the
 *   organization reserves that;
 * - an uploaded bundle starts on the audience its `SKILL.md` declares (an
 *   unmarked one reads as the organization), except that an
 *   organization-wide one the member may not publish starts on all of their
 *   own teams — the widest audience left to them, so a member in one team
 *   uploads for it without editing the file.
 */
export function useSkillAudience(
  organizationId: string,
  {
    picked,
    declared,
  }: {
    picked: SkillSharingValue | null;
    declared?: SkillSharingValue;
  },
): SkillAudience {
  // A member's own teams; reserved never applies to an admin, the one
  // viewer this lists every team for.
  const { teams } = useOrgTeams();
  const orgReservedReason = useOrgReservedReason(organizationId);
  const reserved = orgReservedReason !== undefined;
  const sharing: SkillSharingValue =
    picked ??
    (declared === undefined
      ? { visibility: reserved ? 'team' : 'org', teams: [] }
      : reserved && declared.visibility === 'org'
        ? { visibility: 'team', teams: (teams ?? []).map((team) => team.id) }
        : declared);
  return {
    sharing,
    orgReservedReason,
    noAudience: reserved && teams !== undefined && teams.length === 0,
    audienceMissing:
      (sharing.visibility === 'team' && sharing.teams.length === 0) ||
      (sharing.visibility === 'org' && reserved),
  };
}
