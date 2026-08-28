import { ConvexError } from 'convex/values';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  bulkReplyToConversations,
  composeEmailConversation,
  discardOutboundMessage,
  replyToConversation,
  retrySendMessage,
  undoSendMessage,
} from './send.ts';
import {
  assignConversation,
  assignConversationTeam,
  addMessageToConversation,
  bulkSetConversationStatus,
  ConversationError,
  countConversationsByStatus,
  countUnreadConversations,
  deleteConversation,
  listConversationMessages,
  listConversationsPage,
  loadVisibleConversation,
  markConversationAsRead,
  updateConversation,
  type ConversationViewer,
} from './service.ts';

/**
 * /api/app/conversations — the shared Inbox surface. Reads are
 * assignment-scoped through the reused predicate (an unassigned row is
 * admin-triage only); assignment writes are admin-gated in the service.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ConversationError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  // The reused attachment-cap validator refuses with coded ConvexErrors.
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data !== null && typeof data === 'object' && 'code' in data) {
      const code = Reflect.get(data, 'code');
      if (
        typeof code === 'string' &&
        code.startsWith('CONVERSATION_ATTACHMENT')
      ) {
        return c.json({ error: code, message: code }, 400);
      }
    }
  }
  throw error;
}

const attachmentSchema = z.object({
  storageId: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
});

const statusSchema = z.enum(['open', 'closed', 'spam', 'archived']);

export function createConversationRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const viewer = (c: Context<OrgEnv>): ConversationViewer => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
    role: c.get('orgMember').role,
  });
  const actor = (c: Context<OrgEnv>) => ({
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
    role: c.get('orgMember').role,
  });

  app.get('/', async (c) => {
    const status = c.req.query('status');
    if (status !== undefined && !statusSchema.safeParse(status).success) {
      return c.json({ error: 'invalid status' }, 400);
    }
    const limitRaw = Number(c.req.query('limit') ?? '25');
    const result = await listConversationsPage(deps.sql, viewer(c), {
      ...(status !== undefined
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by statusSchema above
          { status: status as never }
        : {}),
      ...(c.req.query('priority') !== undefined
        ? { priority: c.req.query('priority') ?? '' }
        : {}),
      ...(c.req.query('channel') !== undefined
        ? { channel: c.req.query('channel') ?? '' }
        : {}),
      ...(c.req.query('connector') !== undefined
        ? { connectorName: c.req.query('connector') ?? '' }
        : {}),
      ...(c.req.query('contactId') !== undefined
        ? { contactId: c.req.query('contactId') ?? '' }
        : {}),
      cursor: c.req.query('cursor') ?? null,
      limit: Number.isFinite(limitRaw) ? limitRaw : 25,
    });
    return c.json(result);
  });

  app.get('/counts', async (c) => {
    return c.json({
      byStatus: await countConversationsByStatus(
        deps.sql,
        c.get('orgId'),
        c.req.query('connector') ?? undefined,
      ),
      unread: await countUnreadConversations(
        deps.sql,
        c.get('orgId'),
        c.req.query('connector') ?? undefined,
      ),
    });
  });

  app.get('/:id', async (c) => {
    try {
      const conversation = await loadVisibleConversation(
        deps.sql,
        viewer(c),
        c.req.param('id'),
      );
      const messages = await listConversationMessages(
        deps.sql,
        conversation.id,
      );
      return c.json({ conversation, messages });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.patch('/:id', async (c) => {
    const body = z
      .object({
        contactId: z.string().max(64).optional(),
        subject: z.string().max(1000).optional(),
        status: statusSchema.optional(),
        priority: z.string().max(50).optional(),
        type: z.string().max(50).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await loadVisibleConversation(deps.sql, viewer(c), c.req.param('id'));
      await deps.sql.begin((tx) =>
        updateConversation(tx, c.get('orgId'), c.req.param('id'), body.data),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/read', async (c) => {
    try {
      await loadVisibleConversation(deps.sql, viewer(c), c.req.param('id'));
      await deps.sql.begin((tx) =>
        markConversationAsRead(tx, c.get('orgId'), c.req.param('id')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Append a message (an internal note or a manually logged reply — the
   * connector SEND lane is its own increment). */
  app.post('/:id/messages', async (c) => {
    const body = z
      .object({
        content: z.string().min(1).max(200_000),
        isCustomer: z.boolean().optional(),
        externalMessageId: z.string().max(512).optional(),
        sentAt: z.number().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await loadVisibleConversation(deps.sql, viewer(c), c.req.param('id'));
      const result = await deps.sql.begin((tx) =>
        addMessageToConversation(tx, {
          conversationId: c.req.param('id'),
          organizationId: c.get('orgId'),
          sender: c.get('sessionBundle').user.id,
          content: body.data.content,
          isCustomer: body.data.isCustomer ?? false,
          ...(body.data.externalMessageId !== undefined
            ? { externalMessageId: body.data.externalMessageId }
            : {}),
          ...(body.data.sentAt !== undefined
            ? { sentAt: body.data.sentAt }
            : {}),
          ...(body.data.metadata !== undefined
            ? { metadata: body.data.metadata }
            : {}),
        }),
      );
      return c.json(result, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/assign', async (c) => {
    const body = z
      .object({ assigneeUserId: z.string().max(128).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await assignConversation(deps.sql, {
        organizationId: c.get('orgId'),
        conversationId: c.req.param('id'),
        assigneeUserId: body.data.assigneeUserId ?? null,
        actor: actor(c),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/assign-team', async (c) => {
    const body = z
      .object({ assigneeTeamId: z.string().max(128).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await assignConversationTeam(deps.sql, {
        organizationId: c.get('orgId'),
        conversationId: c.req.param('id'),
        assigneeTeamId: body.data.assigneeTeamId ?? null,
        actor: actor(c),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** One reply body to many conversations (cap 50, partial failure). */
  app.post('/bulk/reply', async (c) => {
    const body = z
      .object({
        conversationIds: z.array(z.string().max(64)).min(1).max(200),
        content: z.string().min(1).max(200_000),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    // Scope every named row through the viewer's own visibility first.
    const scoped: string[] = [];
    const errors: string[] = [];
    for (const id of body.data.conversationIds) {
      try {
        await loadVisibleConversation(deps.sql, viewer(c), id);
        scoped.push(id);
      } catch {
        errors.push(`Conversation ${id} not found`);
      }
    }
    try {
      const result = await bulkReplyToConversations(deps.sql, {
        organizationId: c.get('orgId'),
        conversationIds: scoped,
        content: body.data.content,
        actor: actor(c),
      });
      return c.json({
        ...result,
        failedCount: result.failedCount + errors.length,
        errors: [...errors, ...result.errors],
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Send a reply through the conversation's connector (undo window). */
  app.post('/:id/reply', async (c) => {
    const body = z
      .object({
        content: z.string().min(1).max(200_000),
        sourceMarkdown: z.string().max(200_000).optional(),
        attachments: z.array(attachmentSchema).max(50).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await loadVisibleConversation(deps.sql, viewer(c), c.req.param('id'));
      const messageId = await replyToConversation(deps.sql, {
        conversationId: c.req.param('id'),
        organizationId: c.get('orgId'),
        content: body.data.content,
        ...(body.data.sourceMarkdown !== undefined
          ? { sourceMarkdown: body.data.sourceMarkdown }
          : {}),
        ...(body.data.attachments?.length
          ? { attachments: body.data.attachments }
          : {}),
        actor: actor(c),
      });
      return c.json({ messageId }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Start a new outbound email conversation with a contact. */
  app.post('/compose', async (c) => {
    const body = z
      .object({
        contactId: z.string().min(1).max(64),
        connectorName: z.string().min(1).max(128),
        subject: z.string().min(1).max(1000),
        content: z.string().min(1).max(200_000),
        sourceMarkdown: z.string().max(200_000).optional(),
        from: z.string().max(320).optional(),
        assigneeUserId: z.string().max(128).optional(),
        attachments: z.array(attachmentSchema).max(50).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const result = await composeEmailConversation(deps.sql, {
        organizationId: c.get('orgId'),
        contactId: body.data.contactId,
        connectorName: body.data.connectorName,
        subject: body.data.subject,
        content: body.data.content,
        ...(body.data.sourceMarkdown !== undefined
          ? { sourceMarkdown: body.data.sourceMarkdown }
          : {}),
        ...(body.data.from !== undefined ? { from: body.data.from } : {}),
        ...(body.data.assigneeUserId !== undefined
          ? { assigneeUserId: body.data.assigneeUserId }
          : {}),
        ...(body.data.attachments?.length
          ? { attachments: body.data.attachments }
          : {}),
        actor: actor(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Cancel a still-queued send; hands the composer draft back. */
  app.post('/messages/:messageId/undo', async (c) => {
    try {
      const result = await undoSendMessage(deps.sql, {
        organizationId: c.get('orgId'),
        messageId: c.req.param('messageId'),
        actor: actor(c),
      });
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Re-attempt a failed send immediately (no undo window). */
  app.post('/messages/:messageId/retry', async (c) => {
    try {
      await retrySendMessage(deps.sql, {
        organizationId: c.get('orgId'),
        messageId: c.req.param('messageId'),
        actor: actor(c),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Remove a failed outbound bubble — the email never left. */
  app.post('/messages/:messageId/discard', async (c) => {
    try {
      await discardOutboundMessage(deps.sql, {
        organizationId: c.get('orgId'),
        messageId: c.req.param('messageId'),
        actor: actor(c),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/bulk/:verb', async (c) => {
    const verb = z
      .enum(['close', 'reopen', 'spam', 'archive', 'unarchive'])
      .safeParse(c.req.param('verb'));
    if (!verb.success) return c.json({ error: 'unknown bulk verb' }, 404);
    const body = z
      .object({ conversationIds: z.array(z.string().max(64)).min(1).max(200) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    // Scope every named row through the viewer's own visibility first.
    const scoped: string[] = [];
    const errors: string[] = [];
    for (const id of body.data.conversationIds) {
      try {
        await loadVisibleConversation(deps.sql, viewer(c), id);
        scoped.push(id);
      } catch {
        errors.push(`Conversation ${id} not found`);
      }
    }
    const result = await bulkSetConversationStatus(deps.sql, {
      organizationId: c.get('orgId'),
      conversationIds: scoped,
      verb: verb.data,
      actor: actor(c),
    });
    return c.json({
      ...result,
      failedCount: result.failedCount + errors.length,
      errors: [...errors, ...result.errors],
    });
  });

  app.delete('/:id', async (c) => {
    try {
      await loadVisibleConversation(deps.sql, viewer(c), c.req.param('id'));
      await deleteConversation(deps.sql, c.get('orgId'), c.req.param('id'));
      return c.body(null, 204);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
