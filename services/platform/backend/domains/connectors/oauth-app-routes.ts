import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  CLOUD_IMPORT_APP_SLUGS,
  deleteOauthApp,
  listOauthApps,
  OauthAppError,
  upsertOauthApp,
  type OauthAppActor,
} from './oauth-apps.ts';
import { readOauth2Endpoints } from './oauth.ts';

/**
 * /api/app/connector-oauth-apps — the org-level OAuth app registry
 * (Settings > Connectors). Configuring a vendor app decides where an org's
 * members hand consent, so writes take the same admin gate as SSO
 * (`write orgSettings`), not the developer gate credentials use. The client
 * secret never rides a response — listings carry the masked preview only.
 */

const upsertInput = z.object({
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(5000).optional(),
  tenantId: z.string().max(256).optional(),
});

/** A slug is configurable when the catalog declares OAuth2 for it — plus the
 * Knowledge cloud-import provider `onedrive`, which has no catalog entry.
 * Slack is refused: its inbound Events signature check runs before any org
 * is known, so an org-level Slack app could consent but never verify. */
export function isConfigurableOauthAppSlug(slug: string): boolean {
  if (slug === CLOUD_IMPORT_APP_SLUGS.onedrive) return true;
  if (slug === 'slack') return false;
  return readOauth2Endpoints(slug) !== null;
}

export function createConnectorOauthAppRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const requireSettingsWrite = (c: Context<OrgEnv>): Response | null => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json({ error: 'Only admins can configure OAuth apps.' }, 403);
    }
    return null;
  };
  const actor = (c: Context<OrgEnv>): OauthAppActor => ({
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
    role: c.get('orgMember').role,
  });

  app.get('/', async (c) => {
    return c.json({ apps: await listOauthApps(deps.sql, c.get('orgId')) });
  });

  app.put('/:slug', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const slug = c.req.param('slug');
    if (!isConfigurableOauthAppSlug(slug)) {
      return c.json(
        { error: 'This connector does not take an org OAuth app.' },
        400,
      );
    }
    const parsed = upsertInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid OAuth app payload.' }, 400);
    }
    try {
      const view = await upsertOauthApp(deps.sql, {
        organizationId: c.get('orgId'),
        slug,
        clientId: parsed.data.clientId,
        ...(parsed.data.clientSecret !== undefined
          ? { clientSecret: parsed.data.clientSecret }
          : {}),
        ...(parsed.data.tenantId !== undefined
          ? { tenantId: parsed.data.tenantId }
          : {}),
        actor: actor(c),
      });
      return c.json(view);
    } catch (error) {
      if (error instanceof OauthAppError) {
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      throw error;
    }
  });

  app.delete('/:slug', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const removed = await deleteOauthApp(deps.sql, {
      organizationId: c.get('orgId'),
      slug: c.req.param('slug'),
      actor: actor(c),
    });
    if (!removed) {
      return c.json(
        { error: 'No OAuth app is configured for this slug.' },
        404,
      );
    }
    return c.json({ ok: true });
  });

  return app;
}
