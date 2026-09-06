import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import {
  BrandingError,
  deleteBrandingImage,
  readBranding,
  saveBranding,
  saveBrandingImage,
  snapshotBrandingToHistory,
} from './service.ts';

/**
 * /api/app/branding — per-org theming. The READ is deliberately open (the
 * pre-auth login shell needs the `default` bucket before any session
 * exists; an org id that no longer resolves falls back to it too). Writes
 * require the `orgSettings` capability in the org, matching the settings
 * page's own gate. Image bytes are served by the shell's static handler.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof BrandingError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

export function createBrandingRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();

  // Display-only, session-free: logo/colors/app name.
  app.get('/', async (c) => {
    const organizationId = c.req.query('orgId');
    return c.json(await readBranding(deps.sql, organizationId));
  });

  const admin = new Hono<OrgEnv>();
  admin.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  admin.use(async (c, next) => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json(
        {
          error: 'ORG_FORBIDDEN',
          message: `Role "${c.get('orgMember').role}" lacks the org-settings capability required to modify branding.`,
        },
        403,
      );
    }
    return next();
  });

  const orgSlugOf = async (c: Context<OrgEnv>): Promise<string | null> =>
    resolveOrgSlug(deps.sql, c.get('orgId'));

  admin.post('/save', async (c) => {
    const body = z
      .object({
        accentColor: z.string().max(50).optional(),
        logoFilename: z.string().max(100).optional(),
        faviconLightFilename: z.string().max(100).optional(),
        faviconDarkFilename: z.string().max(100).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      return c.json(await saveBranding(orgSlug, body.data));
    } catch (error) {
      return handleError(c, error);
    }
  });

  admin.post('/images', async (c) => {
    const body = z
      .object({
        type: z.string().max(50),
        base64: z.string().max(4_000_000),
        mimeType: z.string().max(100),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      return c.json(await saveBrandingImage(orgSlug, body.data));
    } catch (error) {
      return handleError(c, error);
    }
  });

  admin.delete('/images/:type', async (c) => {
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      await deleteBrandingImage(orgSlug, c.req.param('type'));
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  admin.post('/snapshot', async (c) => {
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json({ snapshot: await snapshotBrandingToHistory(orgSlug) });
  });

  app.route('/', admin);
  return app;
}
