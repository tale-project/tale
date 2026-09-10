import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { apiDeliveryFailureSchema } from '../../lib/shared/conversations/api-sync.ts';
import {
  acknowledgeApiDelivery,
  apiDeliveryAttachment,
  apiSnapshotSchema,
  apiSnapshotState,
  apiSourceSchema,
  claimApiDeliveries,
  failApiDelivery,
  synchronizeConversation,
} from '../domains/conversations/api-sync.ts';
import {
  viewerCanWrite,
  type ConversationViewer,
} from '../domains/conversations/service.ts';
import { readBodyBounded } from '../domains/files/bounded-body.ts';
import {
  deleteOrgBlobRefs,
  getOrgBlobBytes,
  putOrgBlobBytes,
} from '../domains/files/service.ts';
import { recordUploadIntent } from '../domains/files/upload-intents.ts';
import {
  chargeLane,
  domainErrorResponse,
  invalidBodyResponse,
  readJsonBody,
  type RestEnv,
} from './shared.ts';

/** Org-explicit, key-holder-owned external Inbox sources. No email side effects. */
export function createConversationRestRoutes(deps: {
  sql: Sql;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();
  app.use('/conversations/*', async (c, next) => {
    if (!c.get('orgExplicit'))
      return c.json({ error: 'X-Organization-Slug is required' }, 400);
    if (!viewerCanWrite(c.get('role')))
      return c.json({ error: 'FORBIDDEN' }, 403);
    return next();
  });
  const viewer = (c: {
    get: (key: 'organizationId' | 'userId' | 'role') => string;
  }): ConversationViewer => ({
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });

  app.get('/conversations/sync', async (c) => {
    const query = z
      .object({
        source: apiSourceSchema,
        externalId: z.string().min(1).max(256),
      })
      .safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'invalid query' }, 400);
    try {
      return c.json({
        snapshot: await apiSnapshotState(
          deps.sql,
          viewer(c),
          query.data.source,
          query.data.externalId,
        ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  app.post(
    '/conversations/sync',
    bodyLimit({ maxSize: 8 * 1024 * 1024 }),
    async (c) => {
      const body = apiSnapshotSchema.safeParse(await readJsonBody(c));
      if (!body.success) return invalidBodyResponse(c, body.error);
      try {
        return c.json(
          await synchronizeConversation(deps.sql, viewer(c), body.data),
        );
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    },
  );
  app.post(
    '/conversations/deliveries/claim',
    bodyLimit({ maxSize: 64 * 1024 }),
    async (c) => {
      const body = z
        .object({
          source: apiSourceSchema,
          limit: z.number().int().min(1).max(100).default(100),
        })
        .safeParse(await readJsonBody(c));
      if (!body.success) return invalidBodyResponse(c, body.error);
      try {
        return c.json({
          deliveries: await claimApiDeliveries(
            deps.sql,
            viewer(c),
            body.data.source,
            body.data.limit,
          ),
        });
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    },
  );
  app.post(
    '/conversations/deliveries/:id/fail',
    bodyLimit({ maxSize: 64 * 1024 }),
    async (c) => {
      const body = apiDeliveryFailureSchema.safeParse(await readJsonBody(c));
      if (!body.success) return invalidBodyResponse(c, body.error);
      try {
        return c.json(
          await failApiDelivery(
            deps.sql,
            viewer(c),
            c.req.param('id'),
            body.data,
          ),
        );
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    },
  );
  app.post(
    '/conversations/deliveries/:id/ack',
    bodyLimit({ maxSize: 64 * 1024 }),
    async (c) => {
      const body = z
        .object({
          receiptId: z.string().min(1).max(256),
          sourceVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        })
        .safeParse(await readJsonBody(c));
      if (!body.success) return invalidBodyResponse(c, body.error);
      try {
        return c.json(
          await acknowledgeApiDelivery(
            deps.sql,
            viewer(c),
            c.req.param('id'),
            body.data.receiptId,
            body.data.sourceVersion,
          ),
        );
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    },
  );
  app.get('/conversations/deliveries/:id/attachments/:index', async (c) => {
    const index = z.coerce
      .number()
      .int()
      .min(0)
      .max(9)
      .safeParse(c.req.param('index'));
    if (!index.success) return c.json({ error: 'invalid index' }, 400);
    try {
      const attachment = await apiDeliveryAttachment(
        deps.sql,
        viewer(c),
        c.req.param('id'),
        index.data,
      );
      const { bytes } = await getOrgBlobBytes(
        deps.sql,
        c.get('organizationId'),
        attachment.storageId,
      );
      return new Response(new Uint8Array(bytes).buffer, {
        headers: {
          'Content-Type': attachment.contentType,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  app.post('/conversations/uploads', async (c) => {
    const limited = await chargeLane(deps.sql, c, 'rest:upload');
    if (limited) return limited;
    try {
      const bytes = await readBodyBounded(c.req.raw, 30 * 1024 * 1024);
      const storageId = await putOrgBlobBytes(
        deps.sql,
        c.get('organizationId'),
        {
          bytes,
          contentType:
            c.req.header('Content-Type') ?? 'application/octet-stream',
        },
      );
      try {
        await recordUploadIntent(deps.sql, {
          organizationId: c.get('organizationId'),
          userId: c.get('userId'),
          storageRef: storageId,
          purpose: 'file',
        });
      } catch (error) {
        await deleteOrgBlobRefs(deps.sql, c.get('organizationId'), [storageId]);
        throw error;
      }
      return c.json({ storageId });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  return app;
}
