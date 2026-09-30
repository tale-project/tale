import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import {
  requireOrgAbility,
  requireOrgMember,
  type OrgEnv,
} from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  assertTeamsAssignable,
  TeamAssignmentError,
} from '../../core/lib/audience.ts';
import { importFiles } from '../../core/onedrive/import_files.ts';
import { listFiles } from '../../core/onedrive/list_files.ts';
import { listSharePointDrives } from '../../core/onedrive/list_sharepoint_drives.ts';
import { listSharePointFiles } from '../../core/onedrive/list_sharepoint_files.ts';
import { listSharePointSites } from '../../core/onedrive/list_sharepoint_sites.ts';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import { chargeOrgRateLimit } from '../../lib/rate-limit-response.ts';
import {
  FolderError,
  loadHubImportDestination,
  type FolderRow,
} from '../folders/service.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import {
  cancelSyncConfig,
  createPgImportDeps,
  resolveGraphTokenForUser,
  SyncConfigError,
} from './service.ts';

/**
 * /api/app/onedrive — the Knowledge OneDrive/SharePoint browse + import
 * surface (the 0.4 `onedrive/actions` + `mutations.cancelSyncConfig`).
 * The whole surface exists to write Knowledge documents, so it sits behind
 * `knowledgeWrite` — the same gate the cloud-import OAuth start enforces and
 * the UI hides the import behind; a read-only member holding a usable Graph
 * token (the login-account lane) must not import or cancel syncs through the
 * API. Tokens resolve per signed-in member (cloud grant first, login account
 * second) and never reach the client. The org-wide vendor budgets answer a
 * 429 with Retry-After when spent — a member browsing briskly is asked to
 * wait, never shown an outage.
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
  siteId: z.string().optional(),
  driveId: z.string().optional(),
  sourceType: z.enum(['onedrive', 'sharepoint']).optional(),
});

const importBodySchema = z.object({
  items: z.array(importItemSchema).min(1).max(500),
  importType: z.enum(['one-time', 'sync']),
  teamId: z.string().optional(),
  /** The hub folder the person had open; the import lands there. */
  destinationFolderId: z.string().min(1).optional(),
});

export function createOneDriveRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(
    requireSession(deps.auth),
    requireOrgMember(deps.sql),
    requireOrgAbility('write', 'knowledgeWrite'),
  );

  const tokenFor = async (
    c: Context<OrgEnv>,
    options: { forceRefresh?: boolean } = {},
  ) =>
    resolveGraphTokenForUser(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
      },
      options,
    );

  /**
   * A listing under the member's grant. When the provider refuses the token
   * (401) — access removed at the provider ends it while the stored expiry
   * still counts it live — the grant is refreshed once: a grant that cannot
   * be refreshed answers its own sentence, which the picker (and an
   * import's folder walk) hands to the connect dialog; one that can is
   * listed again with the new token.
   */
  const listUnderGrant = async <
    T extends { success: boolean; unauthorized?: boolean },
  >(
    c: Context<OrgEnv>,
    list: (token: string) => Promise<T>,
  ): Promise<T | { success: false; error: string }> => {
    const token = await tokenFor(c);
    if (!token.success) return { success: false, error: token.error };
    const listed = await list(token.token);
    if (listed.success || listed.unauthorized !== true) return listed;
    const renewed = await tokenFor(c, { forceRefresh: true });
    if (!renewed.success) return { success: false, error: renewed.error };
    return list(renewed.token);
  };

  app.post('/list-files', async (c) => {
    const body = z
      .object({
        folderId: z.string().optional(),
        search: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return invalidBodyResponse(c, body.error);
    const limited = await chargeOrgRateLimit(
      deps.sql,
      c,
      'external:onedrive-list',
      c.get('orgId'),
    );
    if (limited !== null) return limited;
    return c.json(
      await listUnderGrant(c, (token) =>
        listFiles(token, body.data.folderId, body.data.search),
      ),
    );
  });

  app.post('/sharepoint/sites', async (c) => {
    const body = z
      .object({ search: z.string().optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return invalidBodyResponse(c, body.error);
    const limited = await chargeOrgRateLimit(
      deps.sql,
      c,
      'external:onedrive-list',
      c.get('orgId'),
    );
    if (limited !== null) return limited;
    return c.json(
      await listUnderGrant(c, (token) =>
        listSharePointSites({
          token,
          ...(body.data.search !== undefined
            ? { search: body.data.search }
            : {}),
        }),
      ),
    );
  });

  app.post('/sharepoint/drives', async (c) => {
    const body = z
      .object({ siteId: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalidBodyResponse(c, body.error);
    const limited = await chargeOrgRateLimit(
      deps.sql,
      c,
      'external:onedrive-list',
      c.get('orgId'),
    );
    if (limited !== null) return limited;
    return c.json(
      await listUnderGrant(c, (token) =>
        listSharePointDrives({ siteId: body.data.siteId, token }),
      ),
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
    if (!body.success) return invalidBodyResponse(c, body.error);
    const limited = await chargeOrgRateLimit(
      deps.sql,
      c,
      'external:onedrive-list',
      c.get('orgId'),
    );
    if (limited !== null) return limited;
    return c.json(
      await listUnderGrant(c, (token) =>
        listSharePointFiles({
          siteId: body.data.siteId,
          driveId: body.data.driveId,
          ...(body.data.folderId !== undefined
            ? { folderId: body.data.folderId }
            : {}),
          token,
        }),
      ),
    );
  });

  /** One-time or sync import through the REUSED 0.4 pipeline. A "sync"
   *  import registers the sync configs the pg-boss engine keeps fresh. */
  app.post('/import', async (c) => {
    const body = importBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return invalidBodyResponse(c, body.error);
    const limited = await chargeOrgRateLimit(
      deps.sql,
      c,
      'external:onedrive-read',
      c.get('orgId'),
    );
    if (limited !== null) return limited;
    const token = await tokenFor(c);
    if (!token.success) {
      return c.json({
        success: false,
        results: [],
        totalFiles: body.data.items.length,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        error: token.error,
      });
    }
    // A destination is a write into that folder, so it answers to the same
    // gate an upload does — and a team folder owns the scope of what lands
    // inside it, so its team wins over whatever the picker had selected.
    const auth = await getProjectAuthContext(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      },
      c.get('sessionBundle').user.email,
    );
    let destination: FolderRow | null = null;
    if (body.data.destinationFolderId !== undefined) {
      try {
        destination = await loadHubImportDestination(
          deps.sql,
          auth,
          body.data.destinationFolderId,
        );
      } catch (error) {
        if (error instanceof FolderError) {
          return c.json({ error: error.code, message: error.message }, 403);
        }
        throw error;
      }
    }
    // The audience the import stamps. A team folder's own wins (the engine
    // re-reads the landing folder's full team list per document); otherwise
    // the picker's team, which must be one the caller may assign — the same
    // rule an upload obeys (`assertTeamsAssignable`).
    let effectiveTeamId: string | undefined;
    if (destination !== null && destination.teamTags.length > 0) {
      effectiveTeamId = destination.teamTags[0];
    } else if (body.data.teamId !== undefined) {
      try {
        await assertTeamsAssignable(deps.sql, auth, [body.data.teamId]);
        effectiveTeamId = body.data.teamId;
      } catch (error) {
        if (error instanceof TeamAssignmentError) {
          return c.json(
            { error: error.code, message: error.message },
            error.status,
          );
        }
        throw error;
      }
    }
    const result = await importFiles(
      {
        items: body.data.items,
        organizationId: c.get('orgId'),
        importType: body.data.importType,
        ...(effectiveTeamId != null ? { teamId: effectiveTeamId } : {}),
        ...(destination !== null
          ? { destinationFolderId: destination.id }
          : {}),
        token: token.token,
        userId: c.get('sessionBundle').user.id,
      },
      {
        ...createPgImportDeps(deps.sql, c.get('orgId')),
        // The grant again before each file, the check each listing makes,
        // so a grant revoked or expired mid-import stops the import there
        // and answers the grant's own sentence with the files done so far.
        resolveToken: ({ forceRefresh }) => tokenFor(c, { forceRefresh }),
      },
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
