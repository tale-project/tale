import type { MiddlewareHandler } from 'hono';
import type { Sql } from 'postgres';

import { evaluateTwoFactorEnforcement } from '../domains/two_factor/service.ts';
import {
  defineAbilityFor,
  type AppAction,
  type AppSubject,
} from '../../lib/permissions/ability.ts';
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
      // Trusted-headers mode: the reverse proxy is the role authority — the
      // member row keeps a placeholder and the SESSION carries the real role
      // (the 0.4 JWT-claim override, applied at read time).
      const sessionRecord: Record<string, unknown> =
        c.get('sessionBundle').session;
      const trustedRaw = Reflect.get(sessionRecord, 'trustedRole');
      const trustedRole =
        process.env.TRUSTED_HEADERS_ENABLED === 'true' &&
        typeof trustedRaw === 'string'
          ? trustedRaw.toLowerCase().trim()
          : undefined;
      c.set('orgId', orgId);
      c.set(
        'orgMember',
        trustedRole !== undefined && trustedRole !== ''
          ? { ...member, role: trustedRole }
          : member,
      );
      // Server-side org 2FA enforcement: a 'blocked' decision (policy enforced,
      // user not enrolled, past grace) must actually WITHHOLD authority here —
      // not merely swap the sign-in response body — so a client that ignores
      // the redirect cannot use its session to reach org data. The enrolment
      // path stays open: Better Auth's /api/auth/two-factor/* endpoints are
      // handled before this middleware, and /api/app/two-factor/status is
      // session-scoped (no org gate), so a blocked user can still enrol.
      const enforcement = await evaluateTwoFactorEnforcement(
        sql,
        c.get('sessionBundle').user.id,
      );
      if (enforcement.decision === 'blocked') {
        return c.json(
          {
            error: 'two_factor_enrollment_required',
            twoFactorRedirect: true,
            enrollRequired: true,
          },
          403,
        );
      }
    } catch (error) {
      if (error instanceof MembershipError) {
        return c.json({ error: error.message }, membershipStatus(error));
      }
      throw error;
    }
    return next();
  };
}

/**
 * Refuse a caller whose role lacks `action` on `subject` in the shared CASL
 * matrix (`lib/permissions/ability.ts`) — the server twin of the UI's
 * `ability.can` gates, for a router whose whole surface sits behind one
 * capability (the cloud-import browse/import doors behind `knowledgeWrite`).
 * Runs after `requireOrgMember`.
 */
export function requireOrgAbility<E extends OrgEnv>(
  action: AppAction,
  subject: AppSubject,
): MiddlewareHandler<E> {
  return async (c, next) => {
    if (defineAbilityFor(c.get('orgMember').role).cannot(action, subject)) {
      return c.json(
        {
          error: 'RBAC_FORBIDDEN',
          message: 'Your role cannot perform this action in this organization.',
        },
        403,
      );
    }
    return next();
  };
}
