import type { Sql, TransactionSql } from 'postgres';

import { projectConversationItem } from '../../../lib/shared/conversations/conversation-item.ts';
import { nextConversationLastMessageAt } from '../../../lib/shared/conversations/message-order.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import { conversationAssignmentAllows } from '../../core/lib/rls/helpers/conversation_assignment.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  notifyConversationAssigned,
  notifyConversationAssignedTeam,
} from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import { assertNotHeld } from '../legal_holds/service.ts';

/**
 * Conversations — the shared Inbox core, the 0.5 twin of
 * `convex/conversations/*` Tier A: conversation + message rows, the
 * assignment-scoped visibility rule (REUSED pure predicate — an unassigned
 * row is admin-triage only), status verbs and bulk operations with the 0.4
 * metadata stamps, unread accounting on `metadata.unread_count`, and the
 * chronological message walk on the sentAt→deliveredAt→createdAt contract.
 *
 * Ledger (with the send/sync increment): outbound send + undo/retry lanes,
 * mailbox ingest (Message-ID idempotency + threading), attachments
 * materialization, address routing, the chat search leg.
 */

export type ConversationStatus = 'open' | 'closed' | 'spam' | 'archived';

export class ConversationError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ConversationError';
    this.code = code;
    this.status = status;
  }
}

export interface ConversationRow {
  id: string;
  organizationId: string;
  contactId: string | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  externalMessageId: string | null;
  subject: string | null;
  status: ConversationStatus | null;
  priority: string | null;
  type: string | null;
  channel: string | null;
  direction: 'inbound' | 'outbound' | null;
  connectorName: string | null;
  lastMessageAt: number | null;
  metadata: Record<string, unknown> | null;
  lifecycleStatus: string | null;
  statusChangedAt: number | null;
  createdAt: number;
}

export const CONVERSATION_COLUMNS = `
  id, org_id AS "organizationId", contact_id AS "contactId",
  assignee_user_id AS "assigneeUserId", assignee_team_id AS "assigneeTeamId",
  external_message_id AS "externalMessageId", subject, status, priority,
  type, channel, direction, connector_name AS "connectorName",
  last_message_at_ms::float8 AS "lastMessageAt", metadata,
  lifecycle_status AS "lifecycleStatus",
  status_changed_at_ms::float8 AS "statusChangedAt",
  created_at_ms::float8 AS "createdAt"
`;

export interface ConversationMessageRow {
  id: string;
  organizationId: string;
  conversationId: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  externalMessageId: string | null;
  deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
  retryCount: number | null;
  connectorName: string | null;
  content: string;
  sentAt: number | null;
  deliveredAt: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export const MESSAGE_COLUMNS = `
  id, org_id AS "organizationId", conversation_id AS "conversationId",
  channel, direction, external_message_id AS "externalMessageId",
  delivery_state AS "deliveryState", retry_count AS "retryCount",
  connector_name AS "connectorName", content,
  sent_at_ms::float8 AS "sentAt", delivered_at_ms::float8 AS "deliveredAt",
  metadata, created_at_ms::float8 AS "createdAt"
`;

/** Who is reading — the assignment-privacy caller shape. */
export interface ConversationViewer {
  organizationId: string;
  userId: string;
  role: string;
}

export function viewerIsAdmin(role: string): boolean {
  const normalized = role.toLowerCase();
  return normalized === 'owner' || normalized === 'admin';
}

/** One conversation readable by the viewer, or the opaque 404. Evaluates the
 * REUSED assignment predicate (fail-closed; unassigned = admin only). */
export async function loadVisibleConversation(
  sql: Sql,
  viewer: ConversationViewer,
  conversationId: string,
): Promise<ConversationRow> {
  const rows = await sql<ConversationRow[]>`
    SELECT ${sql.unsafe(CONVERSATION_COLUMNS)} FROM app.conversations
    WHERE id = ${conversationId} AND org_id = ${viewer.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new ConversationError(
      'conversation_not_found',
      'Conversation not found',
      404,
    );
  }
  const allowed = await conversationAssignmentAllows(
    {
      assigneeUserId: row.assigneeUserId ?? undefined,
      assigneeTeamId: row.assigneeTeamId ?? undefined,
    },
    {
      isAdmin: viewerIsAdmin(viewer.role),
      userId: viewer.userId,
      hasTeam: async (teamId) =>
        (await getUserTeamIds(sql, viewer.userId)).includes(teamId),
    },
  );
  if (!allowed) {
    throw new ConversationError(
      'conversation_not_found',
      'Conversation not found',
      404,
    );
  }
  return row;
}

// ---------------------------------------------------------------- create

export interface CreateConversationArgs {
  organizationId: string;
  contactId?: string;
  assigneeUserId?: string;
  /** Team queue (Better Auth teamId). May sit alongside assigneeUserId. */
  assigneeTeamId?: string;
  externalMessageId?: string;
  subject?: string;
  status?: ConversationStatus;
  priority?: string;
  type?: string;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  connectorName?: string;
  metadata?: Record<string, unknown>;
}

export async function createConversation(
  tx: TransactionSql,
  args: CreateConversationArgs,
): Promise<string> {
  const now = Date.now();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.conversations (
      org_id, contact_id, assignee_user_id, assignee_team_id, external_message_id,
      subject, status, priority, type, channel, direction, connector_name,
      metadata, created_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.contactId ?? null},
      ${args.assigneeUserId ?? null}, ${args.assigneeTeamId ?? null},
      ${args.externalMessageId ?? null},
      ${args.subject ?? null}, ${args.status ?? 'open'},
      ${args.priority ?? null}, ${args.type ?? null}, ${args.channel ?? null},
      ${args.direction ?? null}, ${args.connectorName ?? null},
      ${args.metadata === undefined ? null : tx.json(toJson(args.metadata))},
      ${now}
    )
    RETURNING id
  `;
  const id = inserted[0]?.id;
  if (!id) throw new Error('conversation insert failed');
  await emitEvent(tx, {
    organizationId: args.organizationId,
    eventType: 'conversation.created',
    eventData: { conversationId: id, channel: args.channel ?? null },
  });
  await emitHintInTx(tx, {
    orgId: args.organizationId,
    entity: 'conversation',
    entityId: id,
  });
  return id;
}

// ---------------------------------------------------------------- messages

export interface AddMessageArgs {
  conversationId: string;
  organizationId: string;
  sender: string;
  content: string;
  isCustomer: boolean;
  status?: string;
  attachments?: unknown[];
  externalMessageId?: string;
  metadata?: Record<string, unknown>;
  sentAt?: number;
  deliveredAt?: number;
  connectorName?: string;
}

const DELIVERY_STATES = new Set(['queued', 'sent', 'delivered', 'failed']);

/**
 * Append one message (the 0.4 `addMessageToConversation` semantics):
 * delivery state from the caller's status or the direction default, the
 * conversation's `lastMessageAt` advanced monotonically on the shared
 * sentAt-first contract, an inbound customer message bumping
 * `metadata.unread_count`, and a never-stamped conversation HEALED with the
 * first connector name a message carries.
 */
export async function addMessageToConversation(
  tx: TransactionSql,
  args: AddMessageArgs,
): Promise<{ messageId: string; conversationId: string }> {
  const rows = await tx<ConversationRow[]>`
    SELECT ${tx.unsafe(CONVERSATION_COLUMNS)} FROM app.conversations
    WHERE id = ${args.conversationId} LIMIT 1
  `;
  const conversation = rows[0];
  if (!conversation) {
    throw new ConversationError(
      'conversation_not_found',
      'Parent conversation not found',
      404,
    );
  }
  if (conversation.organizationId !== args.organizationId) {
    throw new ConversationError(
      'conversation_org_mismatch',
      'Conversation does not belong to organization',
      403,
    );
  }

  const direction: 'inbound' | 'outbound' = args.isCustomer
    ? 'inbound'
    : 'outbound';
  const normalizedStatus = (args.status ?? '').toLowerCase();
  const deliveryState = DELIVERY_STATES.has(normalizedStatus)
    ? normalizedStatus
    : direction === 'inbound'
      ? 'delivered'
      : 'sent';
  const deliveredAt =
    args.deliveredAt ??
    (direction === 'inbound' && args.sentAt !== undefined
      ? args.sentAt
      : undefined);
  const now = Date.now();
  const messageMetadata = {
    sender: args.sender,
    isCustomer: args.isCustomer,
    ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    ...args.metadata,
  };

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.conversation_messages (
      org_id, conversation_id, channel, direction, external_message_id,
      delivery_state, connector_name, content, sent_at_ms, delivered_at_ms,
      metadata, created_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.conversationId},
      ${conversation.channel ?? 'unknown'}, ${direction},
      ${args.externalMessageId ?? null}, ${deliveryState},
      ${args.connectorName ?? null}, ${args.content},
      ${args.sentAt ?? null}, ${deliveredAt ?? null},
      ${tx.json(toJson(messageMetadata))}, ${now}
    )
    RETURNING id
  `;
  const messageId = inserted[0]?.id;
  if (!messageId) throw new Error('conversation message insert failed');

  const lastMessageAt = nextConversationLastMessageAt(
    conversation.lastMessageAt ?? undefined,
    {
      _id: messageId,
      _creationTime: now,
      ...(args.sentAt !== undefined ? { sentAt: args.sentAt } : {}),
      ...(deliveredAt !== undefined ? { deliveredAt } : {}),
    },
  );
  const existingMetadata = conversation.metadata ?? {};
  const unreadCount =
    (typeof existingMetadata.unread_count === 'number'
      ? existingMetadata.unread_count
      : 0) + (args.isCustomer ? 1 : 0);
  const healConnectorName =
    conversation.connectorName === null &&
    typeof args.connectorName === 'string' &&
    args.connectorName !== ''
      ? args.connectorName
      : conversation.connectorName;
  await tx`
    UPDATE app.conversations SET
      last_message_at_ms = ${lastMessageAt},
      connector_name = ${healConnectorName},
      metadata = ${tx.json(
        toJson({
          ...existingMetadata,
          last_message_at: lastMessageAt,
          unread_count: unreadCount,
        }),
      )}
    WHERE id = ${args.conversationId}
  `;
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.sender,
    actorType: args.isCustomer ? 'api' : 'user',
    action: 'add_message_to_conversation',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: messageId,
    newState: {
      conversationId: args.conversationId,
      direction,
      isCustomer: args.isCustomer,
      sender: args.sender,
    },
    status: 'success',
  });
  await emitEvent(tx, {
    organizationId: args.organizationId,
    eventType: 'conversation.message_received',
    eventData: {
      conversationId: args.conversationId,
      messageId,
      direction,
    },
  });
  await emitHintInTx(tx, {
    orgId: args.organizationId,
    entity: 'conversation',
    entityId: args.conversationId,
  });
  return { messageId, conversationId: args.conversationId };
}

/** A conversation's messages in the chronological display order. */
export async function listConversationMessages(
  sql: Sql,
  conversationId: string,
): Promise<ConversationMessageRow[]> {
  return sql<ConversationMessageRow[]>`
    SELECT ${sql.unsafe(MESSAGE_COLUMNS)} FROM app.conversation_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY coalesce(sent_at_ms, delivered_at_ms, created_at_ms) ASC, seq ASC
  `;
}

// ---------------------------------------------------------------- listing

export interface ConversationListItem extends ConversationRow {
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    locale: string | null;
    source: string | null;
  } | null;
  lastMessagePreview: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  unread: boolean;
}

const PREVIEW_MAX = 200;

function isUnread(metadata: Record<string, unknown> | null): boolean {
  const unread = metadata?.unread_count;
  return typeof unread === 'number' && unread > 0;
}

/**
 * Keyset-paginated Inbox listing, newest activity first, assignment-scoped
 * POST-page with the reused predicate (a page may run short, exactly like
 * the 0.4 RLS filter). Cursor = `<lastMessageAt>:<id>` of the last row.
 */
export async function listConversationsPage(
  sql: Sql,
  viewer: ConversationViewer,
  options: {
    status?: ConversationStatus;
    priority?: string;
    channel?: string;
    connectorName?: string;
    contactId?: string;
    cursor: string | null;
    limit: number;
  },
): Promise<{
  page: ConversationListItem[];
  isDone: boolean;
  continueCursor: string;
}> {
  const limit = Math.max(1, Math.min(options.limit, 100));
  let cursorLast: number | null = null;
  let cursorId: string | null = null;
  if (options.cursor !== null && options.cursor !== '') {
    const split = options.cursor.indexOf(':');
    const last = Number(options.cursor.slice(0, split));
    if (split > 0 && Number.isFinite(last)) {
      cursorLast = last;
      cursorId = options.cursor.slice(split + 1);
    }
  }
  const rows = await sql<ConversationRow[]>`
    SELECT ${sql.unsafe(CONVERSATION_COLUMNS)} FROM app.conversations
    WHERE org_id = ${viewer.organizationId}
      AND (${options.status ?? null}::text IS NULL
        OR status = ${options.status ?? null})
      AND (${options.priority ?? null}::text IS NULL
        OR priority = ${options.priority ?? null})
      AND (${options.channel ?? null}::text IS NULL
        OR channel = ${options.channel ?? null})
      AND (${options.connectorName ?? null}::text IS NULL
        OR connector_name = ${options.connectorName ?? null})
      AND (${options.contactId ?? null}::text IS NULL
        OR contact_id = ${options.contactId ?? null})
      AND (${cursorLast}::bigint IS NULL
        OR coalesce(last_message_at_ms, 0) < ${cursorLast}
        OR (coalesce(last_message_at_ms, 0) = ${cursorLast}
          AND id < ${cursorId}))
    ORDER BY coalesce(last_message_at_ms, 0) DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const raw = rows.slice(0, limit);
  const isDone = rows.length <= limit;
  const last = raw[raw.length - 1];

  // Assignment scope: admins see all; others need the reused predicate.
  const isAdmin = viewerIsAdmin(viewer.role);
  const teamIds = isAdmin
    ? new Set<string>()
    : new Set(await getUserTeamIds(sql, viewer.userId));
  const visible: ConversationRow[] = [];
  for (const row of raw) {
    const allowed = await conversationAssignmentAllows(
      {
        assigneeUserId: row.assigneeUserId ?? undefined,
        assigneeTeamId: row.assigneeTeamId ?? undefined,
      },
      {
        isAdmin,
        userId: viewer.userId,
        hasTeam: (teamId) => teamIds.has(teamId),
      },
    );
    if (allowed) visible.push(row);
  }

  // Batch the page's contacts + last messages (no N+1).
  const contactIds = [
    ...new Set(
      visible
        .map((row) => row.contactId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const contacts =
    contactIds.length > 0
      ? await sql<
          {
            id: string;
            name: string | null;
            email: string | null;
            locale: string | null;
            source: string | null;
          }[]
        >`
          SELECT id, name, email, locale, source FROM app.contacts
          WHERE id = ANY(${contactIds})
        `
      : [];
  const contactById = new Map(contacts.map((row) => [row.id, row]));
  const conversationIds = visible.map((row) => row.id);
  const lastMessages =
    conversationIds.length > 0
      ? await sql<
          { conversationId: string; content: string; direction: string }[]
        >`
          SELECT DISTINCT ON (conversation_id)
            conversation_id AS "conversationId", content, direction
          FROM app.conversation_messages
          WHERE conversation_id = ANY(${conversationIds})
          ORDER BY conversation_id,
            coalesce(sent_at_ms, delivered_at_ms, created_at_ms) DESC,
            seq DESC
        `
      : [];
  const lastByConversation = new Map(
    lastMessages.map((row) => [row.conversationId, row]),
  );

  return {
    page: visible.map((row) => {
      const lastMessage = lastByConversation.get(row.id);
      const item: ConversationListItem = Object.assign({}, row, {
        contact:
          row.contactId !== null
            ? (contactById.get(row.contactId) ?? null)
            : null,
        lastMessagePreview: lastMessage
          ? lastMessage.content.slice(0, PREVIEW_MAX)
          : null,
        lastMessageDirection: lastMessage
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column CHECK admits exactly the direction union
            (lastMessage.direction as 'inbound' | 'outbound')
          : null,
        unread: isUnread(row.metadata),
      });
      return item;
    }),
    isDone,
    continueCursor:
      isDone || !last ? '' : `${last.lastMessageAt ?? 0}:${last.id}`,
  };
}

/** Status tile counts (bounded like the 0.4 approx counters). */
export async function countConversationsByStatus(
  sql: Sql,
  organizationId: string,
  connectorName?: string,
): Promise<Record<string, number>> {
  const rows = await sql<{ status: string | null; count: string }[]>`
    SELECT status, count(*)::text AS count FROM app.conversations
    WHERE org_id = ${organizationId}
      AND (${connectorName ?? null}::text IS NULL
        OR connector_name = ${connectorName ?? null})
    GROUP BY status
  `;
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.status ?? 'unknown'] = Number(row.count);
  }
  return out;
}

/** Unread among OPEN conversations (`metadata.unread_count` positive). */
export async function countUnreadConversations(
  sql: Sql,
  organizationId: string,
  connectorName?: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.conversations
    WHERE org_id = ${organizationId} AND status = 'open'
      AND (${connectorName ?? null}::text IS NULL
        OR connector_name = ${connectorName ?? null})
      AND (metadata->>'unread_count')::numeric > 0
  `;
  return Number(rows[0]?.count ?? '0');
}

// ---------------------------------------------------------------- updates

export interface ConversationUpdates {
  contactId?: string;
  subject?: string;
  status?: ConversationStatus;
  priority?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export async function updateConversation(
  tx: TransactionSql,
  organizationId: string,
  conversationId: string,
  updates: ConversationUpdates,
): Promise<void> {
  const rows = await tx<{ id: string; metadata: unknown }[]>`
    SELECT id, metadata FROM app.conversations
    WHERE id = ${conversationId} AND org_id = ${organizationId} LIMIT 1
  `;
  if (rows.length === 0) {
    throw new ConversationError(
      'conversation_not_found',
      'Conversation not found',
      404,
    );
  }
  await tx`
    UPDATE app.conversations SET
      contact_id = ${updates.contactId ?? tx.unsafe('contact_id')},
      subject = ${updates.subject ?? tx.unsafe('subject')},
      status = ${updates.status ?? tx.unsafe('status')},
      status_changed_at_ms = ${updates.status !== undefined ? Date.now() : tx.unsafe('status_changed_at_ms')},
      priority = ${updates.priority ?? tx.unsafe('priority')},
      type = ${updates.type ?? tx.unsafe('type')},
      metadata = ${updates.metadata !== undefined ? tx.json(toJson(updates.metadata)) : tx.unsafe('metadata')}
    WHERE id = ${conversationId}
  `;
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: 'conversation',
    entityId: conversationId,
  });
}

/** Clear the unread marker (`mark_conversation_as_read` semantics). */
export async function markConversationAsRead(
  tx: TransactionSql,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  const rows = await tx<{ metadata: Record<string, unknown> | null }[]>`
    SELECT metadata FROM app.conversations
    WHERE id = ${conversationId} AND org_id = ${organizationId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new ConversationError(
      'conversation_not_found',
      'Conversation not found',
      404,
    );
  }
  await tx`
    UPDATE app.conversations SET metadata = ${tx.json(
      toJson({
        ...row.metadata,
        last_read_at: new Date().toISOString(),
        unread_count: 0,
      }),
    )}
    WHERE id = ${conversationId}
  `;
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: 'conversation',
    entityId: conversationId,
  });
}

// ---------------------------------------------------------------- assign

/** Admin-only individual assignment; unchanged = silent no-op; the new
 * assignee is notified (never on self-assignment or unassign). */
export async function assignConversation(
  sql: Sql,
  args: {
    organizationId: string;
    conversationId: string;
    assigneeUserId: string | null;
    actor: { userId: string; email?: string; role: string };
  },
): Promise<void> {
  if (!viewerIsAdmin(args.actor.role)) {
    throw new ConversationError(
      'FORBIDDEN',
      'Only admins can assign conversations',
      403,
    );
  }
  await sql.begin(async (tx) => {
    const rows = await tx<ConversationRow[]>`
      SELECT ${tx.unsafe(CONVERSATION_COLUMNS)} FROM app.conversations
      WHERE id = ${args.conversationId} AND org_id = ${args.organizationId}
      LIMIT 1
    `;
    const conversation = rows[0];
    if (!conversation) {
      throw new ConversationError(
        'conversation_not_found',
        'Conversation not found',
        404,
      );
    }
    const previous = conversation.assigneeUserId;
    const next = args.assigneeUserId;
    if (previous === next) return;
    await tx`
      UPDATE app.conversations SET assignee_user_id = ${next}
      WHERE id = ${args.conversationId}
    `;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: next ? 'assign_conversation' : 'unassign_conversation',
      category: 'data',
      resourceType: 'conversation',
      resourceId: args.conversationId,
      ...(conversation.subject !== null
        ? { resourceName: conversation.subject }
        : {}),
      previousState: { assigneeUserId: previous },
      newState: { assigneeUserId: next },
      status: 'success',
    });
    if (next && next !== args.actor.userId) {
      await notifyConversationAssigned(tx, {
        conversation: {
          id: conversation.id,
          organizationId: conversation.organizationId,
          subject: conversation.subject,
          status: conversation.status,
        },
        assigneeUserId: next,
        actorType: 'user',
        actorId: args.actor.userId,
      });
    }
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'conversation',
      entityId: args.conversationId,
    });
  });
}

/** Admin-only team queueing; validates the team's org; fans out to the
 * team's members (actor excluded). */
export async function assignConversationTeam(
  sql: Sql,
  args: {
    organizationId: string;
    conversationId: string;
    assigneeTeamId: string | null;
    actor: { userId: string; email?: string; role: string };
  },
): Promise<void> {
  if (!viewerIsAdmin(args.actor.role)) {
    throw new ConversationError(
      'FORBIDDEN',
      'Only admins can assign conversations',
      403,
    );
  }
  await sql.begin(async (tx) => {
    const rows = await tx<ConversationRow[]>`
      SELECT ${tx.unsafe(CONVERSATION_COLUMNS)} FROM app.conversations
      WHERE id = ${args.conversationId} AND org_id = ${args.organizationId}
      LIMIT 1
    `;
    const conversation = rows[0];
    if (!conversation) {
      throw new ConversationError(
        'conversation_not_found',
        'Conversation not found',
        404,
      );
    }
    const previous = conversation.assigneeTeamId;
    const next = args.assigneeTeamId;
    if (previous === next) return;
    if (next !== null) {
      const teams = await tx<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "team" WHERE "id" = ${next} LIMIT 1
      `;
      if (teams[0]?.organizationId !== args.organizationId) {
        throw new ConversationError(
          'team_not_in_org',
          'Team does not belong to this organization',
        );
      }
    }
    await tx`
      UPDATE app.conversations SET assignee_team_id = ${next}
      WHERE id = ${args.conversationId}
    `;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: next ? 'assign_conversation_team' : 'unassign_conversation_team',
      category: 'data',
      resourceType: 'conversation',
      resourceId: args.conversationId,
      ...(conversation.subject !== null
        ? { resourceName: conversation.subject }
        : {}),
      previousState: { assigneeTeamId: previous },
      newState: { assigneeTeamId: next },
      status: 'success',
    });
    if (next) {
      await notifyConversationAssignedTeam(tx, {
        conversation: {
          id: conversation.id,
          organizationId: conversation.organizationId,
          subject: conversation.subject,
          status: conversation.status,
        },
        teamId: next,
        actorUserId: args.actor.userId,
      });
    }
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'conversation',
      entityId: args.conversationId,
    });
  });
}

// ---------------------------------------------------------------- bulk ops

export interface BulkOperationResult {
  successCount: number;
  failedCount: number;
  errors: string[];
}

type BulkVerb = 'close' | 'reopen' | 'spam' | 'archive' | 'unarchive';

const BULK_TARGET: Record<
  BulkVerb,
  { status: ConversationStatus; audit: string }
> = {
  close: { status: 'closed', audit: 'bulk_close_conversations' },
  reopen: { status: 'open', audit: 'bulk_reopen_conversations' },
  spam: { status: 'spam', audit: 'bulk_spam_conversations' },
  archive: { status: 'archived', audit: 'bulk_archive_conversations' },
  unarchive: { status: 'open', audit: 'bulk_unarchive_conversations' },
};

/**
 * Bulk status flip (the 0.4 per-verb helpers folded onto one core — same
 * target statuses, same metadata stamps, one audit row for the batch).
 */
export async function bulkSetConversationStatus(
  sql: Sql,
  args: {
    organizationId: string;
    conversationIds: string[];
    verb: BulkVerb;
    actor: { userId: string; email?: string };
  },
): Promise<BulkOperationResult> {
  const target = BULK_TARGET[args.verb];
  const result: BulkOperationResult = {
    successCount: 0,
    failedCount: 0,
    errors: [],
  };
  const now = Date.now();
  await sql.begin(async (tx) => {
    for (const conversationId of args.conversationIds) {
      const rows = await tx<{ metadata: Record<string, unknown> | null }[]>`
        SELECT metadata FROM app.conversations
        WHERE id = ${conversationId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) {
        result.failedCount += 1;
        result.errors.push(`Conversation ${conversationId} not found`);
        continue;
      }
      const stamps: Record<string, unknown> =
        args.verb === 'close'
          ? {
              resolved_at: new Date(now).toISOString(),
              resolved_by: args.actor.userId,
            }
          : args.verb === 'spam'
            ? { marked_spam_at: new Date(now).toISOString() }
            : {};
      await tx`
        UPDATE app.conversations SET
          status = ${target.status}, status_changed_at_ms = ${now},
          metadata = ${tx.json(toJson({ ...row.metadata, ...stamps }))}
        WHERE id = ${conversationId}
      `;
      result.successCount += 1;
    }
    if (result.successCount > 0) {
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.actor.userId,
        ...(args.actor.email !== undefined
          ? { actorEmail: args.actor.email }
          : {}),
        actorType: 'user',
        action: target.audit,
        category: 'data',
        resourceType: 'conversation',
        resourceId: args.conversationIds[0] ?? '',
        metadata: {
          conversationIds: args.conversationIds,
          count: args.conversationIds.length,
          successCount: result.successCount,
          failedCount: result.failedCount,
        },
        status: 'success',
      });
    }
  });
  return result;
}

// ---------------------------------------------------------------- delete

/** Hard delete (0.4 semantics): messages cascade; org-level holds block. */
export async function deleteConversation(
  sql: Sql,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM app.conversations
      WHERE id = ${conversationId} AND org_id = ${organizationId} LIMIT 1
    `;
    if (rows.length === 0) {
      throw new ConversationError(
        'conversation_not_found',
        'Conversation not found',
        404,
      );
    }
    await assertNotHeld(tx, organizationId, 'conversation', conversationId);
    await tx`DELETE FROM app.conversations WHERE id = ${conversationId}`;
  });
}

/**
 * One conversation in the shape the Inbox reads — the SHARED projection
 * (`lib/shared/conversations/conversation-item.ts`), so this lane and 0.4
 * cannot drift into two different "same" shapes. `withMessages: false`
 * carries only the newest message, which is all a list row needs to show a
 * preview.
 */
export async function projectConversationForView(
  sql: Sql,
  conversation: ConversationRow,
  options: { withMessages: boolean },
): Promise<Record<string, unknown>> {
  const messages = options.withMessages
    ? await listConversationMessages(sql, conversation.id)
    : await sql<ConversationMessageRow[]>`
        SELECT ${sql.unsafe(MESSAGE_COLUMNS)} FROM app.conversation_messages
        WHERE conversation_id = ${conversation.id}
        ORDER BY coalesce(sent_at_ms, delivered_at_ms, created_at_ms) DESC,
                 seq DESC
        LIMIT 1
      `;
  const contactRows =
    conversation.contactId === null
      ? []
      : await sql<
          {
            id: string;
            name: string | null;
            email: string | null;
            locale: string | null;
            source: string | null;
            createdAt: number;
          }[]
        >`
          SELECT id, name, email, locale, source,
                 created_at_ms::float8 AS "createdAt"
          FROM app.contacts
          WHERE id = ${conversation.contactId}
            AND org_id = ${conversation.organizationId}
          LIMIT 1
        `;
  const pending = await sql<{ id: string; metadata: unknown }[]>`
    SELECT id, metadata FROM app.approvals
    WHERE org_id = ${conversation.organizationId}
      AND resource_type = 'conversations'
      AND resource_id = ${conversation.id} AND status = 'pending'
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;
  return projectConversationItem({
    conversation: {
      ...conversation,
      createdAt: conversation.createdAt,
    },
    contact: contactRows[0] ?? null,
    messages,
    ...(pending[0] !== undefined ? { pendingApproval: pending[0] } : {}),
  });
}

/**
 * One message, scoped through its conversation's visibility — the guard the
 * message-level doors (undo/retry/discard/attachments) share, so a member
 * can never act on a message in a conversation they cannot open.
 */
export async function loadMessageForViewer(
  sql: Sql,
  viewer: ConversationViewer,
  messageId: string,
): Promise<ConversationMessageRow & { connectorName: string | null }> {
  const rows = await sql<ConversationMessageRow[]>`
    SELECT ${sql.unsafe(MESSAGE_COLUMNS)} FROM app.conversation_messages
    WHERE id = ${messageId} AND org_id = ${viewer.organizationId}
    LIMIT 1
  `;
  const message = rows[0];
  if (message === undefined) {
    throw new ConversationError('MESSAGE_NOT_FOUND', 'Message not found', 404);
  }
  const conversation = await loadVisibleConversation(
    sql,
    viewer,
    message.conversationId,
  );
  return {
    ...message,
    // The CONVERSATION owns the provider — a per-message stamp would let a
    // reply escape to whatever connector last touched the row.
    connectorName: conversation.connectorName,
  };
}
