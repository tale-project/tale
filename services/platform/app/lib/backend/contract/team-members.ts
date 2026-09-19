/**
 * `team_members` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../team_members.ts` are what
 * actually serve them.
 */

/** What deleting a team touches — the confirm dialog's numbers. */
export interface TeamDeletionImpact {
  teamId: string;
  name: string;
  memberCount: number;
  projects: { scoped: number; becomeOrgWide: number };
  folders: { scoped: number; becomeOrgWide: number };
  documents: { scoped: number; becomeOrgWide: number };
  conversations: { queued: number };
  syncConfigs: { scoped: number };
}

/** What an atomic team delete retired, as the door answers it. */
export interface TeamRetirementSummary {
  projectsRetagged: number;
  foldersRetagged: number;
  documentsRetagged: number;
  conversationsUnassigned: number;
  syncConfigsUnscoped: number;
  nowOrgWide: { projects: number; folders: number; documents: number };
}

export interface TeamMembersContract {
  /** The atomic team delete: scopes, provenance, members and the row in
   * one transaction (`DELETE /api/app/teams/:teamId`, admin). */
  'teams/mutations:deleteTeam': {
    kind: 'mutation';
    args: { organizationId: string; teamId: string };
    returns: TeamRetirementSummary;
  };
  /** The delete preview (`GET /api/app/teams/:teamId/impact`, admin). */
  'teams/queries:deletionImpact': {
    kind: 'query';
    args: { organizationId: string; teamId: string };
    returns: TeamDeletionImpact | null;
  };
  'team_members/mutations:addMember': {
    kind: 'mutation';
    args: { organizationId: string; userId: string; teamId: string };
    returns: null;
  };
  'team_members/mutations:removeMember': {
    kind: 'mutation';
    args: { organizationId: string; teamMemberId: string };
    returns: null;
  };
  'team_members/queries:listByTeam': {
    kind: 'query';
    args: { teamId: string };
    returns: Array<{
      _id: string;
      teamId: string;
      userId: string;
      role: string;
      joinedAt: number;
      displayName?: string;
      email?: string;
    }>;
  };
}
