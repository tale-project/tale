import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * User-contributed knowledge entries — small markdown facts captured from
 * chat (via the approval-gated `knowledge_write` tool) or authored manually
 * in the Knowledge entries tab.
 *
 * Each entry is keyed by a normalized `topicKey` (trimmed, lowercased,
 * whitespace-collapsed `topic`). At most ONE row per (org, topicKey) is
 * `active`; writing to an existing topic supersedes the previous version
 * (Option A delete+replace toward RAG, version chain kept in Convex for
 * audit/undo). The active row is backed by a `documents` row
 * (`sourceProvider: 'knowledge'`, title `{topic}.md`) so indexing, agent
 * scoping, citations, and deletion ride the existing document pipeline.
 *
 * `status` machine:
 *  - 'active'     : the live version — its content is what RAG serves.
 *  - 'superseded' : replaced by a newer version (`supersededBy` points at it).
 *
 * `deletedAt` soft-deletes the whole chain (set on every row of a topic when
 * the entry is deleted, or when its backing document is deleted from the
 * Documents tab).
 */
export const knowledgeEntriesTable = defineTable({
  organizationId: v.string(),
  topic: v.string(),
  topicKey: v.string(),
  content: v.string(),
  status: v.union(v.literal('active'), v.literal('superseded')),
  documentId: v.optional(v.id('documents')),
  source: v.union(v.literal('chat'), v.literal('manual')),
  sourceThreadId: v.optional(v.string()),
  sourceMessageId: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  supersededBy: v.optional(v.id('knowledgeEntries')),
  supersededAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
})
  .index('by_org_topicKey_status', ['organizationId', 'topicKey', 'status'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_documentId', ['documentId'])
  .index('by_organizationId', ['organizationId']);
