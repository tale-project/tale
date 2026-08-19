import { v } from 'convex/values';

import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { NO_SUBJECT } from '../conversations/ingest/constants';
import { blobRefValidator } from '../lib/storage/blob_ref';

export const getById = internalQuery({
  args: { fileMetadataId: v.id('fileMetadata') },
  async handler(ctx, args) {
    return await ctx.db.get(args.fileMetadataId);
  },
});

export const getByStorageId = internalQuery({
  args: {
    storageId: blobRefValidator,
  },
  async handler(ctx, args) {
    return await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
  },
});

/**
 * The conversation a stored blob arrived on, or null.
 *
 * Read at INDEX time rather than passed along the dispatch chain, so the corpus
 * stamp cannot disagree with the binding: a re-index (watchdog retry, promotion
 * from parked, a later slice of a large file) picks up whatever the binding is
 * now. Org-scoped, because a blob ref is caller-supplied on some paths.
 */
export const getConversationBindingForBlob = internalQuery({
  args: {
    organizationId: v.string(),
    storageId: blobRefValidator,
  },
  returns: v.union(
    v.object({
      conversationId: v.string(),
      /** The mail's subject, absent when it had none. Never the stored
       *  `NO_SUBJECT` placeholder — that is not prose and must not be
       *  indexed as if it were. */
      subject: v.optional(v.string()),
      /** Who the mail is with, when a contact is linked and named. */
      correspondent: v.optional(v.string()),
    }),
    v.null(),
  ),
  async handler(ctx, args) {
    const row = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!row || row.organizationId !== args.organizationId) return null;
    const conversationId = row.conversationId;
    if (conversationId === undefined) return null;

    // Read through the conversation for the context an attachment inherits.
    // A missing or foreign conversation yields the binding alone rather than
    // failing: the id is what scope depends on, the context is only enrichment.
    const conversation = await ctx.db.get(conversationId);
    const usable =
      conversation !== null &&
      conversation.organizationId === args.organizationId;
    const subject =
      usable &&
      conversation.subject !== undefined &&
      conversation.subject !== '' &&
      conversation.subject !== NO_SUBJECT
        ? conversation.subject
        : undefined;
    const contact =
      usable && conversation.contactId !== undefined
        ? await ctx.db.get(conversation.contactId)
        : null;
    const correspondent =
      contact !== null &&
      contact.organizationId === args.organizationId &&
      contact.name !== undefined &&
      contact.name !== ''
        ? contact.name
        : undefined;
    return {
      conversationId: String(conversationId),
      ...(subject !== undefined ? { subject } : {}),
      ...(correspondent !== undefined ? { correspondent } : {}),
    };
  },
});

/**
 * Which of these blob references belong to this organization — the IDOR gate
 * a chat turn runs over caller-supplied attachment ids before it will read
 * (or replay) their bytes. Trashed rows fail the check too: a deleted
 * attachment must not be resurrectable through a new send.
 */
export const filterStorageIdsInOrg = internalQuery({
  args: {
    organizationId: v.string(),
    storageIds: v.array(blobRefValidator),
  },
  returns: v.array(v.string()),
  async handler(ctx, args) {
    const owned: string[] = [];
    for (const storageId of args.storageIds) {
      const row = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (
        row !== null &&
        row.organizationId === args.organizationId &&
        row.lifecycleStatus !== 'trashed'
      ) {
        owned.push(String(storageId));
      }
    }
    return owned;
  },
});

/**
 * Chat-uploaded attachments belonging to a single thread, filtered down
 * to rows the sandbox can usefully stage:
 *  - same org + same thread
 *  - skip Document Hub rows (`documentId` set — those belong to the
 *    org-wide knowledge surface, not the chat-attachment lane)
 *  - skip video-link / agent-synthesized rows (already accessible via
 *    the transcript path; raw blobs aren't useful for skill_run)
 *  - skip rows in `trashed` lifecycle so a deleted attachment doesn't
 *    spookily reappear in a sandbox workspace
 *
 * Used by `executeCode` when `stageThreadAttachments` is on, so a
 * `skill_run` invocation can operate on the user's most recent
 * uploads without each skill author having to thread the file IDs
 * by hand.
 */
export const listChatAttachmentsForThread = internalQuery({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
  },
  async handler(ctx, args) {
    // Push the three exclusions into the query so they evaluate in the engine
    // instead of materializing every thread attachment and filtering in JS.
    // Equivalent to the prior predicates (undefined `source`/`lifecycleStatus`
    // still pass the `neq` checks, matching `!== 'video_link'` / `!== 'trashed'`).
    const out: Array<
      Pick<
        Doc<'fileMetadata'>,
        '_id' | 'storageId' | 'fileName' | 'contentType' | 'size'
      >
    > = [];
    for await (const r of ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_threadId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('threadId', args.threadId),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('documentId'), undefined),
          q.neq(q.field('source'), 'video_link'),
          q.neq(q.field('lifecycleStatus'), 'trashed'),
        ),
      )) {
      out.push({
        _id: r._id,
        storageId: r.storageId,
        fileName: r.fileName,
        contentType: r.contentType,
        size: r.size,
      });
    }
    return out;
  },
});

/**
 * Filter a list of storage ids down to ones the caller is authorized
 * to poke RAG status for. Used by the public action
 * `checkFileRagStatuses` to prevent (a) anonymous attackers from
 * flipping `ragStatus: 'failed'` on any org's files via the indirect
 * `expireStaleRagQueue` path, and (b) members of org A from poking
 * org B's RAG state.
 *
 * Authorization model: caller must be a member (per Better Auth
 * `member` table) of every distinct organizationId referenced by the
 * supplied storage ids. Storage ids whose fileMetadata has a different
 * org are silently dropped.
 */
export const filterStorageIdsByCallerOrg = internalQuery({
  args: {
    storageIds: v.array(blobRefValidator),
    userId: v.string(),
  },
  // Returns one entry per authorized storage id with its organizationId so
  // callers can group by org (e.g., RAG endpoints are now org-scoped and
  // accept one org_slug per request). `ragStatus` is included so the poller
  // can skip rows that are already terminal — in particular it must NOT
  // re-flip a `'failed'` row back to `'running'` when the knowledge corpus
  // still reports `processing` for an orphaned (watchdog-failed) document.
  returns: v.array(
    v.object({
      storageId: blobRefValidator,
      organizationId: v.string(),
      ragStatus: v.optional(
        v.union(
          v.literal('queued'),
          v.literal('running'),
          v.literal('completed'),
          v.literal('failed'),
          v.literal('unsupported'),
        ),
      ),
    }),
  ),
  async handler(ctx, args) {
    const allowed: Array<{
      storageId: (typeof args.storageIds)[number];
      organizationId: string;
      ragStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';
    }> = [];
    const orgMembershipCache = new Map<string, boolean>();
    for (const storageId of args.storageIds) {
      const meta = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (!meta) continue;
      const orgId = meta.organizationId;
      let isMember = orgMembershipCache.get(orgId);
      if (isMember === undefined) {
        const result = await ctx.runQuery(
          components.betterAuth.adapter.findMany,
          {
            model: 'member',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [
              { field: 'organizationId', value: orgId, operator: 'eq' },
              { field: 'userId', value: args.userId, operator: 'eq' },
            ],
          },
        );
        isMember = (result?.page?.length ?? 0) > 0;
        orgMembershipCache.set(orgId, isMember);
      }
      if (isMember) {
        allowed.push({
          storageId,
          organizationId: orgId,
          ...(meta.ragStatus !== undefined && { ragStatus: meta.ragStatus }),
        });
      }
    }
    return allowed;
  },
});

/**
 * Lookup which of the supplied storage ids correspond to fileMetadata rows
 * with `source === 'video_link'`. Returns a Map-friendly array of pairs so
 * callers (RAG retrieval / search tool handlers) can wrap the corresponding
 * tool-response content in `<untrusted_source>` before handing it to the
 * agent. Non-video-link rows are omitted from the result entirely.
 *
 * Storage ids without a fileMetadata row are silently skipped (hub documents
 * that index the same id, broken references, etc.) — wrapping is best-effort
 * defense-in-depth and a miss only loses the wrap, never poisons trust.
 */
export const lookupVideoLinkSources = internalQuery({
  args: { storageIds: v.array(blobRefValidator) },
  returns: v.array(
    v.object({
      storageId: blobRefValidator,
      sourceUrl: v.optional(v.string()),
    }),
  ),
  async handler(ctx, args) {
    const out: Array<{
      storageId: (typeof args.storageIds)[number];
      sourceUrl?: string;
    }> = [];
    for (const storageId of args.storageIds) {
      const meta = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (!meta || meta.source !== 'video_link') continue;
      // videoLinkJobs.storageId is a blob REFERENCE sharing the exact string
      // this fileMetadata row carries, so the join works for `_storage` ids
      // AND `s3:` refs alike.
      const job = await ctx.db
        .query('videoLinkJobs')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      const entry: {
        storageId: (typeof args.storageIds)[number];
        sourceUrl?: string;
      } = {
        storageId,
      };
      const sourceUrl = job?.sourceUrl;
      if (sourceUrl) entry.sourceUrl = sourceUrl;
      out.push(entry);
    }
    return out;
  },
});

/**
 * RAG watchdog candidates: fileMetadata rows still in flight (`'queued'` or
 * `'running'`) whose age exceeds the caller-supplied cutoff. Convex hard-kills
 * an action at the 30-min ceiling WITHOUT running its catch block, so a large
 * or backend-restart-interrupted indexing job leaves the row stuck at
 * `'running'` (or `'queued'`, if the scheduled `uploadFileToRag` never ran)
 * forever — the server poller's own timeout can die with it. This feeds
 * `recoverStuckRagIndexing`, which reconciles each candidate against the
 * knowledge corpus before failing it.
 *
 * Age clock is `ragQueuedAt ?? _creationTime`: `ragQueuedAt` is stamped on
 * every (re-)queue and preserved through the `'running'` phase, so a fresh
 * retry of an old row resets the clock and is not swept prematurely (the same
 * hazard `transcriptionStartedAt` guards for transcriptions). Legacy rows
 * without `ragQueuedAt` fall back to `_creationTime`.
 *
 * Iterates the `by_ragStatus` index so the scan touches only the (normally
 * tiny) in-flight set, and stops at `limit` candidates so one mass-stuck
 * incident can't make a single tick unbounded — the next tick drains the rest.
 */
export const listStuckRagCandidates = internalQuery({
  args: {
    staleBeforeMs: v.number(),
    /**
     * Include `failed` rows whose job clock is AFTER this — recent failures
     * the watchdog reconciles against the corpus so a late completion (or the
     * real terminal error) self-heals the row instead of demanding a manual
     * retry. Older failures are settled history and skipped.
     */
    failedAfterMs: v.optional(v.number()),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      storageId: blobRefValidator,
      organizationId: v.string(),
      ragStatus: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('failed'),
      ),
      ragError: v.optional(v.string()),
      documentId: v.optional(v.id('documents')),
    }),
  ),
  async handler(ctx, args) {
    const results: Array<{
      storageId: Doc<'fileMetadata'>['storageId'];
      organizationId: string;
      ragStatus: 'queued' | 'running' | 'failed';
      ragError?: string;
      documentId?: Doc<'fileMetadata'>['documentId'];
    }> = [];
    for (const status of ['running', 'queued'] as const) {
      for await (const row of ctx.db
        .query('fileMetadata')
        .withIndex('by_ragStatus', (q) => q.eq('ragStatus', status))) {
        // A parked `'queued'` row (concurrency cap) is waiting for a slot, not
        // stuck — it has no scheduled action to time out. It's promoted by
        // `promoteQueuedRagJobs`, never failed here.
        if (status === 'queued' && row.ragParked === true) continue;
        const clock = row.ragQueuedAt ?? row._creationTime;
        if (clock < args.staleBeforeMs) {
          results.push({
            storageId: row.storageId,
            organizationId: row.organizationId,
            ragStatus: status,
            ...(row.documentId !== undefined && {
              documentId: row.documentId,
            }),
          });
          if (results.length >= args.limit) return results;
        }
      }
    }
    if (args.failedAfterMs !== undefined) {
      for await (const row of ctx.db
        .query('fileMetadata')
        .withIndex('by_ragStatus', (q) => q.eq('ragStatus', 'failed'))) {
        const clock = row.ragQueuedAt ?? row._creationTime;
        if (clock >= args.failedAfterMs) {
          results.push({
            storageId: row.storageId,
            organizationId: row.organizationId,
            ragStatus: 'failed',
            ...(row.ragError !== undefined && { ragError: row.ragError }),
            ...(row.documentId !== undefined && {
              documentId: row.documentId,
            }),
          });
          if (results.length >= args.limit) return results;
        }
      }
    }
    return results;
  },
});

/**
 * Read the SHA-256 checksum computed by Convex on upload. Exists because
 * `ctx.db.system.get(...)` is not available in actions — actions call this
 * internal query instead.
 */
export const getStorageSha256 = internalQuery({
  args: {
    storageId: v.id('_storage'),
  },
  async handler(ctx, args) {
    const meta = await ctx.db.system.get(args.storageId);
    return meta?.sha256 ?? null;
  },
});

/**
 * Read Convex-computed blob metadata (size + contentType) for a storage id.
 * Exists because `ctx.db.system.get(...)` is unavailable in actions — the
 * REST `POST /api/v1/documents` handler calls this to size the fileMetadata
 * row it creates for an externally-supplied `fileId`. Returns null when the
 * blob is missing.
 */
export const getStorageMetadata = internalQuery({
  args: {
    storageId: v.id('_storage'),
  },
  returns: v.union(
    v.object({
      size: v.number(),
      contentType: v.optional(v.string()),
    }),
    v.null(),
  ),
  async handler(ctx, args) {
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) return null;
    return {
      size: meta.size,
      ...(meta.contentType != null && { contentType: meta.contentType }),
    };
  },
});

/**
 * Find a prior completed audio transcription with identical content (same
 * SHA-256 hash) within the same org. Used by `transcribeAudio` to short-
 * circuit duplicate uploads: user drags the same `meeting.mp3` twice, we
 * only transcribe once. Returns the source row (without embedding the full
 * transcript again in the args — caller reads `.transcript` from the result).
 */
export const findCachedTranscript = internalQuery({
  args: {
    organizationId: v.string(),
    contentHash: v.string(),
    excludeStorageId: blobRefValidator,
  },
  async handler(ctx, args) {
    for await (const row of ctx.db
      .query('fileMetadata')
      .withIndex('by_org_contentHash', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('contentHash', args.contentHash),
      )) {
      if (
        row.storageId !== args.excludeStorageId &&
        row.transcriptionStatus === 'completed' &&
        typeof row.transcript === 'string' &&
        row.transcript.length > 0
      ) {
        return row;
      }
    }
    return null;
  },
});
