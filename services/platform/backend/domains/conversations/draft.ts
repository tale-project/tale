/**
 * An agent-drafted reply, waiting for a person.
 *
 * The draft is an approval on the conversation — `resource_type` of
 * `conversations`, `resource_id` the conversation id — which is the shape both
 * halves around it already expect. `loadPendingApprovals` (service.ts) joins
 * the newest pending row onto the list and the panel renders its
 * `metadata.emailBody` as a pending message; `sendMessageViaConnectorInTx`
 * (send.ts) completes that row when a human sends. This is the producer those
 * two were written against.
 *
 * It writes no message. A draft is a proposal, so nothing reaches a customer
 * until a person sends it — which is also what puts the reply on the API
 * delivery queue for a mirrored conversation.
 */

import type { Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { ConversationError } from './service.ts';

export interface DraftReplyArgs {
  organizationId: string;
  conversationId: string;
  /** The proposed reply. Rendered to the reader as a pending message. */
  emailBody: string;
  /** Where the draft came from, for the audit trail. */
  source?: string;
  automation?: string;
  runId?: string;
  nodeId?: string;
  /** Which communication guidelines produced it; analytics cannot attribute
   * a score to an edit without knowing which rules were in force. */
  guidelineVersion?: string;
  /** Model confidence, when the drafting path had one to record. */
  confidence?: number;
}

export interface DraftReplyResult {
  approvalId: string;
  /** False when the conversation already had a pending draft. */
  created: boolean;
}

const MAX_DRAFT_CHARS = 25_000;

export async function draftReplyToConversation(
  sql: Sql,
  args: DraftReplyArgs,
): Promise<DraftReplyResult> {
  const body = args.emailBody.trim();
  if (!body) {
    throw new ConversationError(
      'draft_empty',
      'A draft reply needs a body',
      400,
    );
  }
  if (body.length > MAX_DRAFT_CHARS) {
    throw new ConversationError(
      'draft_too_long',
      `A draft reply accepts at most ${MAX_DRAFT_CHARS} characters`,
      400,
    );
  }

  return sql.begin((tx) =>
    draftReplyToConversationInTx(tx, { ...args, emailBody: body }),
  );
}

export async function draftReplyToConversationInTx(
  tx: TransactionSql,
  args: DraftReplyArgs,
): Promise<DraftReplyResult> {
  const conversations = await tx<{ id: string; orgId: string }[]>`
    SELECT id, org_id AS "orgId" FROM app.conversations
    WHERE id = ${args.conversationId} LIMIT 1
  `;
  const conversation = conversations[0];
  if (!conversation) {
    throw new ConversationError(
      'conversation_not_found',
      'Conversation not found',
      404,
    );
  }
  if (conversation.orgId !== args.organizationId) {
    throw new ConversationError(
      'conversation_org_mismatch',
      'Conversation does not belong to organization',
      403,
    );
  }

  const now = Date.now();

  // The insert is the claim. Migration 0108 carries a partial unique index over
  // (org, type, resource) for pending conversation rows, so two runs racing one
  // inbound message cannot both mint a card: the loser reads the winner's below
  // rather than leaving a draft the reader never saw to be completed by a send.
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.approvals (
      org_id, status, resource_type, resource_id, priority, metadata,
      created_at_ms
    ) VALUES (
      ${args.organizationId}, 'pending', 'conversations',
      ${args.conversationId}, 'medium',
      ${tx.json(
        toJson({
          emailBody: args.emailBody,
          draftedAt: now,
          ...(args.source !== undefined ? { source: args.source } : {}),
          ...(args.automation !== undefined
            ? { automation: args.automation }
            : {}),
          ...(args.runId !== undefined ? { runId: args.runId } : {}),
          ...(args.nodeId !== undefined ? { nodeId: args.nodeId } : {}),
          ...(args.guidelineVersion !== undefined
            ? { guidelineVersion: args.guidelineVersion }
            : {}),
          ...(args.confidence !== undefined
            ? { confidence: args.confidence }
            : {}),
        }),
      )},
      ${now}
    )
    ON CONFLICT (org_id, resource_type, resource_id)
      WHERE resource_type = 'conversations' AND status = 'pending'
      DO NOTHING
    RETURNING id
  `;

  if (inserted[0]) {
    return { approvalId: inserted[0].id, created: true };
  }

  const existing = await tx<{ id: string }[]>`
    SELECT id FROM app.approvals
    WHERE org_id = ${args.organizationId}
      AND resource_type = 'conversations'
      AND resource_id = ${args.conversationId}
      AND status = 'pending'
    ORDER BY seq DESC LIMIT 1
  `;
  const winner = existing[0];
  if (!winner) {
    throw new ConversationError(
      'draft_conflict',
      'A draft was refused but no pending draft could be read back',
      409,
    );
  }
  return { approvalId: winner.id, created: false };
}

/**
 * What a sent reply records on the draft it consumed. `sentTo` / `sentSubject`
 * belong to the email lane; a native API reply carries the id of the message
 * it queued instead.
 */
export interface SentDraftReceipt {
  sentContent: string;
  sentTo?: string | string[];
  sentSubject?: string;
  sentHtml?: string;
  sentText?: string;
  sentCc?: string[] | string;
  deliveryMessageId?: string;
}

/**
 * Completes the pending drafted reply on a conversation when a human sends —
 * whichever lane carries the send. The card is the reader's "reply awaiting
 * you" and the composer's prefill; a draft left pending after its send was
 * offered again on every reload, on the API lane, as if never sent.
 *
 * Runs inside the send's own transaction so a send that rolls back leaves the
 * draft pending. No-op when nothing is pending.
 */
export async function completePendingDraftInTx(
  tx: TransactionSql,
  args: {
    conversationId: string;
    actorUserId: string;
    sentAt: number;
    receipt: SentDraftReceipt;
  },
): Promise<{ approvalId: string } | null> {
  const pending = await tx<
    { id: string; metadata: Record<string, unknown> | null }[]
  >`
    SELECT id, metadata FROM app.approvals
    WHERE resource_type = 'conversations'
      AND resource_id = ${args.conversationId} AND status = 'pending'
    ORDER BY seq ASC LIMIT 1
  `;
  const row = pending[0];
  if (!row) return null;
  const receipt = Object.fromEntries(
    Object.entries(args.receipt).filter(([, value]) => value !== undefined),
  );
  await tx`
    UPDATE app.approvals SET
      status = 'completed', approved_by = ${args.actorUserId},
      reviewed_at_ms = ${args.sentAt},
      metadata = ${tx.json(
        toJson({ ...row.metadata, ...receipt, sentAt: args.sentAt }),
      )}
    WHERE id = ${row.id}
  `;
  return { approvalId: row.id };
}
