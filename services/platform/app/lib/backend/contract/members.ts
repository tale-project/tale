/**
 * `members` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../members.ts` are what
 * actually serve them.
 */

export interface MembersContract {
  'members/mutations:removeMember': {
    kind: 'mutation';
    args: { memberId: string };
    returns: null;
  };
  'members/mutations:transferOwnership': {
    kind: 'mutation';
    args: { targetMemberId: string };
    returns: null;
  };
  'members/mutations:updateMemberDisplayName': {
    kind: 'mutation';
    args: { memberId: string; displayName: string };
    returns: null;
  };
  'members/mutations:updateMemberRole': {
    kind: 'mutation';
    args: {
      role: 'member' | 'admin' | 'disabled' | 'owner' | 'editor' | 'developer';
      memberId: string;
    };
    returns: null;
  };
  'members/queries:approxCountMyTeams': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
  'members/queries:getCurrentMemberContext': {
    kind: 'query';
    args: { organizationId: string };
    returns:
      | null
      | {
          status: 'ok';
          memberId: string;
          organizationId: string;
          userId: string;
          role:
            | 'member'
            | 'admin'
            | 'disabled'
            | 'owner'
            | 'editor'
            | 'developer';
          createdAt: number;
          displayName: undefined | string;
          isAdmin: boolean;
        }
      | {
          status: 'not_found';
          memberId?: undefined;
          organizationId?: undefined;
          userId?: undefined;
          role?: undefined;
          createdAt?: undefined;
          displayName?: undefined;
          isAdmin?: undefined;
        }
      | {
          status: 'not_member';
          memberId?: undefined;
          organizationId?: undefined;
          userId?: undefined;
          role?: undefined;
          createdAt?: undefined;
          displayName?: undefined;
          isAdmin?: undefined;
        };
  };
  'members/queries:getMyTeams': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      id: string;
      name: string;
      memberCount: number;
      createdAt: null | number;
    }>;
  };
  'members/queries:getUserIdByEmail': {
    kind: 'query';
    args: { email: string };
    returns: null | string;
  };
  'members/queries:listByOrganization': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      _id: string;
      organizationId: string;
      userId: string;
      role: 'member' | 'admin' | 'disabled' | 'owner' | 'editor' | 'developer';
      createdAt: number;
      displayName: undefined | string;
      email: undefined | string;
      twoFactorEnabled: boolean;
      passkeyCount: number;
    }>;
  };
  'members/queries:listOrgTeams': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      id: string;
      name: string;
      memberCount: number;
      createdAt: null | number;
    }>;
  };
}
