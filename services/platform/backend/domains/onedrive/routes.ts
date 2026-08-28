import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { importFiles } from '../../../convex/onedrive/import_files.ts';
import { listFiles } from '../../../convex/onedrive/list_files.ts';
import { listSharePointDrives } from '../../../convex/onedrive/list_sharepoint_drives.ts';
import { listSharePointFiles } from '../../../convex/onedrive/list_sharepoint_files.ts';
import { listSharePointSites } from '../../../convex/onedrive/list_sharepoint_sites.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { checkOrganizationRateLimit } from '../../lib/rate-limit.ts';
import {
  cancelSyncConfig,
  createPgImportDeps,
  OneDriveError,
  resolveGraphTokenForUser,
} from './service.ts';

/**
 * /api/app/onedrive — the Knowledge OneDrive/SharePoint browse + import
 * surface (the 0.4 `onedrive/actions` + `mutations.cancelSyncConfig`).
 * Membership-gated like 0.4; tokens resolve per signed-in member (cloud
 * grant first, login account second) and never reach the client.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof OneDriveError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

const importItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.number(),
  relativePath: z.string().optional(),
  isDirectlySelected: z.boolean().optional(),
  selectedParentId: z.string().optional(),
  selectedParentName: z.string().optional(),
  selectedParentPath: z.string().optional(),
  siteId: z.string().optional(),
  driveId: z.string().optional(),
  sourceType: z.enum(['onedrive', 'sharepoint']).optional(),
});

const importBodySchema = z.object({
  items: z.array(importItemSchema).min(1).max(500),
  importType: z.enum(['one-time', 'sync']),
  teamId: z.string().optional(),
});

export function createOneDriveRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const tokenFor = async (c: Context<OrgEnv>) =>
    resolveGraphTokenForUser(deps.sql, {
      organizationId: c.get('orgId'),
      userId: c.get('sessionBundle').user.id,
    });

  app.post('/list-files', async (c) => {
    const body = z
      .object({
        folderId: z.string().optional(),
        search: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await checkOrganizationRateLimit(
      deps.sql,
      'external:onedrive-list',
      c.get('orgId'),
    );
    const token = await tokenFor(c);
    if (!token.success) {
      return c.json({ success: false, error: token.error });
    }
    return c.json(
      await listFiles(token.token, body.data.folderId, body.data.search),
    );
  });

  app.post('/sharepoint/sites', async (c) => {
    const body = z
      .object({ search: z.string().optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await checkOrganizationRateLimit(
      deps.sql,
      'external:onedrive-list',
      c.get('orgId'),
    );
    const token = await tokenFor(c);
    if (!token.success) {
      return c.json({ success: false, error: token.error });
    }
    return c.json(
      await listSharePointSites({
        token: token.token,
        ...(body.data.search !== undefined ? { search: body.data.search } : {}),
      }),
    );
  });

  app.post('/sharepoint/drives', async (c) => {
    const body = z
      .object({ siteId: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await checkOrganizationRateLimit(
      deps.sql,
      'external:onedrive-list',
      c.get('orgId'),
    );
    const token = await tokenFor(c);
    if (!token.success) {
      return c.json({ success: false, error: token.error });
    }
    return c.json(
      await listSharePointDrives({
        siteId: body.data.siteId,
        token: token.token,
      }),
    );
  });

  app.post('/sharepoint/files', async (c) => {
    const body = z
      .object({
        siteId: z.string().min(1),
        driveId: z.string().min(1),
        folderId: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await checkOrganizationRateLimit(
      deps.sql,
      'external:onedrive-list',
      c.get('orgId'),
    );
    const token = await tokenFor(c);
    if (!token.success) {
      return c.json({ success: false, error: token.error });
    }
    return c.json(
      await listSharePointFiles({
        siteId: body.data.siteId,
        driveId: body.data.driveId,
        ...(body.data.folderId !== undefined
          ? { folderId: body.data.folderId }
          : {}),
        token: token.token,
      }),
    );
  });

  /** One-time or sync import through the REUSED 0.4 pipeline. A "sync"
   *  import registers the sync configs the pg-boss engine keeps fresh. */
  app.post('/import', async (c) => {
    const body = importBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    await checkOrganizationRateLimit(
      deps.sql,
      'external:onedrive-read',
      c.get('orgId'),
    );
    const token = await tokenFor(c);
    if (!token.success) {
      return c.json({
        success: false,
        results: [],
        totalFiles: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        error: token.error,
      });
    }
    const result = await importFiles(
      {
        items: body.data.items,
        organizationId: c.get('orgId'),
        importType: body.data.importType,
        ...(body.data.teamId !== undefined ? { teamId: body.data.teamId } : {}),
        token: token.token,
        userId: c.get('sessionBundle').user.id,
      },
      createPgImportDeps(deps.sql, c.get('orgId')),
    );
    return c.json(result);
  });

  /** Stop a sync; already-imported documents stay. */
  app.post('/sync-configs/:id/cancel', async (c) => {
    try {
      await cancelSyncConfig(deps.sql, c.get('orgId'), c.req.param('id'));
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
