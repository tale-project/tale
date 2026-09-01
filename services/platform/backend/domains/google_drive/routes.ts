import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { importFiles } from '../../core/google_drive/import_files.ts';
import { listFiles } from '../../core/google_drive/list_files.ts';
import { SyncConfigError } from '../onedrive/service.ts';
import {
  cancelSyncConfig,
  createGoogleDriveImportDeps,
  resolveDriveTokenForUser,
} from './service.ts';

/**
 * /api/app/google-drive — the Knowledge Google Drive browse + import
 * surface (the 0.4 `google_drive/actions` + `mutations.cancelSyncConfig`).
 * Membership-gated like 0.4; tokens are grant-only and never reach the
 * client. Native Google Workspace files are excluded by the reused listers.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof SyncConfigError) {
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
});

const importBodySchema = z.object({
  items: z.array(importItemSchema).min(1).max(500),
  importType: z.enum(['one-time', 'sync']),
  teamId: z.string().optional(),
});

export function createGoogleDriveRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const tokenFor = async (c: Context<OrgEnv>) =>
    resolveDriveTokenForUser(deps.sql, {
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
    const token = await tokenFor(c);
    if (!token.success) {
      return c.json({ success: false, error: token.error });
    }
    return c.json(
      await listFiles(token.token, body.data.folderId, body.data.search),
    );
  });

  /** One-time or sync import through the REUSED 0.4 pipeline. A "sync"
   *  import registers the sync configs the pg-boss engine keeps fresh. */
  app.post('/import', async (c) => {
    const body = importBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
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
      createGoogleDriveImportDeps(deps.sql, c.get('orgId')),
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
