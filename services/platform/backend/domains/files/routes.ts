import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import {
  createUploadHandoff,
  deleteFile,
  FileError,
  getFileMetadata,
  getFileUrl,
  registerUpload,
} from './service.ts';

const handoffSchema = z.object({
  contentType: z.string().min(1).max(255),
  size: z.number().int().positive(),
});

const registerSchema = z.object({
  storageRef: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
  threadId: z.string().max(200).optional(),
  source: z.string().max(100).optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof FileError) {
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

/** /api/app/files — upload handshake, presigned serve, delete. */
export function createFileRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.post('/upload-handoff', async (c) => {
    const body = handoffSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const userId = c.get('sessionBundle').user.id;
      await checkUserRateLimit(deps.sql, 'file:upload', userId);
      return c.json(
        await createUploadHandoff(
          deps.sql,
          { organizationId: c.get('orgId') },
          body.data,
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/register', async (c) => {
    const body = registerSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
      };
      const result = await transactSerializable(deps.sql, (tx) =>
        registerUpload(deps.sql, tx, scope, body.data),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:fileId', async (c) => {
    try {
      const meta = await getFileMetadata(
        deps.sql,
        c.get('orgId'),
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ error: 'FILE_NOT_FOUND' }, 404);
      }
      return c.json({ file: meta });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:fileId/url', async (c) => {
    try {
      const orgId = c.get('orgId');
      const meta = await getFileMetadata(
        deps.sql,
        orgId,
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ error: 'FILE_NOT_FOUND' }, 404);
      }
      const url = await getFileUrl(
        deps.sql,
        { organizationId: orgId },
        meta.storageRef,
      );
      return c.json({ url });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:fileId', async (c) => {
    try {
      const orgId = c.get('orgId');
      const session = c.get('sessionBundle');
      const meta = await getFileMetadata(
        deps.sql,
        orgId,
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ ok: true });
      }
      const role = c.get('orgMember').role;
      const isAdmin = role === 'owner' || role === 'admin';
      if (!isAdmin && meta.uploadedBy !== session.user.id) {
        return c.json({ error: 'FILE_DELETE_FORBIDDEN' }, 403);
      }
      await transactSerializable(deps.sql, (tx) =>
        deleteFile(deps.sql, tx, { organizationId: orgId }, meta.id),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
