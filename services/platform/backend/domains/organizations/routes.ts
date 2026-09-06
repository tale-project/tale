import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import {
  MembershipError,
  requireOrganizationMember,
} from '../../auth/membership.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';
import {
  deleteOrganization,
  getOrganization,
  listUserOrganizations,
  OrganizationError,
  recordOrgSwitch,
} from './service.ts';

/**
 * /api/app/organizations — app-side org semantics. Better Auth's org plugin
 * owns create/update/invitations on /api/auth/organization/*; these routes
 * carry the reads and doors around them, and the deletion door itself. Org
 * scope comes from the path param and is membership-checked per handler
 * (`requireOrgMember`'s query-param convention doesn't fit the /:id shape).
 */
export function createOrganizationRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(requireSession(deps.auth));

  // The caller's own memberships (the org picker / boot resolution).
  app.get('/', async (c) => {
    return c.json({
      organizations: await listUserOrganizations(
        deps.sql,
        c.get('sessionBundle').user.id,
      ),
    });
  });

  app.get('/:id', async (c) => {
    const organizationId = c.req.param('id');
    const userId = c.get('sessionBundle').user.id;
    try {
      await requireOrganizationMember(deps.sql, organizationId, userId);
    } catch (error) {
      if (error instanceof MembershipError) {
        return c.json({ error: error.code }, 403);
      }
      throw error;
    }
    return c.json({
      organization: await getOrganization(deps.sql, organizationId),
    });
  });

  // Budget banner: ask the org's admins for more usage credits — one
  // system bell to every member surface (the 0.4 `requestUsageCredits`).
  app.post('/:id/request-credits', async (c) => {
    const organizationId = c.req.param('id');
    const userId = c.get('sessionBundle').user.id;
    try {
      await requireOrganizationMember(deps.sql, organizationId, userId);
    } catch (error) {
      if (error instanceof MembershipError) {
        return c.json({ ok: false }, 403);
      }
      throw error;
    }
    const session = c.get('sessionBundle');
    await deps.sql.begin((tx) =>
      writeNotificationForOrgs(tx, {
        organizationIds: [organizationId],
        category: 'system',
        severity: 'warning',
        titleKey: 'creditRequestTitle',
        bodyKey: 'creditRequestBody',
        params: {
          name: session.user.name || session.user.email || 'A member',
        },
        subjectUserId: userId,
      }),
    );
    return c.json({ ok: true });
  });

  app.post('/:id/record-switch', async (c) => {
    const organizationId = c.req.param('id');
    const session = c.get('sessionBundle');
    try {
      const member = await requireOrganizationMember(
        deps.sql,
        organizationId,
        session.user.id,
      );
      await transactSerializable(deps.sql, (tx) =>
        recordOrgSwitch(
          tx,
          {
            userId: session.user.id,
            email: session.user.email,
            role: member.role,
          },
          organizationId,
        ),
      );
    } catch (error) {
      if (error instanceof MembershipError) {
        return c.json({ error: error.code }, 403);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  // The ONE deletion door (Better Auth's `/organization/delete` is disabled):
  // guards, audit, cascade, Better Auth rows and the cleanup job commit as
  // one serializable transaction — a refusal or a failure leaves the
  // organization exactly as it was.
  app.post('/:id/delete', async (c) => {
    const organizationId = c.req.param('id');
    const session = c.get('sessionBundle');
    try {
      const result = await transactSerializable(deps.sql, (tx) =>
        deleteOrganization(
          tx,
          { userId: session.user.id, email: session.user.email },
          organizationId,
        ),
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof OrganizationError) {
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      }
      if (error instanceof LegalHoldError) {
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      }
      if (error instanceof MembershipError) {
        return c.json({ error: error.code, message: error.message }, 403);
      }
      throw error;
    }
  });

  return app;
}
