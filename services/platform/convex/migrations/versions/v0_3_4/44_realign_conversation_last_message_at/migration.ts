/**
 * 0.3.4 / 44 — realign `conversations.lastMessageAt` with message send time.
 *
 * Historical rows stamped `lastMessageAt` with ingestion time (`Date.now()`)
 * while list timestamps and thread order use each message's `sentAt`. That
 * mismatch made the inbox sort by sync order instead of when mail was sent.
 * This migration recomputes the indexed cursor from the conversation's message
 * history using the same sentAt-first rule as list display.
 */

import { getConversationMessageSortTime } from '../../../../../lib/shared/conversations/message-order';
import type { Doc, Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

const MIGRATION_STAMP = '__lastMessageAtRealignFrom';

type RealignStamp = {
  lastMessageAt: number | null;
  last_message_at: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readStamp(
  metadata: Record<string, unknown>,
): RealignStamp | undefined {
  const raw = metadata[MIGRATION_STAMP];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const stamp = raw as Record<string, unknown>;
  const lastMessageAt =
    stamp.lastMessageAt === null
      ? null
      : typeof stamp.lastMessageAt === 'number'
        ? stamp.lastMessageAt
        : undefined;
  const last_message_at =
    stamp.last_message_at === null
      ? null
      : typeof stamp.last_message_at === 'number'
        ? stamp.last_message_at
        : undefined;
  if (lastMessageAt === undefined || last_message_at === undefined) {
    return undefined;
  }
  return { lastMessageAt, last_message_at };
}

/**
 * Latest message sort time for a conversation, or its creation time when empty.
 */
async function deriveLastMessageAt(
  ctx: MutationCtx,
  conversation: Doc<'conversations'>,
): Promise<number> {
  let latest: number | undefined;

  for await (const message of ctx.db
    .query('conversationMessages')
    .withIndex('by_conversationId_and_deliveredAt', (q) =>
      q.eq('conversationId', conversation._id),
    )) {
    const sortTime = getConversationMessageSortTime(message);
    latest = latest === undefined ? sortTime : Math.max(latest, sortTime);
  }

  return latest ?? conversation._creationTime;
}

export const migration = defineDbMigration({
  title: 'Realign conversation lastMessageAt with message sentAt',
  description:
    'Recomputes conversations.lastMessageAt from each thread latest message ' +
    'sentAt-first timestamp so inbox sort matches displayed send time. up ' +
    'stamps the prior value in metadata for rollback; down restores it and ' +
    'clears the stamp. Idempotent on both paths.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['conversations', 'conversationMessages'] },
  table: 'conversations',
  batchSize: 20,

  async up(ctx, doc) {
    const derived = await deriveLastMessageAt(ctx, doc as Doc<'conversations'>);
    if (doc.lastMessageAt === derived) return;

    const existingMetadata = asRecord(doc.metadata) ?? {};
    const previousLastMessageAt =
      typeof doc.lastMessageAt === 'number' ? doc.lastMessageAt : null;
    const previousMetadataLastMessageAt =
      typeof existingMetadata.last_message_at === 'number'
        ? existingMetadata.last_message_at
        : null;

    await ctx.db.patch(doc._id as Id<'conversations'>, {
      lastMessageAt: derived,
      metadata: {
        ...existingMetadata,
        [MIGRATION_STAMP]: {
          lastMessageAt: previousLastMessageAt,
          last_message_at: previousMetadataLastMessageAt,
        },
        last_message_at: derived,
      },
    });
  },

  async down(ctx, doc) {
    const metadata = asRecord(doc.metadata);
    if (!metadata) return;

    const stamp = readStamp(metadata);
    if (!stamp) return;

    const { [MIGRATION_STAMP]: _removed, ...restMetadata } = metadata;
    const patch: {
      lastMessageAt?: number;
      metadata?: Record<string, unknown>;
    } = {};

    if (stamp.lastMessageAt === null) {
      patch.lastMessageAt = undefined;
    } else {
      patch.lastMessageAt = stamp.lastMessageAt;
    }

    const nextMetadata = { ...restMetadata };
    if (stamp.last_message_at === null) {
      delete nextMetadata.last_message_at;
    } else {
      nextMetadata.last_message_at = stamp.last_message_at;
    }

    patch.metadata =
      Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;

    await ctx.db.patch(doc._id as Id<'conversations'>, patch);
  },
});
