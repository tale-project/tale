import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const todoStatusValidator = v.union(
  v.literal('pending'),
  v.literal('in_progress'),
  v.literal('done'),
  v.literal('failed'),
  v.literal('cancelled'),
);

export const todoItemValidator = v.object({
  id: v.string(),
  content: v.string(),
  status: todoStatusValidator,
  searchCount: v.number(),
  extractCount: v.number(),
  findingsSummary: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * Thread-scoped todo state for agents that use the update_todos tool.
 *
 * One document per (organizationId, threadId). Atomic batch updates and
 * live subscriptions rely on single-doc storage.
 *
 * Invariants enforced by the mutation layer (not the LLM):
 * - Single-active-todo: at most one todo in `in_progress` at a time.
 * - Idempotency: `recentOpIds` ring buffer rejects duplicate `update_todos` batches.
 * - `activeTodoId` kept in sync with `todos[*].status == 'in_progress'`.
 * - `organizationId` enforced on every read/write.
 */
export const threadTodosTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  todos: v.array(todoItemValidator),
  activeTodoId: v.optional(v.string()),
  recentOpIds: v.array(v.string()),
  integrationCallCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org_thread', ['organizationId', 'threadId'])
  .index('by_thread', ['threadId']);
