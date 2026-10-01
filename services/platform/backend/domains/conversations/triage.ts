/**
 * Inbox triage for the scheduled triage packs.
 *
 * The packs work on the Inbox, not the raw mailbox: `listUntriagedConversations`
 * hands a pack the open conversations of one mail connector whose newest
 * message is the customer's and arrived after the last triage stamp, and
 * `recordConversationTriage` writes that stamp — the verdict on
 * `metadata.triage`, plus the conversation's priority when no person has set
 * one. The stamp is the cursor: it carries the `seq` of the newest message
 * it judged, so a conversation is looked at again exactly when a message
 * lands after it, however old that message's own Date header is (a sync pass
 * ingests mail minutes after it was sent; a wall-clock cursor would step over
 * it for good).
 *
 * A draft is not written here: the pack hands the model's reply to
 * `draft_reply` (draft.ts), which is the one producer of pending replies.
 */

import type { Sql, TransactionSql } from 'postgres';

import { htmlToText } from '../../../lib/knowledge/html-to-text.ts';
import { ConversationError } from './service.ts';

export const TRIAGE_ACTIONS = ['reply', 'no_reply'] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

/** The Inbox's own priority vocabulary (`app.conversations.priority`). */
export const TRIAGE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];

/** How much of the newest customer message a pack reads — enough to judge
 * and to draft a reply, bounded so a forwarded thread cannot fill the prompt. */
export const TRIAGE_TEXT_MAX_CHARS = 4000;
export const TRIAGE_REASON_MAX_CHARS = 500;
/** Verdicts one call records, and conversations one listing hands out. */
export const TRIAGE_BATCH_MAX = 100;

export interface UntriagedConversation {
  conversationId: string;
  subject: string;
  contact: { name: string; email: string };
  /** When the newest customer message was sent (ISO 8601). */
  lastInboundAt: string;
  /** The newest customer message as text, at most
   * {@link TRIAGE_TEXT_MAX_CHARS} characters. */
  lastInboundText: string;
  unreadCount: number;
  /** A person or a team already holds it. */
  assigned: boolean;
  /** The Inbox's own link to the thread (app-relative). */
  url: string;
}

export interface TriageVerdict {
  conversationId: string;
  action: TriageAction;
  priority?: TriagePriority;
  reason?: string;
}

export interface TriageRecordResult {
  /** Verdicts written. */
  recorded: number;
  /** Conversations whose priority was set — those no person had prioritized. */
  prioritized: number;
  /** Ids that named no conversation of the organization. */
  unknown: string[];
}

export interface ListUntriagedArgs {
  organizationId: string;
  connectorSlug: string;
  limit: number;
}

export interface RecordTriageArgs {
  organizationId: string;
  verdicts: TriageVerdict[];
  /** The automation run that judged, for the stamp. */
  runId?: string;
}

interface UntriagedRow {
  id: string;
  subject: string | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  metadata: Record<string, unknown> | null;
  contactName: string | null;
  contactEmail: string | null;
  lastInboundAt: number;
  content: string;
  messageMetadata: Record<string, unknown> | null;
}

/** The Inbox route that opens one thread (`$status.tsx`'s `conversation`
 * search param), relative to the app's origin. */
export function conversationUrl(
  organizationId: string,
  conversationId: string,
): string {
  return `/dashboard/${encodeURIComponent(organizationId)}/conversations/open?conversation=${encodeURIComponent(conversationId)}`;
}

/**
 * The customer's message as text for a model: the plain part the ingest kept
 * on the message's metadata when there is one, else the stored content with
 * its HTML stripped — whitespace folded, cut at the cap.
 */
export function inboundTextOf(
  content: string,
  messageMetadata: Record<string, unknown> | null,
): string {
  const plain =
    messageMetadata !== null &&
    typeof messageMetadata.text === 'string' &&
    messageMetadata.text.trim() !== ''
      ? messageMetadata.text
      : content.includes('<')
        ? htmlToText(content)
        : content;
  const folded = plain
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return folded.length > TRIAGE_TEXT_MAX_CHARS
    ? `${folded.slice(0, TRIAGE_TEXT_MAX_CHARS)}…`
    : folded;
}

function unreadCountOf(metadata: Record<string, unknown> | null): number {
  const unread = metadata?.unread_count;
  return typeof unread === 'number' && unread > 0 ? unread : 0;
}

/**
 * The open conversations of one mail connector that are waiting on the team
 * and that no triage pass has judged since the customer last wrote: newest
 * first, at most `limit` (capped at {@link TRIAGE_BATCH_MAX}).
 *
 * "Waiting on the team" is the thread's newest message — newest by arrival,
 * `seq` — being inbound; a thread the team answered last is not listed until
 * the customer writes again. "Since the customer last wrote" is that same
 * `seq` against the stamp's — see the module note on why not its date.
 */
export async function listUntriagedConversations(
  sql: Sql,
  args: ListUntriagedArgs,
): Promise<{ conversations: UntriagedConversation[] }> {
  const limit = Math.max(1, Math.min(args.limit, TRIAGE_BATCH_MAX));
  const rows = await sql<UntriagedRow[]>`
    SELECT c.id, c.subject,
           c.assignee_user_id AS "assigneeUserId",
           c.assignee_team_id AS "assigneeTeamId",
           c.metadata,
           co.name AS "contactName", co.email AS "contactEmail",
           newest.at_ms::float8 AS "lastInboundAt",
           newest.content,
           newest.metadata AS "messageMetadata"
    FROM app.conversations c
    CROSS JOIN LATERAL (
      -- The newest message by ARRIVAL (seq), not by date: a customer message
      -- the sync ingests after the team's reply is waiting on the team
      -- whatever its own Date header says, and the stamp compares the same
      -- seq. Ordering by date here would hide exactly that message.
      SELECT m.seq, m.direction, m.content, m.metadata,
             coalesce(m.sent_at_ms, m.delivered_at_ms, m.created_at_ms) AS at_ms
      FROM app.conversation_messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.seq DESC
      LIMIT 1
    ) newest
    LEFT JOIN app.contacts co
      ON co.id = c.contact_id AND co.org_id = c.org_id
    WHERE c.org_id = ${args.organizationId}
      AND c.connector_name = ${args.connectorSlug}
      AND c.status = 'open'
      AND newest.direction = 'inbound'
      AND newest.seq > coalesce((c.metadata->'triage'->>'seq')::bigint, 0)
    ORDER BY coalesce(c.last_message_at_ms, 0) DESC, c.id DESC
    LIMIT ${limit}
  `;
  return {
    conversations: rows.map((row) => ({
      conversationId: row.id,
      subject: row.subject ?? '',
      contact: {
        name: row.contactName ?? '',
        email: row.contactEmail ?? '',
      },
      lastInboundAt: new Date(row.lastInboundAt).toISOString(),
      lastInboundText: inboundTextOf(row.content, row.messageMetadata),
      unreadCount: unreadCountOf(row.metadata),
      assigned: row.assigneeUserId !== null || row.assigneeTeamId !== null,
      url: conversationUrl(args.organizationId, row.id),
    })),
  };
}

function isTriageAction(value: string): value is TriageAction {
  return TRIAGE_ACTIONS.some((action) => action === value);
}

function isTriagePriority(value: string): value is TriagePriority {
  return TRIAGE_PRIORITIES.some((priority) => priority === value);
}

/**
 * The verdicts a record call accepts: non-empty, bounded, each naming a
 * conversation with a known action and priority, the reason within its cap.
 * A conversation named twice keeps the last verdict — a model does repeat
 * itself, and refusing the whole batch for it would lose the other verdicts.
 */
export function normalizeTriageVerdicts(
  verdicts: TriageVerdict[],
): TriageVerdict[] {
  if (verdicts.length === 0) {
    throw new ConversationError(
      'triage_empty',
      'A triage record needs at least one verdict',
      400,
    );
  }
  if (verdicts.length > TRIAGE_BATCH_MAX) {
    throw new ConversationError(
      'triage_too_many',
      `A triage record accepts at most ${TRIAGE_BATCH_MAX} verdicts`,
      400,
    );
  }
  const byId = new Map<string, TriageVerdict>();
  for (const verdict of verdicts) {
    const conversationId = verdict.conversationId.trim();
    if (conversationId === '') {
      throw new ConversationError(
        'triage_invalid',
        'A verdict needs a conversation id',
        400,
      );
    }
    if (!isTriageAction(verdict.action)) {
      throw new ConversationError(
        'triage_invalid',
        `Unknown triage action "${String(verdict.action)}"`,
        400,
      );
    }
    if (verdict.priority !== undefined && !isTriagePriority(verdict.priority)) {
      throw new ConversationError(
        'triage_invalid',
        `Unknown priority "${String(verdict.priority)}"`,
        400,
      );
    }
    const reason = verdict.reason?.trim();
    if (reason !== undefined && reason.length > TRIAGE_REASON_MAX_CHARS) {
      throw new ConversationError(
        'triage_invalid',
        `A triage reason accepts at most ${TRIAGE_REASON_MAX_CHARS} characters`,
        400,
      );
    }
    byId.set(conversationId, {
      conversationId,
      action: verdict.action,
      ...(verdict.priority !== undefined ? { priority: verdict.priority } : {}),
      ...(reason !== undefined && reason !== '' ? { reason } : {}),
    });
  }
  return [...byId.values()];
}

/**
 * Writes the verdicts: `metadata.triage` on each conversation, and the
 * priority where none is set — a person's choice is never overwritten. The
 * stamp's `seq` is the newest message of the thread at this moment, so the
 * next listing skips the thread until a message lands after it.
 */
export async function recordConversationTriage(
  sql: Sql,
  args: RecordTriageArgs,
): Promise<TriageRecordResult> {
  const verdicts = normalizeTriageVerdicts(args.verdicts);
  return sql.begin((tx) => recordInTx(tx, { ...args, verdicts }));
}

async function recordInTx(
  tx: TransactionSql,
  args: RecordTriageArgs,
): Promise<TriageRecordResult> {
  const ids = args.verdicts.map((verdict) => verdict.conversationId);
  const known = await tx<{ id: string; priority: string | null }[]>`
    SELECT id, priority FROM app.conversations
    WHERE org_id = ${args.organizationId} AND id = ANY(${ids})
    FOR UPDATE
  `;
  const priorityBefore = new Map(known.map((row) => [row.id, row.priority]));
  const at = Date.now();
  let recorded = 0;
  let prioritized = 0;
  const unknown: string[] = [];
  for (const verdict of args.verdicts) {
    if (!priorityBefore.has(verdict.conversationId)) {
      unknown.push(verdict.conversationId);
      continue;
    }
    const priority = verdict.priority ?? null;
    await tx`
      UPDATE app.conversations AS c
      SET metadata = coalesce(c.metadata, '{}'::jsonb)
            || jsonb_build_object('triage', jsonb_strip_nulls(jsonb_build_object(
                 'at', ${at}::bigint,
                 'seq', coalesce((
                   SELECT max(m.seq) FROM app.conversation_messages m
                   WHERE m.conversation_id = c.id
                 ), 0),
                 'action', ${verdict.action}::text,
                 'priority', ${priority}::text,
                 'reason', ${verdict.reason ?? null}::text,
                 'runId', ${args.runId ?? null}::text
               ))),
          priority = coalesce(c.priority, ${priority}::text)
      WHERE c.id = ${verdict.conversationId}
        AND c.org_id = ${args.organizationId}
    `;
    recorded += 1;
    if (
      priority !== null &&
      priorityBefore.get(verdict.conversationId) === null
    ) {
      prioritized += 1;
    }
  }
  return { recorded, prioritized, unknown };
}
