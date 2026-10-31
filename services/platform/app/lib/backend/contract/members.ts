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
        }
      | {
          /** The session is bound to another organization: the member door's
           * refusal (`requireOrgMember`) as the app reads it, never a body. */
          status: 'session_restricted';
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
      /** Provisioned by an identity provider (SSO group sync / SCIM), whose
       * roster the provider owns — the admin list says so; `/mine` does not. */
      synced?: boolean;
    }>;
  };
  'members/queries:getUserIdByEmail': {
    kind: 'query';
    args: { email: string };
    returns: null | string;
  };
  /** The members one person a screen names stands for (MEMBER-R11): by
   * user id, the member with that id if there is one; by a plain
   * `@handle`, every member who answers to it. Many such reads asked at
   * once share one request (`member-lookup-batch.ts`). */
  'members/queries:lookupMember': {
    kind: 'query';
    args:
      | { organizationId: string; userId: string }
      | { organizationId: string; handle: string };
    returns: Array<{
      _id: string;
      userId: string;
      role: 'member' | 'admin' | 'disabled' | 'owner' | 'editor' | 'developer';
      createdAt: number;
      displayName: undefined | string;
      email: undefined | string;
    }>;
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
      /** Provisioned by an identity provider (SSO group sync / SCIM), whose
       * roster the provider owns — the admin list says so; `/mine` does not. */
      synced?: boolean;
    }>;
  };
}
