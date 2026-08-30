/**
 * `team_members` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../team_members.ts` are what
 * actually serve them.
 */

export interface TeamMembersContract {
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
