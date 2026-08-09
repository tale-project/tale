/**
 * Knowledge entries REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/knowledge-entries        — List entries (paginated)
 *   POST   /api/v1/knowledge-entries        — Create an entry
 *   GET    /api/v1/knowledge-entries/:id    — One entry
 *   PATCH  /api/v1/knowledge-entries/:id    — Replace an entry's topic/content
 *   DELETE /api/v1/knowledge-entries/:id    — Delete an entry and its chain
 *
 * ## Versioning is visible in the responses
 *
 * An entry is never edited in place: an update INSERTS a new active row and
 * marks the previous one `superseded`, so the version chain stays as audit
 * history. `PATCH` therefore answers with the id of the row it created, which
 * is the one the caller must address next — not the id in the path.
 *
 * The write paths consume the same `knowledge:mutate` per-organization rate
 * limit the in-app mutations do (on top of the REST bucket), and schedule the
 * same materialization job, so an entry created here is indexed for retrieval
 * exactly like one typed into the UI.
 *
 * Unlike the in-app listing, the REST projection carries no RAG status: it is a
 * derived view of the backing document, and a caller who wants indexing state
 * reads the document. The entry rows themselves are identical.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery } from '../_generated/server';
import { assertRecordTrashable } from '../documents/access';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import {
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonNoContent,
  jsonOk,
  parsePageLimit,
  readJsonObject,
  requiredString,
  withRestAuth,
} from '../lib/rest/helpers';
import { CONTENT_MAX_LENGTH, TOPIC_MAX_LENGTH } from './constants';
import {
  findActiveEntryByTopicKey,
  markEntryChainDeleted,
  upsertEntryRow,
  validateTopicAndContent,
} from './helpers';

const PREFIX = '/api/v1/knowledge-entries/';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

export const listKnowledgeEntries = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    if (
      status !== undefined &&
      status !== 'active' &&
      status !== 'superseded'
    ) {
      return jsonError('"status" must be active or superseded', 400);
    }
    const result = await rc.ctx.runQuery(
      internal.knowledge_entries.rest_api.restListKnowledgeEntries,
      {
        organizationId: rc.org.organizationId,
        ...(status !== undefined && { status }),
        cursor: url.searchParams.get('cursor') ?? null,
        limit: parsePageLimit(url, DEFAULT_LIMIT, MAX_LIMIT),
      },
    );
    return jsonOk(result);
  },
);

export const createKnowledgeEntry = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const body = await readJsonObject(request);
    const topic = requiredString(body, 'topic', TOPIC_MAX_LENGTH);
    const content = requiredString(body, 'content', CONTENT_MAX_LENGTH);

    const entryId = await rc.ctx.runMutation(
      internal.knowledge_entries.rest_api.restCreateKnowledgeEntry,
      {
        organizationId: rc.org.organizationId,
        createdBy: rc.user.userId,
        topic,
        content,
      },
    );
    return jsonCreated({ id: entryId });
  },
);

export const getKnowledgeEntry = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing entry ID', 400);
    if (subPath !== null) {
      return jsonError(`Unknown sub-resource: ${subPath}`, 404);
    }
    const entry = await rc.ctx.runQuery(
      internal.knowledge_entries.rest_api.restGetKnowledgeEntry,
      { organizationId: rc.org.organizationId, entryId: id },
    );
    if (!entry) return jsonError('Knowledge entry not found', 404);
    return jsonOk(entry);
  },
);

/** Replace an entry's topic and content. Answers with the NEW row's id. */
export const patchKnowledgeEntry = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing entry ID', 400);
    if (subPath !== null) {
      return jsonError(`Unknown sub-resource: ${subPath}`, 404);
    }

    const body = await readJsonObject(request);
    const topic = requiredString(body, 'topic', TOPIC_MAX_LENGTH);
    const content = requiredString(body, 'content', CONTENT_MAX_LENGTH);

    const result = await rc.ctx.runMutation(
      internal.knowledge_entries.rest_api.restUpdateKnowledgeEntry,
      {
        organizationId: rc.org.organizationId,
        updatedBy: rc.user.userId,
        entryId: id,
        topic,
        content,
      },
    );
    return jsonOk(result);
  },
);

export const deleteKnowledgeEntry = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing entry ID', 400);
    if (subPath !== null) {
      return jsonError(`Unknown sub-resource: ${subPath}`, 404);
    }
    await rc.ctx.runMutation(
      internal.knowledge_entries.rest_api.restDeleteKnowledgeEntry,
      { organizationId: rc.org.organizationId, entryId: id },
    );
    return jsonNoContent();
  },
);

// ---------------------------------------------------------------------------
// Internal reads and writes — the API key's half of the entry store
// ---------------------------------------------------------------------------
//
// The public functions in `queries.ts` / `mutations.ts` resolve the caller from
// `ctx.auth`; an API key has no such identity, so these take the organization
// explicitly. Every one of them scopes to it, and an entry from another
// organization is refused as NOT FOUND rather than reported as forbidden.

const entryViewValidator = v.object({
  id: v.id('knowledgeEntries'),
  topic: v.string(),
  content: v.string(),
  status: v.union(v.literal('active'), v.literal('superseded')),
  source: v.union(v.literal('chat'), v.literal('manual')),
  documentId: v.optional(v.id('documents')),
  supersededBy: v.optional(v.id('knowledgeEntries')),
  createdBy: v.string(),
  createdAt: v.number(),
});

function toEntryView(row: Doc<'knowledgeEntries'>) {
  return {
    id: row._id,
    topic: row.topic,
    content: row.content,
    status: row.status,
    source: row.source,
    ...(row.documentId !== undefined && { documentId: row.documentId }),
    ...(row.supersededBy !== undefined && { supersededBy: row.supersededBy }),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/**
 * The row, but only when it is this organization's and not a delete tombstone.
 * A row from another organization reads as absent, so an id guessed across the
 * tenant line reveals nothing about whether it exists.
 */
function ownedEntry(
  row: Doc<'knowledgeEntries'> | null,
  organizationId: string,
): Doc<'knowledgeEntries'> | null {
  if (
    !row ||
    row.deletedAt !== undefined ||
    row.organizationId !== organizationId
  ) {
    return null;
  }
  return row;
}

export const restListKnowledgeEntries = internalQuery({
  args: {
    organizationId: v.string(),
    status: v.optional(v.union(v.literal('active'), v.literal('superseded'))),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    page: v.array(entryViewValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const status = args.status ?? 'active';
    const result = await ctx.db
      .query('knowledgeEntries')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', status),
      )
      .order('desc')
      .paginate({ numItems: args.limit, cursor: args.cursor });
    return {
      // Soft-deleted rows are tombstones, not knowledge — filtered after the
      // page like the in-app listing, so a page may run short of `limit`.
      page: result.page
        .filter((row) => row.deletedAt === undefined)
        .map(toEntryView),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const restGetKnowledgeEntry = internalQuery({
  args: { organizationId: v.string(), entryId: v.string() },
  returns: v.union(v.null(), entryViewValidator),
  handler: async (ctx, args) => {
    const entryId = ctx.db.normalizeId('knowledgeEntries', args.entryId);
    if (entryId === null) return null;
    const row = ownedEntry(await ctx.db.get(entryId), args.organizationId);
    return row ? toEntryView(row) : null;
  },
});

export const restCreateKnowledgeEntry = internalMutation({
  args: {
    organizationId: v.string(),
    createdBy: v.string(),
    topic: v.string(),
    content: v.string(),
  },
  returns: v.id('knowledgeEntries'),
  handler: async (ctx, args) => {
    await checkOrganizationRateLimit(
      ctx,
      'knowledge:mutate',
      args.organizationId,
    );
    const { topic, topicKey, content } = validateTopicAndContent(
      args.topic,
      args.content,
    );
    const existing = await findActiveEntryByTopicKey(
      ctx,
      args.organizationId,
      topicKey,
    );
    if (existing) {
      throw new ConvexError({
        code: 'KNOWLEDGE_ENTRY_DUPLICATE',
        message: `An entry for "${existing.topic}" already exists.`,
        topic: existing.topic,
      });
    }
    const { entryId } = await upsertEntryRow(ctx, {
      organizationId: args.organizationId,
      topic,
      topicKey,
      content,
      source: 'manual',
      createdBy: args.createdBy,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.knowledge_entries.internal_actions.materializeKnowledgeEntry,
      { entryId },
    );
    return entryId;
  },
});

/**
 * Replace an entry: insert the new active version, supersede the old one, and
 * re-key the superseded chain when the topic was renamed — the same three steps
 * the in-app mutation performs, so the two paths cannot diverge in what a
 * version chain looks like afterwards.
 */
export const restUpdateKnowledgeEntry = internalMutation({
  args: {
    organizationId: v.string(),
    updatedBy: v.string(),
    entryId: v.string(),
    topic: v.string(),
    content: v.string(),
  },
  returns: v.object({ id: v.id('knowledgeEntries') }),
  handler: async (ctx, args) => {
    const entryId = ctx.db.normalizeId('knowledgeEntries', args.entryId);
    const entry = ownedEntry(
      entryId === null ? null : await ctx.db.get(entryId),
      args.organizationId,
    );
    if (!entry) {
      throw new ConvexError({
        code: 'KNOWLEDGE_ENTRY_NOT_FOUND',
        message: 'No such knowledge entry for this organization.',
      });
    }
    if (entry.status !== 'active') {
      throw new ConvexError({
        code: 'KNOWLEDGE_ENTRY_NOT_ACTIVE',
        message:
          'This version has been superseded; edit the entry that replaced it.',
      });
    }
    await checkOrganizationRateLimit(
      ctx,
      'knowledge:mutate',
      args.organizationId,
    );

    const { topic, topicKey, content } = validateTopicAndContent(
      args.topic,
      args.content,
    );
    if (topicKey !== entry.topicKey) {
      const collision = await findActiveEntryByTopicKey(
        ctx,
        args.organizationId,
        topicKey,
      );
      if (collision) {
        throw new ConvexError({
          code: 'KNOWLEDGE_ENTRY_DUPLICATE',
          message: `An entry for "${collision.topic}" already exists.`,
          topic: collision.topic,
        });
      }
    }

    const now = Date.now();
    const newEntryId = await ctx.db.insert('knowledgeEntries', {
      organizationId: entry.organizationId,
      topic,
      topicKey,
      content,
      status: 'active',
      documentId: entry.documentId,
      source: 'manual',
      createdBy: args.updatedBy,
      createdAt: now,
    });
    await ctx.db.patch(entry._id, {
      status: 'superseded',
      supersededBy: newEntryId,
      supersededAt: now,
    });

    if (topicKey !== entry.topicKey) {
      for await (const row of ctx.db
        .query('knowledgeEntries')
        .withIndex('by_org_topicKey_status', (q) =>
          q
            .eq('organizationId', entry.organizationId)
            .eq('topicKey', entry.topicKey),
        )) {
        if (row._id === newEntryId) continue;
        await ctx.db.patch(row._id, { topicKey });
      }
    }

    await ctx.scheduler.runAfter(
      0,
      internal.knowledge_entries.internal_actions.materializeKnowledgeEntry,
      { entryId: newEntryId },
    );
    return { id: newEntryId };
  },
});

export const restDeleteKnowledgeEntry = internalMutation({
  args: { organizationId: v.string(), entryId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entryId = ctx.db.normalizeId('knowledgeEntries', args.entryId);
    const entry = ownedEntry(
      entryId === null ? null : await ctx.db.get(entryId),
      args.organizationId,
    );
    if (!entry) {
      throw new ConvexError({
        code: 'KNOWLEDGE_ENTRY_NOT_FOUND',
        message: 'No such knowledge entry for this organization.',
      });
    }
    await checkOrganizationRateLimit(
      ctx,
      'knowledge:mutate',
      args.organizationId,
    );
    // Controlled-record gate BEFORE any write — the scheduled pipeline below
    // runs `deleteDocumentById` without `callerOrgId`, bypassing its
    // `assertRecordTrashable`. The typed DOCUMENT_RECORD_PROTECTED refusal
    // surfaces through `withRestAuth`'s ConvexError→HTTP mapping as a 409.
    if (entry.documentId) {
      const backingDoc = await ctx.db.get(entry.documentId);
      if (backingDoc) assertRecordTrashable(backingDoc);
    }
    await markEntryChainDeleted(ctx, args.organizationId, entry.topicKey);
    // The backing document (Convex row + RAG chunks + blob cleanup) rides the
    // existing document deletion pipeline.
    if (entry.documentId) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.internal_actions.deleteDocumentFromRag,
        { documentId: entry.documentId },
      );
    }
    return null;
  },
});
