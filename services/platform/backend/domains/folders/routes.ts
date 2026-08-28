import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { deactivateSyncConfigsForPath } from '../onedrive/service.ts';
import {
  getProjectAuthContext,
  ProjectError,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { buildHubFolderPath } from './paths.ts';
import {
  createFolder,
  deleteFolder,
  FolderError,
  getFolderBreadcrumb,
  listFolders,
  renameFolder,
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
  if (error instanceof RateLimitExceededError) {
    return c.json(
      { error: 'RATE_LIMITED', data: { retryAfterMs: error.retryAfter } },
      429,
    );
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
      return c.json({
        folders: await listFolders(deps.sql, auth, {
          ...(projectId !== undefined ? { projectId } : {}),
          ...(parentParam !== undefined
            ? { parentId: parentParam || null }
            : {}),
        }),
      });
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
      await transactSerializable(deps.sql, async (tx) => {
        // Deleting a synced hub folder means "stop syncing it" — resolve the
        // path BEFORE the row goes, deactivate configs in the same tx, or
        // the next sync run would recreate the folder just removed.
        const folderPath = await buildHubFolderPath(
          tx,
          auth.organizationId,
          c.req.param('folderId'),
        );
        await deleteFolder(tx, auth, c.req.param('folderId'));
        if (folderPath !== null) {
          await deactivateSyncConfigsForPath(
            tx,
            auth.organizationId,
            folderPath,
          );
        }
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
