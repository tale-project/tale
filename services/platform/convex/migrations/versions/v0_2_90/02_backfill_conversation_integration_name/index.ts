/**
 * DB migration over `conversations`: stamp `integrationName` from the most
 * recent `conversationMessages` row that carries one, so the email inbox apps
 * can filter (`by_org_integration_status_lastMessageAt`) and reply
 * (`replyToConversation` derives the outbound integration from the row).
 * Both `up` and `down` are idempotent; `down` clears only values that still
 * equal what `up` would derive, preserving post-migration edits.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

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

export const migration: DbMigration = {
  meta,
  table: 'conversations',
  // Each conversation may fan out into a message-history scan; keep the
  // per-transaction read volume well under Convex's limits.
  batchSize: 20,

  async up(ctx: MutationCtx, doc: MigrationDoc) {
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

  async down(ctx: MutationCtx, doc: MigrationDoc) {
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
};
