import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import {
  ObjectStorageError,
  createBackfillRun,
  deleteConnection,
  getBackfillStatus,
  probeConnection,
  readConnectionView,
  writeConnection,
} from './service.ts';

/** /api/app/object-storage — the org's BYO bucket admin (orgSettings gate). */
function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ObjectStorageError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

const connectionSchema = z.object({
  region: z.string().min(1).max(100),
  endpoint: z.string().max(2_000).optional(),
  forcePathStyle: z.boolean().optional(),
  bucket: z.string().min(1).max(255),
  prefix: z.string().max(500).optional(),
});

export function createObjectStorageRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  app.use(async (c, next) => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json(
        {
          error: 'ORG_FORBIDDEN',
          message: `Role "${c.get('orgMember').role}" cannot manage the object-storage connection.`,
        },
        403,
      );
    }
    return next();
  });

  const orgSlugOf = async (c: Context<OrgEnv>): Promise<string | null> =>
    resolveOrgSlug(deps.sql, c.get('orgId'));

  app.get('/connection', async (c) => {
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    return c.json(await readConnectionView(orgSlug));
  });

  app.post('/connection', async (c) => {
    const body = connectionSchema
      .extend({
        accessKeyId: z.string().max(500).optional(),
        secretAccessKey: z.string().max(500).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { accessKeyId, secretAccessKey, ...connection } = body.data;
    try {
      await writeConnection(orgSlug, {
        connection,
        ...(accessKeyId !== undefined ? { accessKeyId } : {}),
        ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/connection', async (c) => {
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    await deleteConnection(orgSlug);
    return c.json({ ok: true });
  });

  app.post('/connection/test', async (c) => {
    const body = connectionSchema
      .extend({
        accessKeyId: z.string().max(500).optional(),
        secretAccessKey: z.string().max(500).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const { accessKeyId, secretAccessKey, ...connection } = body.data;
    try {
      return c.json(
        await probeConnection({
          connection,
          ...(accessKeyId !== undefined ? { accessKeyId } : {}),
          ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
          orgSlug,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/backfill', async (c) => {
    const body = z
      .object({ dryRun: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await orgSlugOf(c);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const dryRun = body.data.dryRun ?? false;
    try {
      if (!dryRun) {
        const connection = await readConnectionView(orgSlug);
        if (!connection.configured) {
          throw new ObjectStorageError(
            'NOT_CONFIGURED',
            'Configure the object-storage connection before moving existing blobs into it.',
          );
        }
      }
      const runId = await createBackfillRun(deps.sql, {
        organizationId: c.get('orgId'),
        orgSlug,
        dryRun,
        triggeredBy: c.get('sessionBundle').user.id,
      });
      await deps.sql.begin((tx) =>
        addJobInTx(tx, 'object_storage.backfill', {
          runId,
          organizationId: c.get('orgId'),
        }),
      );
      return c.json({ runId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/backfill/status', async (c) => {
    return c.json({
      status: await getBackfillStatus(deps.sql, c.get('orgId')),
    });
  });

  return app;
}
