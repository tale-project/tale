import type { MiddlewareHandler } from 'hono';
import type { Sql } from 'postgres';

import {
  MembershipError,
  requireOrganizationMember,
  type OrganizationMember,
} from './membership.ts';
import type { AuthEnv } from './session.ts';

export interface OrgEnv {
  Variables: AuthEnv['Variables'] & {
    orgId: string;
    /** The caller's ACTIVE membership (role normalized lowercase). */
    orgMember: OrganizationMember;
  };
}

function membershipStatus(error: MembershipError): 400 | 403 | 404 {
  switch (error.code) {
    case 'ORG_ID_REQUIRED': {
      return 400;
    }
    case 'ORG_NOT_FOUND': {
      return 404;
    }
    default: {
      return 403;
    }
  }
}

/**
 * Resolve and authorize the request's organization scope from the `orgId`
 * query parameter — validated against the `member` table (disabled role
 * rejected), never trusted from the client. Runs after `requireSession`.
 */
export function requireOrgMember<E extends OrgEnv>(
  sql: Sql,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const orgId = c.req.query('orgId');
    if (!orgId) {
      return c.json({ error: 'orgId is required' }, 400);
    }
    try {
      const member = await requireOrganizationMember(
        sql,
        orgId,
        c.get('sessionBundle').user.id,
      );
      c.set('orgId', orgId);
      c.set('orgMember', member);
    } catch (error) {
      if (error instanceof MembershipError) {
        return c.json({ error: error.message }, membershipStatus(error));
      }
      throw error;
    }
    return next();
  };
}
