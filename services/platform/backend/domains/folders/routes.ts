import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { deleteFolderCascade, DocumentError } from '../documents/service.ts';
import {
  syncRagDocumentScope,
  syncRagFolderSubtree,
} from '../knowledge/service.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  getProjectAuthContext,
  ProjectError,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { buildHubFolderPath } from './paths.ts';
import {
  createFolder,
  FolderError,
  getFolderBreadcrumb,
  getFolderView,
  listActiveSyncConfigIdsByPath,
  listFolders,
  renameFolder,
  updateFolderTeams,
} from './service.ts';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().optional(),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof FolderError || error instanceof ProjectError) {
    return c.json({ error: error.code }, error.status);
  }
  if (error instanceof DocumentError || error instanceof LegalHoldError) {
    // The delete cascade surfaces document-side refusals (protected
    // records, legal holds) with their message intact.
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof RateLimitExceededError) {
    return rateLimitedResponse(c, error);
  }
  throw error;
}

/** /api/app/folders — the Document Hub tree. */
export function createFolderRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const authCtx = (c: Context<OrgEnv>): Promise<ProjectAuthContext> =>
    getProjectAuthContext(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      },
      c.get('sessionBundle').user.email,
    );

  app.get('/', async (c) => {
    try {
      const auth = await authCtx(c);
      const parentParam = c.req.query('parentId');
      const projectId = c.req.query('projectId');
      const parentId =
        parentParam !== undefined ? parentParam || null : undefined;
      const folders = await listFolders(deps.sql, auth, {
        ...(projectId !== undefined ? { projectId } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      });
      // Hub rows carry the active sync-config id (path-keyed) so the UI can
      // offer "stop syncing" and warn before delete; project trees never do.
      let syncByPath = new Map<string, string>();
      if (projectId === undefined) {
        syncByPath = await listActiveSyncConfigIdsByPath(
          deps.sql,
          auth.organizationId,
        );
      }
      const basePath =
        syncByPath.size > 0 && parentId != null
          ? await buildHubFolderPath(deps.sql, auth.organizationId, parentId)
          : null;
      return c.json({
        folders: folders.map((folder) => {
          if (syncByPath.size === 0) return folder;
          const path =
            basePath !== null ? `${basePath}/${folder.name}` : folder.name;
          const syncConfigId = syncByPath.get(path);
          return syncConfigId === undefined
            ? folder
            : Object.assign(folder, { syncConfigId });
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:folderId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        folder: await getFolderView(deps.sql, auth, c.req.param('folderId')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:folderId/teams', async (c) => {
    const body = z
      .object({ teamIds: z.array(z.string().min(1)).max(64) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await checkOrganizationRateLimit(
        deps.sql,
        'folder:mutate',
        auth.organizationId,
      );
      const touched = await transactSerializable(deps.sql, (tx) =>
        updateFolderTeams(tx, auth, {
          folderId: c.req.param('folderId'),
          teamIds: body.data.teamIds,
        }),
      );
      // The cascade re-scoped these documents — re-stamp their corpus rows
      // (retrieval filters on team scope; scope-only, no re-embed).
      for (const doc of touched) {
        await syncRagDocumentScope(deps.sql, auth.organizationId, doc.id);
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:folderId/breadcrumb', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        breadcrumb: await getFolderBreadcrumb(
          deps.sql,
          auth,
          c.req.param('folderId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/', async (c) => {
    const body = createSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await checkOrganizationRateLimit(
        deps.sql,
        'folder:mutate',
        auth.organizationId,
      );
      const folderId = await transactSerializable(deps.sql, (tx) =>
        createFolder(tx, auth, body.data),
      );
      return c.json({ folderId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:folderId/rename', async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(200) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await checkOrganizationRateLimit(
        deps.sql,
        'folder:mutate',
        auth.organizationId,
      );
      await transactSerializable(deps.sql, (tx) =>
        renameFolder(tx, auth, c.req.param('folderId'), body.data.name),
      );
      // Every document beneath now has a new path; the corpus copies it
      // (folder-scoped search matches on it) — re-stamp after commit.
      await syncRagFolderSubtree(
        deps.sql,
        auth.organizationId,
        c.req.param('folderId'),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:folderId', async (c) => {
    try {
      const auth = await authCtx(c);
      await checkOrganizationRateLimit(
        deps.sql,
        'folder:mutate',
        auth.organizationId,
      );
      // Cascade delete (0.4 contract): hold + protected-record pre-walks,
      // sync deactivation, descendant document purge, then the subtree.
      await deleteFolderCascade(deps.sql, auth, c.req.param('folderId'));
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
