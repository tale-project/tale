/**
 * Pure helpers for knowledge entries. Kept free of heavy imports (rate
 * limiter, approvals) so light consumers — e.g. `documents/mutations.ts`'s
 * delete hook — can import them without dragging those modules into their
 * bundle (or their tests' mock surface).
 */

import { AppError } from '../../../lib/shared/errors/app-error';
import type { MutationCtx } from '../lib/ctx';
import type { Doc, Id } from '../lib/rows';
import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
  normalizeTopicKey,
} from './constants';

export interface UpsertEntryResult {
  entryId: Id<'knowledgeEntries'>;
  documentId: Id<'documents'> | null;
  replacedEntryId: Id<'knowledgeEntries'> | null;
}

export async function findActiveEntryByTopicKey(
  ctx: MutationCtx,
  organizationId: string,
  topicKey: string,
): Promise<Doc<'knowledgeEntries'> | null> {
  const existing = await ctx.db
    .query('knowledgeEntries')
    .withIndex('by_org_topicKey_status', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('topicKey', topicKey)
        .eq('status', 'active'),
    )
    .first();
  if (!existing || existing.deletedAt !== undefined) return null;
  return existing;
}

export function validateTopicAndContent(
  topic: string,
  content: string,
): { topic: string; topicKey: string; content: string } {
  const trimmedTopic = topic.trim();
  const trimmedContent = content.trim();
  // Structured AppError codes so the client surfaces a readable message
  // instead of an opaque "Server Error" (raw `Error` messages are redacted by
  // Convex in prod). Called from both public and internal mutations;
  // AppError propagates correctly through both paths.
  if (!trimmedTopic) {
    throw new AppError({ code: 'KNOWLEDGE_ENTRY_TOPIC_REQUIRED' });
  }
  if (trimmedTopic.length > TOPIC_MAX_LENGTH) {
    throw new AppError({
      code: 'KNOWLEDGE_ENTRY_TOPIC_TOO_LONG',
      max: TOPIC_MAX_LENGTH,
    });
  }
  if (!trimmedContent) {
    throw new AppError({ code: 'KNOWLEDGE_ENTRY_CONTENT_REQUIRED' });
  }
  if (trimmedContent.length > CONTENT_MAX_LENGTH) {
    throw new AppError({
      code: 'KNOWLEDGE_ENTRY_CONTENT_TOO_LONG',
      max: CONTENT_MAX_LENGTH,
    });
  }
  return {
    topic: trimmedTopic,
    topicKey: normalizeTopicKey(trimmedTopic),
    content: trimmedContent,
  };
}

/**
 * Topic-keyed upsert (Option A delete+replace): inserts the new ACTIVE
 * version row; when an active row already exists for (org, topicKey) it is
 * marked `superseded` and its `documentId` is carried onto the new row so
 * the backing document (and its RAG entry) gets replaced, never duplicated.
 * Superseded rows stay as an inert version chain for audit/undo.
 */
export async function upsertEntryRow(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    topic: string;
    topicKey: string;
    content: string;
    source: 'chat' | 'manual';
    createdBy: string;
    sourceThreadId?: string;
    sourceMessageId?: string;
  },
): Promise<UpsertEntryResult> {
  const existing = await findActiveEntryByTopicKey(
    ctx,
    args.organizationId,
    args.topicKey,
  );
  const now = Date.now();

  const entryId = await ctx.db.insert('knowledgeEntries', {
    organizationId: args.organizationId,
    topic: args.topic,
    topicKey: args.topicKey,
    content: args.content,
    status: 'active',
    documentId: existing?.documentId,
    source: args.source,
    sourceThreadId: args.sourceThreadId,
    sourceMessageId: args.sourceMessageId,
    createdBy: args.createdBy,
    createdAt: now,
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      status: 'superseded',
      supersededBy: entryId,
      supersededAt: now,
    });
  }

  return {
    entryId,
    documentId: existing?.documentId ?? null,
    replacedEntryId: existing?._id ?? null,
  };
}

/**
 * Soft-delete every version row of the entry's topic chain. Used by the
 * public delete mutation and by `deleteDocument` when the backing document
 * is removed from the Documents tab (so a tab delete can't orphan entries).
 */
export async function markEntryChainDeleted(
  ctx: MutationCtx,
  organizationId: string,
  topicKey: string,
): Promise<number> {
  const now = Date.now();
  let count = 0;
  for await (const row of ctx.db
    .query('knowledgeEntries')
    .withIndex('by_org_topicKey_status', (q) =>
      q.eq('organizationId', organizationId).eq('topicKey', topicKey),
    )) {
    if (row.deletedAt !== undefined) continue;
    await ctx.db.patch(row._id, { deletedAt: now });
    count++;
  }
  return count;
}
