import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import {
  MembershipError,
  requireOrganizationMember,
} from '../../auth/membership.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import {
  getOrganization,
  hasAnyOrganization,
  listUserOrganizations,
  OrganizationError,
  prepareOrganizationDeletion,
  recordOrgSwitch,
} from './service.ts';

/**
 * /api/app/organizations — app-side org semantics. Better Auth's org plugin
 * owns create/update/delete/invitations on /api/auth/organization/*; these
 * routes carry the reads and doors around them. Org scope comes from the
 * path param and is membership-checked per handler (`requireOrgMember`'s
 * query-param convention doesn't fit the /:id shape).
 */
export function createOrganizationRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(requireSession(deps.auth));

  // Auth-gated (unlike users/has-any): instance provisioning state must not
  // leak to anonymous probes.
  app.get('/has-any', async (c) => {
    return c.json({ hasAny: await hasAnyOrganization(deps.sql) });
  });

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

  app.post('/:id/prepare-deletion', async (c) => {
    const organizationId = c.req.param('id');
    const session = c.get('sessionBundle');
    try {
      const result = await transactSerializable(deps.sql, (tx) =>
        prepareOrganizationDeletion(
          tx,
          { userId: session.user.id, email: session.user.email },
          organizationId,
        ),
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof OrganizationError) {
        return c.json({ error: error.code }, error.status);
      }
      if (error instanceof MembershipError) {
        return c.json({ error: error.code }, 403);
      }
      throw error;
    }
  });

  return app;
}
