/**
 * 0.3.4 / 01 — backfill `conversations.integrationName` from each
 * conversation's message history.
 *
 * The email inbox apps (outlook/sync-emails / gmail/sync-emails / imap-smtp/sync-emails) list and
 * reply per integration: the list query filters on the new
 * `by_org_integration_status_lastMessageAt` index and `replyToConversation`
 * derives the outbound integration from the conversation row (no more
 * hardcoded fallback). Historical conversations predate the column, so this
 * migration stamps each row with the `integrationName` of its most recent
 * `conversationMessages` row that carries one (messages have recorded it at
 * ingest/send since the column existed).
 *
 * Idempotent both ways, the 0.2.88 posture: `up` skips a row whose
 * `integrationName` is already a non-empty string, and skips rows whose
 * messages name no integration (underivable — the reply path surfaces those
 * as an explicit error). `down` clears the column ONLY where the current
 * value still equals what `up` would derive, so a post-migration edit
 * survives rollback.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Newest-first scan cap. The rows this backfill targets are exactly the ones
 * whose history may name NO integration at all — without a cap, one such
 * conversation with a long HTML-heavy history could blow the per-transaction
 * read budget and wedge the whole fleet run on a permanently-failing batch.
 * A name, when present at all, appears on recent ingest-written messages;
 * 200 recent messages is far beyond any realistic gap.
 */
const MESSAGE_SCAN_CAP = 200;

/**
 * The integrationName the conversation's message history implies: that of the
 * most recent message carrying one. Recency = `deliveredAt` descending on the
 * `by_conversationId_and_deliveredAt` index (undelivered rows, whose
 * `deliveredAt` is unset, sort last and act as a fallback only). `undefined`
 * when no message names one within the scan cap.
 */
async function deriveIntegrationName(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<string | undefined> {
  const recent = await ctx.db
    .query('conversationMessages')
    .withIndex('by_conversationId_and_deliveredAt', (q) =>
      q.eq('conversationId', conversationId),
    )
    .order('desc')
    .take(MESSAGE_SCAN_CAP);
  for (const message of recent) {
    const name = nonEmptyString(message.integrationName);
    if (name) return name;
  }
  return undefined;
}

export const migration = defineDbMigration({
  title: 'Backfill conversations.integrationName from the latest message',
  description:
    'Stamps each conversations row that has no integrationName with the ' +
    'integrationName of its most recent conversationMessages row carrying ' +
    'one, so the email inbox apps can filter and reply per integration. ' +
    'Rows with a value and rows whose messages name no integration are left ' +
    'untouched. down clears only the rows whose current value still equals ' +
    'the derived one, preserving post-migration edits.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.90/02_backfill_conversation_integration_name'],
  subjects: { tables: ['conversations', 'conversationMessages'] },
  table: 'conversations',
  // Each conversation may fan out into a message-history scan; keep the
  // per-transaction read volume well under Convex's limits.
  batchSize: 20,

  async up(ctx, doc) {
    // Already stamped with a non-empty name — leave it (idempotent).
    if (nonEmptyString(doc.integrationName)) return;
    const derived = await deriveIntegrationName(
      ctx,
      doc._id as Id<'conversations'>,
    );
    // Underivable — no message names an integration; skip rather than guess.
    if (!derived) return;
    await ctx.db.patch(doc._id as Id<'conversations'>, {
      integrationName: derived,
    });
  },

  async down(ctx, doc) {
    const current = nonEmptyString(doc.integrationName);
    if (!current) return; // nothing to clear (idempotent)
    const derived = await deriveIntegrationName(
      ctx,
      doc._id as Id<'conversations'>,
    );
    // Clear only the value `up` would have written; a post-migration edit
    // (current ≠ derived) is preserved.
    if (derived === current) {
      await ctx.db.patch(doc._id as Id<'conversations'>, {
        integrationName: undefined,
      });
    }
  },
});
