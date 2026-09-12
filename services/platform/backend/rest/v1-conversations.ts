import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  API_DELIVERY_STATUSES,
  apiDeliveryFailureSchema,
  apiExternalIdSchema,
} from '../../lib/shared/conversations/api-sync.ts';
import {
  acknowledgeApiDelivery,
  apiDeliveryAttachment,
  apiSnapshotSchema,
  apiSnapshotState,
  apiSourceSchema,
  claimApiDeliveries,
  failApiDelivery,
  listApiDeliveries,
  retryApiDeliveryForSource,
  synchronizeConversation,
} from '../domains/conversations/api-sync.ts';
import {
  viewerCanWrite,
  type ConversationViewer,
} from '../domains/conversations/service.ts';
import { readBodyBounded } from '../domains/files/bounded-body.ts';
import {
  deleteOrgBlobRefs,
  FileError,
  getOrgBlobBytes,
  putOrgBlobBytes,
} from '../domains/files/service.ts';
import { recordUploadIntent } from '../domains/files/upload-intents.ts';
import {
  chargeLane,
  domainErrorResponse,
  formatKeysetCursor,
  mintCursor,
  noQuery,
  notFound,
  PAGE_QUERY,
  parseBody,
  readKeysetCursor,
  readPageLimit,
  readQuery,
  type RestEnv,
  restBodyLimit,
} from './shared.ts';

/** Org-explicit, key-holder-owned external Inbox sources. No email side effects. */
/** A snapshot carries a whole conversation — larger than the door's
 * default body cap, bounded here instead. */
const SYNC_BODY_BYTES = 8 * 1024 * 1024;

export function createConversationRestRoutes(deps: {
  sql: Sql;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();
  // The organization is the door's business (a multi-org key names it on
  // every call); this family only gates on the role.
  app.use('/conversations/*', async (c, next) => {
    if (!viewerCanWrite(c.get('role')))
      return c.json(
        {
          error: `Role "${c.get('role')}" cannot manage conversations.`,
          code: 'ROLE_FORBIDDEN',
        },
        403,
      );
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
    const query = readQuery(c, {
      source: apiSourceSchema,
      externalId: apiExternalIdSchema,
    });
    if (query instanceof Response) return query;
    try {
      return c.json({
        snapshot: await apiSnapshotState(
          deps.sql,
          viewer(c),
          query.source,
          query.externalId,
        ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  app.post('/conversations/sync', restBodyLimit(SYNC_BODY_BYTES), async (c) => {
    const body = await parseBody(c, apiSnapshotSchema, {
      maxBytes: SYNC_BODY_BYTES,
    });
    if (body instanceof Response) return body;
    try {
      return c.json(await synchronizeConversation(deps.sql, viewer(c), body));
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  /**
   * The queue without claiming it: the rows a source's consumer would
   * otherwise learn about only by taking a lease on them. Keyset-paginated
   * in claim order (`retryAt`, `messageId`); the cursor is signed under the
   * source, so one source's page never redeems on another's.
   */
  app.get('/conversations/deliveries', async (c) => {
    const query = readQuery(c, {
      source: apiSourceSchema,
      status: z.enum(API_DELIVERY_STATUSES).optional(),
      ...PAGE_QUERY,
    });
    if (query instanceof Response) return query;
    const list = `conversation-deliveries:${query.source}`;
    const cursor = readKeysetCursor(c, list);
    if (cursor instanceof Response) return cursor;
    const limit = readPageLimit(c, { fallback: 50, max: 200 });
    if (limit instanceof Response) return limit;
    try {
      const result = await listApiDeliveries(
        deps.sql,
        viewer(c),
        query.source,
        {
          ...(query.status === undefined ? {} : { status: query.status }),
          cursor,
          limit,
        },
      );
      return c.json({
        deliveries: result.deliveries,
        isDone: result.nextCursor === null,
        continueCursor:
          result.nextCursor === null
            ? ''
            : mintCursor(
                c,
                list,
                formatKeysetCursor(result.nextCursor.at, result.nextCursor.id),
              ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  /** Re-drive a dead-lettered delivery — the Inbox's Retry, for the
   * source's own consumer. No body. */
  app.post('/conversations/deliveries/:id/retry', async (c) => {
    try {
      return c.json(
        await retryApiDeliveryForSource(
          deps.sql,
          viewer(c),
          c.req.param('id'),
          c.get('userEmail'),
        ),
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  app.post(
    '/conversations/deliveries/claim',
    restBodyLimit(64 * 1024),
    async (c) => {
      const body = await parseBody(
        c,
        z.strictObject({
          source: apiSourceSchema,
          limit: z.number().int().min(1).max(100).default(100),
        }),
      );
      if (body instanceof Response) return body;
      try {
        return c.json({
          deliveries: await claimApiDeliveries(
            deps.sql,
            viewer(c),
            body.source,
            body.limit,
          ),
        });
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    },
  );
  app.post(
    '/conversations/deliveries/:id/fail',
    restBodyLimit(64 * 1024),
    async (c) => {
      const body = await parseBody(c, apiDeliveryFailureSchema);
      if (body instanceof Response) return body;
      try {
        return c.json(
          await failApiDelivery(deps.sql, viewer(c), c.req.param('id'), body),
        );
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    },
  );
  app.post(
    '/conversations/deliveries/:id/ack',
    restBodyLimit(64 * 1024),
    async (c) => {
      const body = await parseBody(
        c,
        z.strictObject({
          receiptId: apiExternalIdSchema,
          sourceVersion: z.number().int().min(0),
        }),
      );
      if (body instanceof Response) return body;
      try {
        return c.json(
          await acknowledgeApiDelivery(
            deps.sql,
            viewer(c),
            c.req.param('id'),
            body.receiptId,
            body.sourceVersion,
          ),
        );
      } catch (error) {
        return domainErrorResponse(c, error);
      }
    },
  );
  app.get(
    '/conversations/deliveries/:id/attachments/:index',
    noQuery,
    async (c) => {
      const index = z.coerce
        .number()
        .int()
        .min(0)
        .max(9)
        .safeParse(c.req.param('index'));
      // A delivery carries at most ten attachments; a segment that names no
      // whole number in that range names no attachment at all (the delivery
      // itself is looked up first below, so a missing delivery is still
      // told apart by its own code).
      if (!index.success) {
        return notFound(c, 'Attachment not found', 'ATTACHMENT_NOT_FOUND');
      }
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
    },
  );
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
      // The bounded read refuses an oversized body with the files domain's
      // own 413; on this door every 413 is the documented `BODY_TOO_LARGE`.
      if (error instanceof FileError && error.status === 413) {
        return c.json({ error: error.message, code: 'BODY_TOO_LARGE' }, 413);
      }
      return domainErrorResponse(c, error);
    }
  });
  return app;
}
