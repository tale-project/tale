import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { findCredentialForRef } from '../domains/connector_credentials/service.ts';
import { findOrCreateContactByExternalId } from '../domains/contacts/service.ts';
import {
  addMessageToConversation,
  createConversation,
  listConversationMessages,
  listConversationsPage,
  loadVisibleConversation,
  projectConversationForView,
  updateConversation,
  viewerCanWrite,
  type ConversationStatus,
  type ConversationViewer,
} from '../domains/conversations/service.ts';
import {
  assertExplicitOrg,
  domainErrorResponse,
  readJsonBody,
  RestRefusal,
  type RestEnv,
} from './shared.ts';

/**
 * /api/v1 conversations — the machine door into the shared Inbox.
 *
 * Until now the Inbox could only be filled by syncing a mailbox, which means a
 * product that owns its own customer-facing surface (an in-app support widget,
 * a portal, a kiosk) could not use Tale as the place its staff answer from.
 * This family is the inbound half of that: the product POSTs its customers'
 * messages here, and staff reply in the Inbox like any other conversation. The
 * outbound half is the `webhook-channel` connector, which delivers those
 * replies back.
 *
 * Two things make it safe to point a second product at the same organization:
 *
 *  - **Every conversation records the CREDENTIAL it belongs to**, not just the
 *    connector. An API key identifies an organization, never which of its
 *    products is calling, so the caller NAMES its credential and the reply goes
 *    back to the instance the thread came from. Omitting it on a connector with
 *    exactly one credential is allowed — there is nothing to confuse.
 *  - **Writes are idempotent on `externalMessageId`.** A retrying client that
 *    already succeeded gets the conversation it made, not a second one; a
 *    duplicate customer message is dropped rather than shown twice.
 *
 * Reads run under the same assignment privacy the app surface applies: an
 * unassigned conversation is admin-triage only, so a key held by a plain member
 * sees what that member would see. Org-strict throughout, reads included — a
 * multi-org key must NAME its organization, the tasks/projects posture.
 */

/**
 * A file the customer attached, as a URL the Inbox can fetch it from.
 *
 * The sending product already stores the bytes; re-uploading them here would
 * make a second copy whose lifetime nobody owns. A URL keeps one copy and one
 * owner — at the cost that the link can expire, so a product that wants its
 * attachments to outlive their signed URLs should mint long-lived ones.
 */
const intakeAttachmentSchema = z
  .object({
    name: z.string().min(1).max(1024),
    contentType: z.string().max(255).optional(),
    size: z.number().int().nonnegative().optional(),
    url: z.string().url().max(4096),
  })
  .strict();

/** What a customer-sent message may carry. */
const messageSchema = z
  .object({
    body: z.string().min(1).max(100_000),
    /** The SENDER's id for this message — what makes a retry recognisable. */
    externalMessageId: z.string().min(1).max(512).optional(),
    sentAt: z.number().int().nonnegative().optional(),
    attachments: z.array(intakeAttachmentSchema).max(10).optional(),
  })
  .strict();

const contactSchema = z
  .object({
    /** The caller's OWN id for this person — the identity key. */
    externalId: z.string().min(1).max(512),
    name: z.string().max(512).optional(),
    email: z.string().max(512).optional(),
    phone: z.string().max(64).optional(),
  })
  .strict();

const createSchema = z
  .object({
    connectorName: z.string().min(1).max(64),
    /** Which credential of that connector carries this thread — by id or by
     * name. Optional only when the connector has exactly one. */
    credentialRef: z.string().min(1).max(256).optional(),
    /** Free text, stamped on the conversation. Anything but `email` takes the
     * non-mail reply path. */
    channel: z.string().min(1).max(64).default('api'),
    contact: contactSchema,
    subject: z.string().max(2000).optional(),
    message: messageSchema,
    priority: z.string().max(64).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    status: z.enum(['open', 'closed', 'spam', 'archived']).optional(),
    subject: z.string().max(2000).optional(),
    priority: z.string().max(64).optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    status: z.enum(['open', 'closed', 'spam', 'archived']).optional(),
    channel: z.string().max(64).optional(),
    connectorName: z.string().max(64).optional(),
    contactId: z.string().max(64).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export function createConversationRestRoutes(deps: {
  sql: Sql;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  const orgStrict = async (
    c: Context<RestEnv>,
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const ambiguous = await assertExplicitOrg(deps.sql, c);
    if (ambiguous) return ambiguous;
    return next();
  };
  app.use('/conversations', orgStrict);
  app.use('/conversations/*', orgStrict);

  const viewer = (c: Context<RestEnv>): ConversationViewer => ({
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });

  /** The Inbox's own write rule, not the REST editor rule — so a key and a
   * session admit exactly the same roles. */
  const requireConversationWrite = (c: Context<RestEnv>): void => {
    if (!viewerCanWrite(c.get('role'))) {
      throw new RestRefusal(
        `Role "${c.get('role')}" cannot modify conversations.`,
        403,
      );
    }
  };

  /**
   * The credential this thread replies through, as a stable id.
   *
   * Named: it must exist on that connector for this org. Unnamed: allowed only
   * when the connector has exactly one credential — with two, "the default" is
   * a coin flip between two products' endpoints, and a reply landing on the
   * wrong one is somebody else's customer data.
   */
  const resolveCredentialId = async (
    c: Context<RestEnv>,
    connectorSlug: string,
    credentialRef: string | undefined,
  ): Promise<string> => {
    const found = await findCredentialForRef(deps.sql, {
      organizationId: c.get('organizationId'),
      connectorSlug,
      ...(credentialRef !== undefined ? { credentialRef } : {}),
    });
    if (!found) {
      throw new RestRefusal(
        credentialRef === undefined
          ? `No default credential is configured for "${connectorSlug}" — add one in Settings → Connectors, or name one with credentialRef.`
          : `No credential "${credentialRef}" is configured for "${connectorSlug}".`,
        400,
      );
    }
    if (credentialRef === undefined) {
      const all = await deps.sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM app.connector_credentials
        WHERE org_id = ${c.get('organizationId')}
          AND connector_slug = ${connectorSlug}
      `;
      if ((all[0]?.count ?? 0) > 1) {
        throw new RestRefusal(
          `Connector "${connectorSlug}" has more than one credential — name the one this conversation belongs to with credentialRef, so its replies go back to the right instance.`,
          400,
        );
      }
    }
    return found.id;
  };

  /** The conversation an `externalMessageId` already created, if any. */
  const existingByExternalId = async (
    organizationId: string,
    externalMessageId: string,
  ): Promise<string | null> => {
    const rows = await deps.sql<{ id: string }[]>`
      SELECT id FROM app.conversations
      WHERE org_id = ${organizationId}
        AND external_message_id = ${externalMessageId}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  };

  // ---- open a thread ---------------------------------------------------
  app.post('/conversations', async (c) => {
    const body = createSchema.safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json(
        { error: 'invalid body', detail: z.prettifyError(body.error) },
        400,
      );
    }
    try {
      requireConversationWrite(c);
      const args = body.data;
      const organizationId = c.get('organizationId');

      // A retry that already succeeded answers with what it made.
      const externalMessageId = args.message.externalMessageId;
      if (externalMessageId !== undefined) {
        const existing = await existingByExternalId(
          organizationId,
          externalMessageId,
        );
        if (existing !== null) {
          return c.json({ conversationId: existing, created: false }, 200);
        }
      }

      const credentialId = await resolveCredentialId(
        c,
        args.connectorName,
        args.credentialRef,
      );

      const result = await deps.sql.begin(async (tx) => {
        const contact = await findOrCreateContactByExternalId(tx, {
          organizationId,
          externalId: args.contact.externalId,
          ...(args.contact.name !== undefined
            ? { name: args.contact.name }
            : {}),
          ...(args.contact.email !== undefined
            ? { email: args.contact.email }
            : {}),
          ...(args.contact.phone !== undefined
            ? { phone: args.contact.phone }
            : {}),
          // The same source the mailbox ingest stamps: this contact exists
          // because a conversation arrived, which is what `source` records —
          // not the wire it came over. `api_import` means a bulk contact load,
          // and support correspondents would pollute that audit.
          source: 'conversation',
          metadata: { createdFrom: args.connectorName },
        });
        const conversationId = await createConversation(tx, {
          organizationId,
          contactId: contact.contactId,
          ...(externalMessageId !== undefined ? { externalMessageId } : {}),
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          status: 'open',
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          channel: args.channel,
          direction: 'inbound',
          connectorName: args.connectorName,
          credentialId,
          ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
        });
        const message = await addMessageToConversation(tx, {
          conversationId,
          organizationId,
          sender: args.contact.externalId,
          content: args.message.body,
          isCustomer: true,
          ...(externalMessageId !== undefined ? { externalMessageId } : {}),
          ...(args.message.sentAt !== undefined
            ? { sentAt: args.message.sentAt }
            : {}),
          ...(args.message.attachments?.length
            ? { attachments: args.message.attachments }
            : {}),
          connectorName: args.connectorName,
        });
        return {
          conversationId,
          contactId: contact.contactId,
          messageId: message.messageId,
        };
      });
      return c.json({ ...result, created: true }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- append a customer message --------------------------------------
  app.post('/conversations/:id/messages', async (c) => {
    const body = messageSchema.safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json(
        { error: 'invalid body', detail: z.prettifyError(body.error) },
        400,
      );
    }
    try {
      requireConversationWrite(c);
      const conversation = await loadVisibleConversation(
        deps.sql,
        viewer(c),
        c.req.param('id'),
      );
      const organizationId = c.get('organizationId');
      const externalMessageId = body.data.externalMessageId;

      if (externalMessageId !== undefined) {
        const seen = await deps.sql<{ id: string }[]>`
          SELECT id FROM app.conversation_messages
          WHERE org_id = ${organizationId}
            AND external_message_id = ${externalMessageId}
          LIMIT 1
        `;
        if (seen[0]) {
          return c.json(
            {
              conversationId: conversation.id,
              messageId: seen[0].id,
              created: false,
            },
            200,
          );
        }
      }

      const result = await deps.sql.begin((tx) =>
        addMessageToConversation(tx, {
          conversationId: conversation.id,
          organizationId,
          sender: conversation.contactId ?? 'external',
          content: body.data.body,
          isCustomer: true,
          ...(externalMessageId !== undefined ? { externalMessageId } : {}),
          ...(body.data.sentAt !== undefined
            ? { sentAt: body.data.sentAt }
            : {}),
          ...(body.data.attachments?.length
            ? { attachments: body.data.attachments }
            : {}),
          ...(conversation.connectorName !== null
            ? { connectorName: conversation.connectorName }
            : {}),
        }),
      );
      return c.json({ ...result, created: true }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- read ------------------------------------------------------------
  app.get('/conversations', async (c) => {
    const query = listQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: 'invalid query', detail: z.prettifyError(query.error) },
        400,
      );
    }
    try {
      const page = await listConversationsPage(deps.sql, viewer(c), {
        ...(query.data.status !== undefined
          ? { status: query.data.status }
          : {}),
        ...(query.data.channel !== undefined
          ? { channel: query.data.channel }
          : {}),
        ...(query.data.connectorName !== undefined
          ? { connectorName: query.data.connectorName }
          : {}),
        ...(query.data.contactId !== undefined
          ? { contactId: query.data.contactId }
          : {}),
        cursor: query.data.cursor ?? null,
        limit: query.data.limit,
      });
      return c.json({
        conversations: page.items,
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/conversations/:id', async (c) => {
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
      return c.json(
        await projectConversationForView(deps.sql, conversation, messages),
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- close and reopen from the customer's side -----------------------
  app.patch('/conversations/:id', async (c) => {
    const body = patchSchema.safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json(
        { error: 'invalid body', detail: z.prettifyError(body.error) },
        400,
      );
    }
    try {
      requireConversationWrite(c);
      const conversation = await loadVisibleConversation(
        deps.sql,
        viewer(c),
        c.req.param('id'),
      );
      await deps.sql.begin((tx) =>
        updateConversation(
          tx,
          c.get('organizationId'),
          conversation.id,
          {
            ...(body.data.status !== undefined
              ? { status: body.data.status satisfies ConversationStatus }
              : {}),
            ...(body.data.subject !== undefined
              ? { subject: body.data.subject }
              : {}),
            ...(body.data.priority !== undefined
              ? { priority: body.data.priority }
              : {}),
          },
          { userId: c.get('userId') },
        ),
      );
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  return app;
}
